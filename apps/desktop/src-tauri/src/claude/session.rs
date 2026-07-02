//! Headless Claude session manager.
//!
//! Spawns `claude -p --output-format stream-json …` per chat turn, streams its
//! stdout (one JSON object per line) to the webview as `claude:stream:<runId>`
//! events, and — on exit — emits either `claude:done:<runId>` (a `result`
//! event was seen) or `claude:error:<runId>` (crash / never produced a result,
//! or user cancellation). Stream *parsing* into chat messages happens in the
//! webview (`src/lib/streamMapper.ts`); Rust stays a thin, dumb pipe.
//!
//! Concurrency: at most one active run per project. Cancellation kills the
//! whole process group (Claude spawns the MCP server as a child — a plain
//! SIGKILL on the parent would orphan it), then the reader task emits the
//! friendly "Stopped" error so there's a single exit-emit code path.

use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

/// One live Claude child process.
struct RunHandle {
    child: Arc<AsyncMutex<tokio::process::Child>>,
    project: PathBuf,
    /// Flipped by `cancel()` so the reader task emits "Stopped" instead of a
    /// spurious crash error when the killed process's stdout hits EOF.
    cancelled: Arc<AtomicBool>,
    /// Process-group leader pid (== child pid, we spawn it in its own group).
    pid: Option<u32>,
}

/// Tracks active runs. Cheap to clone (shared `Arc` map) so the stdout reader
/// task can deregister itself on exit. Held in `AppState`.
#[derive(Clone, Default)]
pub struct SessionManager {
    runs: Arc<Mutex<HashMap<String, RunHandle>>>,
}

/// Fields captured off the stream so the `done` event can report them without
/// the webview having to send them back.
#[derive(Default)]
struct Captured {
    session_id: Option<String>,
    cost_usd: Option<f64>,
    is_error: bool,
    result_text: Option<String>,
    num_turns: Option<u64>,
    result_seen: bool,
}

impl SessionManager {
    /// Spawn a Claude run. Returns the `runId` used in the event names.
    /// Errors with `"busy"` if a run for `project` is already active.
    pub async fn start_run(
        &self,
        app: AppHandle,
        project: PathBuf,
        prompt: String,
        args: Vec<String>,
    ) -> AppResult<String> {
        // One active run per project.
        if self
            .runs
            .lock()
            .unwrap()
            .values()
            .any(|h| h.project == project)
        {
            return Err(AppError::Other("busy".into()));
        }

        // Reuse proc's PATH augmentation + no-window handling, then override
        // the stdio it nulls (we need to write the prompt and read the stream).
        let mut std_cmd = crate::proc::command("claude")?;
        std_cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&project)
            .args(&args);
        // B4: replace env passthrough with a keychain lookup.
        if let Some(token) = oauth_token() {
            std_cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
        }
        // Own process group so cancellation can kill the whole tree (Claude +
        // its MCP server child) with a single group signal.
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

        let run_id = nanoid::nanoid!();
        let child = Arc::new(AsyncMutex::new(child));
        let cancelled = Arc::new(AtomicBool::new(false));
        self.runs.lock().unwrap().insert(
            run_id.clone(),
            RunHandle {
                child: child.clone(),
                project,
                cancelled: cancelled.clone(),
                pid,
            },
        );

        let runs_map = self.runs.clone();
        let run_id_task = run_id.clone();
        tokio::spawn(async move {
            let run_id = run_id_task;
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
            runs_map.lock().unwrap().remove(&run_id);

            if cancelled.load(Ordering::SeqCst) {
                let _ = app.emit(
                    &format!("claude:error:{run_id}"),
                    serde_json::json!({ "friendly": "Stopped.", "raw": "Run cancelled by user." }),
                );
            } else if captured.result_seen {
                let _ = app.emit(
                    &format!("claude:done:{run_id}"),
                    serde_json::json!({
                        "sessionId": captured.session_id,
                        "costUsd": captured.cost_usd,
                        "isError": captured.is_error,
                        "resultText": captured.result_text,
                        "numTurns": captured.num_turns,
                    }),
                );
            } else {
                let _ = app.emit(
                    &format!("claude:error:{run_id}"),
                    serde_json::json!({
                        "friendly": friendly_spawn_error(&stderr_tail, exit_code),
                        "raw": format!("{stderr_tail}\n(exit code: {exit_code:?})"),
                    }),
                );
            }
        });

        Ok(run_id)
    }

    /// Stop a run. Marks it cancelled (so its reader emits "Stopped") and kills
    /// the process group. No-op if the run already finished.
    pub async fn cancel(&self, run_id: &str) {
        let handle = {
            let runs = self.runs.lock().unwrap();
            runs.get(run_id)
                .map(|h| (h.child.clone(), h.cancelled.clone(), h.pid))
        };
        let Some((child, cancelled, pid)) = handle else {
            return;
        };
        cancelled.store(true, Ordering::SeqCst);
        kill_tree(pid, child).await;
    }
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

/// Pull the fields we need for the `done`/`error` events off each stream line.
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
fn friendly_spawn_error(stderr_tail: &str, exit_code: Option<i32>) -> String {
    let lower = stderr_tail.to_lowercase();
    if lower.contains("not logged in")
        || lower.contains("api key")
        || lower.contains("oauth")
        || lower.contains("401")
        || lower.contains("authentication")
    {
        return "Claude isn't signed in yet. Ask your admin to pair this app.".into();
    }
    if lower.contains("enoent") || lower.contains("not found") {
        return "The Claude CLI couldn't start. It may not be installed.".into();
    }
    match exit_code {
        Some(code) => format!("Claude stopped unexpectedly (exit code {code})."),
        None => "Claude stopped unexpectedly.".into(),
    }
}

/// B4: replace with an OS-keychain lookup. For now we only forward an
/// already-present env token (dev machines that are logged in).
fn oauth_token() -> Option<String> {
    std::env::var("CLAUDE_CODE_OAUTH_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
}
