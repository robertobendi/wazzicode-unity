//! Shared headless-Claude spawn + stream core.
//!
//! Both the chat session manager (`session.rs`) and the auto-loop runner
//! (`looprunner`) spawn `claude -p --output-format stream-json …`, stream each
//! parsed JSON line to the webview as `claude:stream:<runId>`, and need the
//! same cancellation semantics (kill the whole process *group* — Claude spawns
//! the MCP server as a child, so a plain SIGKILL on the parent would orphan
//! it). This module is that single implementation.
//!
//! `spawn_streaming` returns a [`ChildHandle`] (for cancellation) plus a
//! `JoinHandle<ExitInfo>` the caller can either **await** (the loop drives
//! turns sequentially and consumes the `ExitInfo`) or **detach** (chat fires
//! its terminal `claude:done`/`claude:error` events off the reader task). The
//! core itself only emits the streaming events; terminal events are the
//! caller's concern.

use crate::error::{AppError, AppResult};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;

/// Fields captured off a run's stream, returned when it exits.
#[derive(Debug, Default, Clone)]
pub struct ExitInfo {
    pub session_id: Option<String>,
    pub cost_usd: Option<f64>,
    pub is_error: bool,
    pub result_text: Option<String>,
    pub num_turns: Option<u64>,
    /// A `result` line was seen — the run produced a real answer.
    pub result_seen: bool,
    /// The run was cancelled via its [`ChildHandle`] (killed process tree).
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    /// Last ~4 KiB of stderr, for crash diagnostics.
    pub stderr_tail: String,
}

/// Handle to a live child, enough to cancel it. Cheap to clone.
#[derive(Clone)]
pub struct ChildHandle {
    child: Arc<AsyncMutex<tokio::process::Child>>,
    cancelled: Arc<AtomicBool>,
    /// Process-group leader pid (== child pid; we spawn it in its own group).
    pid: Option<u32>,
}

impl ChildHandle {
    /// Mark cancelled (so the reader reports `cancelled: true`) and kill the
    /// whole process tree. No-op if the child already exited.
    pub async fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        kill_tree(self.pid, self.child.clone()).await;
    }
}

/// Spawn a `claude -p` run for `project` with `args` (everything after the
/// program name; the prompt is fed via stdin, not argv). Each parsed JSON line
/// is emitted as `claude:stream:<run_id>`; non-JSON lines go to `debug:raw`.
///
/// Returns the cancellation handle and the reader task's join handle, which
/// resolves to the captured [`ExitInfo`] once the child exits.
pub fn spawn_streaming(
    app: AppHandle,
    run_id: String,
    project: &Path,
    args: Vec<String>,
    prompt: String,
) -> AppResult<(ChildHandle, JoinHandle<ExitInfo>)> {
    // Reuse proc's PATH augmentation + no-window handling, then override the
    // stdio it nulls (we need to write the prompt and read the stream).
    let mut std_cmd = crate::proc::command("claude")?;
    std_cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(project)
        .args(&args);
    // No token management: the spawn inherits the parent environment as-is and
    // authenticates with the Claude CLI's OWN stored credentials (`~/.claude`),
    // established once via the pairing flow / an existing `claude login`.
    // Own process group so cancellation can kill the whole tree (Claude + its
    // MCP server child) with a single group signal.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        std_cmd.process_group(0);
    }

    let mut cmd = tokio::process::Command::from(std_cmd);
    cmd.kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("could not start Claude: {e}")))?;

    let pid = child.id();
    let child_stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Prompt → stdin, then EOF so Claude starts working.
    if let Some(mut sin) = child_stdin {
        tokio::spawn(async move {
            let _ = sin.write_all(prompt.as_bytes()).await;
            let _ = sin.shutdown().await;
        });
    }

    let child = Arc::new(AsyncMutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let handle = ChildHandle {
        child: child.clone(),
        cancelled: cancelled.clone(),
        pid,
    };

    let join = tokio::spawn(async move {
        let mut captured = Captured::default();

        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(&line) {
                    Ok(value) => {
                        capture(&mut captured, &value);
                        let _ = app.emit(&format!("claude:stream:{run_id}"), &value);
                    }
                    Err(_) => {
                        // Non-JSON line — surface only to the debug drawer.
                        let _ = app.emit(
                            "debug:raw",
                            serde_json::json!({ "runId": run_id, "line": line }),
                        );
                    }
                }
            }
        }

        let stderr_tail = match stderr {
            Some(err) => read_tail(err).await,
            None => String::new(),
        };
        let status = child.lock().await.wait().await;
        let exit_code = status.ok().and_then(|s| s.code());

        ExitInfo {
            session_id: captured.session_id,
            cost_usd: captured.cost_usd,
            is_error: captured.is_error,
            result_text: captured.result_text,
            num_turns: captured.num_turns,
            result_seen: captured.result_seen,
            cancelled: cancelled.load(Ordering::SeqCst),
            exit_code,
            stderr_tail,
        }
    });

    Ok((handle, join))
}

/// Escalating group kill: SIGTERM the group, then SIGKILL after 3s (unix);
/// `taskkill /T /F` the tree on Windows. Falls back to killing just the child
/// if we somehow don't have a pid.
async fn kill_tree(pid: Option<u32>, child: Arc<AsyncMutex<tokio::process::Child>>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        // Negative pid targets the whole process group.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        let child2 = child.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
            let _ = child2.lock().await.start_kill();
        });
        return;
    }
    #[cfg(windows)]
    if let Some(pid) = pid {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/T", "/F", "/PID", &pid.to_string()]);
        crate::proc::no_window(&mut cmd);
        let _ = cmd.spawn();
        return;
    }
    let _ = pid;
    let _ = child.lock().await.start_kill();
}

/// Fields pulled off the stream for the `ExitInfo` / terminal events.
#[derive(Default)]
struct Captured {
    session_id: Option<String>,
    cost_usd: Option<f64>,
    is_error: bool,
    result_text: Option<String>,
    num_turns: Option<u64>,
    result_seen: bool,
}

/// Pull the fields we need off each stream line.
fn capture(c: &mut Captured, v: &serde_json::Value) {
    match v.get("type").and_then(|t| t.as_str()) {
        Some("system") => {
            if v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
                if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                    c.session_id = Some(sid.to_string());
                }
            }
        }
        Some("result") => {
            c.result_seen = true;
            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                c.session_id = Some(sid.to_string());
            }
            if let Some(cost) = v.get("total_cost_usd").and_then(|n| n.as_f64()) {
                c.cost_usd = Some(cost);
            }
            c.is_error = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
            if let Some(r) = v.get("result").and_then(|s| s.as_str()) {
                c.result_text = Some(r.to_string());
            }
            if let Some(n) = v.get("num_turns").and_then(|n| n.as_u64()) {
                c.num_turns = Some(n);
            }
        }
        _ => {}
    }
}

/// Keep the last ~4KiB of a child's stderr for the crash-diagnostics payload.
async fn read_tail<R: tokio::io::AsyncRead + Unpin>(mut r: R) -> String {
    const CAP: usize = 4096;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match r.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > CAP {
                    let drop = buf.len() - CAP;
                    buf.drain(..drop);
                }
            }
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// Best-effort human message when Claude dies without producing a result. The
/// webview's `errorMessages.ts` refines this further from the raw tail.
pub fn friendly_spawn_error(stderr_tail: &str, exit_code: Option<i32>) -> String {
    let lower = stderr_tail.to_lowercase();
    if lower.contains("not logged in")
        || lower.contains("api key")
        || lower.contains("oauth")
        || lower.contains("401")
        || lower.contains("authentication")
    {
        return "Your connection expired — go to Settings → Re-pair account.".into();
    }
    if lower.contains("enoent") || lower.contains("not found") {
        return "The Claude CLI couldn't start. It may not be installed.".into();
    }
    match exit_code {
        Some(code) => format!("Claude stopped unexpectedly (exit code {code})."),
        None => "Claude stopped unexpectedly.".into(),
    }
}
