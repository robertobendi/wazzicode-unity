//! Onboarding commands: everything the first-run wizard drives.
//!
//! - `onboarding_status` — one call the wizard uses to pick its starting step.
//! - `onboarding_check_cli` / `onboarding_install_cli` — detect / install the
//!   Claude CLI (streaming progress on `onboarding:progress`).
//! - `onboarding_setup_project` — the "prepare this project" sequence: uvibe
//!   init → install the Unity package (if needed) → autonomy on → write the
//!   app-managed MCP config → patch `.gitignore` → verify with `uvibe doctor`.
//!
//! Sub-processes reuse `mcpconfig::resolve_uvibe` so the wizard runs the SAME
//! uvibe binary the chat/loop MCP server will (bundled sidecar in release, the
//! monorepo CLI in dev).

use crate::error::{AppError, AppResult};
use crate::proc;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

// --- Public payloads (serde camelCase; mirrored in src/types/onboarding.ts) ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSidecar {
    /// True in a packaged build (bundled node + uvibe.cjs present).
    pub bundled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub claude_cli: CliStatus,
    pub node_sidecar: NodeSidecar,
    pub current_project: Option<String>,
    /// Inspection of `current_project` (if any), so the wizard can pre-fill.
    pub project_ready: Option<crate::commands::project::ProjectInfo>,
    /// This machine has connected at least once (persisted `paired_ok`).
    pub paired_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStep {
    pub id: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSummary {
    pub config_ok: bool,
    pub package_ok: bool,
    pub bridge_reachable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    pub steps: Vec<SetupStep>,
    pub summary: Option<DoctorSummary>,
}

// --- Commands ---

/// Everything the wizard needs to decide where to start. Cheap; safe to poll.
#[tauri::command]
pub async fn onboarding_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<OnboardingStatus> {
    let (current_project, paired_ok) = {
        let s = state.settings.read().await;
        (s.current_project.clone(), s.paired_ok)
    };
    let bundled = crate::mcpconfig::has_bundled_sidecar(&app);

    let cur = current_project.clone();
    let (claude_cli, project_ready) = tokio::task::spawn_blocking(move || {
        let cli = check_cli_blocking();
        let pr = cur.map(crate::commands::project::inspect_project);
        (cli, pr)
    })
    .await
    .map_err(|e| AppError::Other(format!("status task failed: {e}")))?;

    Ok(OnboardingStatus {
        claude_cli,
        node_sidecar: NodeSidecar { bundled },
        current_project,
        project_ready,
        paired_ok,
    })
}

/// Is the Claude CLI installed, and what version? Blocking probe under the hood.
#[tauri::command]
pub async fn onboarding_check_cli() -> AppResult<CliStatus> {
    tokio::task::spawn_blocking(check_cli_blocking)
        .await
        .map_err(|e| AppError::Other(format!("cli check task failed: {e}")))
}

/// Install the Claude CLI via the official installer, streaming progress lines on
/// `onboarding:progress` ({step:"install_cli", line}). Re-checks afterwards and
/// returns the resulting status; errors with a copy-able manual command on
/// failure. Requires network. Long timeout — installers can be slow.
#[tauri::command]
pub async fn onboarding_install_cli(app: AppHandle) -> AppResult<CliStatus> {
    tokio::task::spawn_blocking(move || install_cli_blocking(&app))
        .await
        .map_err(|e| AppError::Other(format!("install task failed: {e}")))?
}

/// Prepare a Unity project for the app: init → install package (if needed) →
/// autonomy on → mcp config → .gitignore → doctor. Each step emits progress and
/// contributes a `SetupStep` to the aggregated result.
#[tauri::command]
pub async fn onboarding_setup_project(
    app: AppHandle,
    project: String,
    state: State<'_, AppState>,
) -> AppResult<SetupResult> {
    let project_path = PathBuf::from(&project);
    let config_dir = state.config_dir.clone();
    // Resolve the uvibe invocation + package source on the main thread (needs the
    // Tauri path resolver), then do the blocking sub-spawns off-runtime.
    let (uvibe_cmd, uvibe_prefix) = crate::mcpconfig::resolve_uvibe(&app);
    let pkg_source = crate::mcpconfig::unity_package_source(&app);

    tokio::task::spawn_blocking(move || {
        setup_blocking(app, project_path, config_dir, uvibe_cmd, uvibe_prefix, pkg_source)
    })
    .await
    .map_err(|e| AppError::Other(format!("setup task failed: {e}")))?
}

// --- CLI detection / install ---

fn check_cli_blocking() -> CliStatus {
    match proc::resolve("claude") {
        None => CliStatus {
            found: false,
            path: None,
            version: None,
        },
        Some(p) => {
            let version = proc::command("claude")
                .ok()
                .and_then(|mut cmd| {
                    cmd.arg("--version");
                    proc::output_with_timeout(cmd, Duration::from_secs(10)).ok()
                })
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());
            CliStatus {
                found: true,
                path: Some(p.to_string_lossy().into_owned()),
                version,
            }
        }
    }
}

fn install_cli_blocking(app: &AppHandle) -> AppResult<CliStatus> {
    let (program, args) = install_plan();
    let mut cmd = proc::command(program)?;
    cmd.args(&args);
    emit_line(app, "install_cli", &format!("Installing the Claude CLI ({program})…"));
    // Some installers exit nonzero yet still install; re-check regardless.
    let _ = stream_process(app, "install_cli", cmd, Duration::from_secs(600))?;

    let status = check_cli_blocking();
    if status.found {
        emit_line(app, "install_cli", "Claude CLI is ready.");
        return Ok(status);
    }
    Err(AppError::Other(format!(
        "Couldn't install the Claude CLI automatically. Ask your admin to run this in a terminal, then click Continue:\n  {}",
        manual_install_command()
    )))
}

/// The installer invocation per OS. Pure (branches on target_os) so it's unit-
/// testable on the host.
fn install_plan() -> (&'static str, Vec<&'static str>) {
    #[cfg(target_os = "windows")]
    {
        (
            "powershell",
            vec!["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"],
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("bash", vec!["-c", "curl -fsSL https://claude.ai/install.sh | bash"])
    }
}

fn manual_install_command() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "irm https://claude.ai/install.ps1 | iex"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "curl -fsSL https://claude.ai/install.sh | bash"
    }
}

// --- Project setup sequence ---

fn setup_blocking(
    app: AppHandle,
    project: PathBuf,
    config_dir: PathBuf,
    uvibe_cmd: String,
    uvibe_prefix: Vec<String>,
    pkg_source: Option<PathBuf>,
) -> AppResult<SetupResult> {
    let proj = project.to_string_lossy().to_string();
    let mut steps: Vec<SetupStep> = Vec::new();

    // (a) uvibe init — .unity-vibe/ scaffold + CLAUDE.md block.
    steps.push(run_uvibe_step(
        &app,
        "init",
        &uvibe_cmd,
        &uvibe_prefix,
        &["init", "--project", &proj, "--json"],
    ));

    // (b) Install the Unity Editor package unless it's already there.
    if unity_package_installed(&project) {
        emit_line(&app, "install_package", "Unity package already installed — skipping.");
        steps.push(SetupStep {
            id: "install_package".into(),
            ok: true,
            detail: "already installed".into(),
        });
    } else if let Some(src) = pkg_source.as_deref() {
        let src_str = src.to_string_lossy().to_string();
        steps.push(run_uvibe_step(
            &app,
            "install_package",
            &uvibe_cmd,
            &uvibe_prefix,
            &[
                "install-unity-package",
                "--project",
                &proj,
                "--source",
                &src_str,
                "--mode",
                "copy",
            ],
        ));
    } else {
        emit_line(&app, "install_package", "Couldn't find the UnityVibeOS package to install.");
        steps.push(SetupStep {
            id: "install_package".into(),
            ok: false,
            detail: "UnityVibeOS source not found".into(),
        });
    }

    // (c) autonomy on — flip writes on (autopilot + autoSnapshot).
    steps.push(run_uvibe_step(
        &app,
        "autonomy",
        &uvibe_cmd,
        &uvibe_prefix,
        &["autonomy", "on", "--project", &proj],
    ));

    // (d) App-managed MCP config (so the chat/loop runs get the unity server).
    emit_line(&app, "mcp_config", "Writing the Claude connection…");
    match crate::mcpconfig::ensure_mcp_config(&app, &config_dir, &project) {
        Ok(p) => steps.push(SetupStep {
            id: "mcp_config".into(),
            ok: true,
            detail: p.to_string_lossy().into_owned(),
        }),
        Err(e) => steps.push(SetupStep {
            id: "mcp_config".into(),
            ok: false,
            detail: e.to_string(),
        }),
    }

    // (e) .gitignore the app's scratch dirs (the loop does `git add -A`).
    emit_line(&app, "gitignore", "Updating .gitignore…");
    match patch_gitignore_file(&project) {
        Ok(true) => steps.push(SetupStep {
            id: "gitignore".into(),
            ok: true,
            detail: "added .unity-vibe/inbox/ + loop/".into(),
        }),
        Ok(false) => steps.push(SetupStep {
            id: "gitignore".into(),
            ok: true,
            detail: "already ignored".into(),
        }),
        Err(e) => steps.push(SetupStep {
            id: "gitignore".into(),
            ok: false,
            detail: e.to_string(),
        }),
    }

    // (f) Verify with doctor --json.
    let summary = run_doctor_summary(&app, &uvibe_cmd, &uvibe_prefix, &proj, &mut steps);

    Ok(SetupResult { steps, summary })
}

fn run_uvibe_step(
    app: &AppHandle,
    id: &str,
    cmd: &str,
    prefix: &[String],
    sub: &[&str],
) -> SetupStep {
    emit_line(app, id, &format!("uvibe {}", sub.join(" ")));
    let mut full = prefix.to_vec();
    full.extend(sub.iter().map(|s| s.to_string()));
    let command = match uvibe_command_builder(cmd, &full) {
        Ok(c) => c,
        Err(e) => {
            return SetupStep {
                id: id.into(),
                ok: false,
                detail: e.to_string(),
            }
        }
    };
    match stream_process(app, id, command, Duration::from_secs(120)) {
        Ok((ok, tail)) => SetupStep {
            id: id.into(),
            ok,
            detail: last_line(&tail).unwrap_or_else(|| if ok { "done".into() } else { "failed".into() }),
        },
        Err(e) => SetupStep {
            id: id.into(),
            ok: false,
            detail: e.to_string(),
        },
    }
}

fn run_doctor_summary(
    app: &AppHandle,
    cmd: &str,
    prefix: &[String],
    proj: &str,
    steps: &mut Vec<SetupStep>,
) -> Option<DoctorSummary> {
    emit_line(app, "doctor", "Verifying setup…");
    let mut full = prefix.to_vec();
    full.extend(
        ["doctor", "--project", proj, "--json"]
            .iter()
            .map(|s| s.to_string()),
    );
    let command = match uvibe_command_builder(cmd, &full) {
        Ok(c) => c,
        Err(e) => {
            steps.push(SetupStep {
                id: "doctor".into(),
                ok: false,
                detail: e.to_string(),
            });
            return None;
        }
    };
    // Capture the full JSON (don't stream — it must parse whole).
    let out = match proc::output_with_timeout(command, Duration::from_secs(60)) {
        Ok(o) => o,
        Err(e) => {
            steps.push(SetupStep {
                id: "doctor".into(),
                ok: false,
                detail: e.to_string(),
            });
            return None;
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(v) => {
            let b = |ptr: &str| v.pointer(ptr).and_then(|x| x.as_bool()).unwrap_or(false);
            let summary = DoctorSummary {
                config_ok: b("/config/exists"),
                package_ok: b("/unityPackage/detected"),
                bridge_reachable: b("/bridge/reachable"),
            };
            emit_line(
                app,
                "doctor",
                &format!(
                    "config={} package={} bridge={}",
                    summary.config_ok, summary.package_ok, summary.bridge_reachable
                ),
            );
            steps.push(SetupStep {
                id: "doctor".into(),
                ok: summary.config_ok && summary.package_ok,
                detail: "verified".into(),
            });
            Some(summary)
        }
        Err(_) => {
            steps.push(SetupStep {
                id: "doctor".into(),
                ok: false,
                detail: "couldn't parse doctor output".into(),
            });
            None
        }
    }
}

// --- Pure helpers (unit-tested) ---

/// Idempotently ensure `.gitignore` ignores the app's scratch dirs. `existing`
/// is the current file content (or `None` if absent). Returns the new content
/// when a change is needed, else `None`.
pub fn patch_gitignore(existing: Option<&str>) -> Option<String> {
    const ENTRIES: [&str; 2] = [".unity-vibe/inbox/", ".unity-vibe/loop/"];
    let current = existing.unwrap_or("");
    let present = |needle: &str| current.lines().any(|l| l.trim() == needle);
    let missing: Vec<&str> = ENTRIES.iter().copied().filter(|e| !present(e)).collect();
    if missing.is_empty() {
        return None;
    }
    let mut out = current.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !current.contains("Unity Vibe Studio") {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("# Unity Vibe Studio scratch (safe to ignore)\n");
    }
    for e in missing {
        out.push_str(e);
        out.push('\n');
    }
    Some(out)
}

fn patch_gitignore_file(project: &Path) -> AppResult<bool> {
    let path = project.join(".gitignore");
    let existing = std::fs::read_to_string(&path).ok();
    match patch_gitignore(existing.as_deref()) {
        Some(next) => {
            std::fs::write(&path, next)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// True when the UnityVibeOS package is already present in the project (embedded
/// under Packages/, or referenced from Packages/manifest.json).
pub fn unity_package_installed(project: &Path) -> bool {
    let packages = project.join("Packages");
    if packages.join("com.uvibe.os").join("package.json").is_file()
        || packages.join("UnityVibeOS").join("package.json").is_file()
    {
        return true;
    }
    std::fs::read_to_string(packages.join("manifest.json"))
        .map(|raw| manifest_str_has_uvibe(&raw))
        .unwrap_or(false)
}

/// Whether a Packages/manifest.json string references `com.uvibe.os`.
pub fn manifest_str_has_uvibe(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("dependencies")
                .and_then(|d| d.get("com.uvibe.os"))
                .map(|_| true)
        })
        .unwrap_or(false)
}

// --- Process plumbing ---

/// Build a `Command` for the resolved uvibe invocation. `cmd` is either an
/// absolute path (bundled/dev node, or the cjs host) — used directly with the
/// augmented PATH exported so uvibe's own subprocesses (e.g. doctor's `git`)
/// resolve — or the bare `uvibe` name, resolved on PATH via `proc::command`.
fn uvibe_command_builder(cmd: &str, args: &[String]) -> AppResult<Command> {
    let mut c = if cmd.contains('/') || cmd.contains('\\') {
        let mut c = Command::new(cmd);
        c.env("PATH", proc::search_path());
        c.stdin(Stdio::null());
        proc::no_window(&mut c);
        c
    } else {
        proc::command(cmd)?
    };
    c.args(args);
    Ok(c)
}

/// Run `cmd` to completion with a deadline, emitting each stdout/stderr line as
/// `onboarding:progress` {step, line}. Returns `(success, tail)` where `tail` is
/// the (capped) collected output for the step detail.
fn stream_process(
    app: &AppHandle,
    step: &str,
    mut cmd: Command,
    timeout: Duration,
) -> AppResult<(bool, String)> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("could not start {step}: {e}")))?;

    let out_handle = std::thread::spawn(stream_reader(app.clone(), step.to_string(), child.stdout.take()));
    let err_handle = std::thread::spawn(stream_reader(app.clone(), step.to_string(), child.stderr.take()));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = out_handle.join();
                    let _ = err_handle.join();
                    return Err(AppError::Other(format!("{step} timed out and was stopped")));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Other(format!("waiting on {step} failed: {e}")));
            }
        }
    };

    let mut tail = out_handle.join().unwrap_or_default();
    let err_tail = err_handle.join().unwrap_or_default();
    if !err_tail.is_empty() {
        if !tail.is_empty() {
            tail.push('\n');
        }
        tail.push_str(&err_tail);
    }
    Ok((status.success(), tail))
}

/// A closure that drains a child pipe line-by-line, emitting each line and
/// returning the (capped) collected text. Returned as an `FnOnce` for
/// `thread::spawn`.
fn stream_reader<R: Read + Send + 'static>(
    app: AppHandle,
    step: String,
    pipe: Option<R>,
) -> impl FnOnce() -> String {
    move || {
        let Some(pipe) = pipe else {
            return String::new();
        };
        let mut collected = String::new();
        for line in std::io::BufReader::new(pipe).lines() {
            let Ok(line) = line else { break };
            let _ = app.emit(
                "onboarding:progress",
                serde_json::json!({ "step": step, "line": line }),
            );
            if collected.len() < 8192 {
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    }
}

fn emit_line(app: &AppHandle, step: &str, line: &str) {
    let _ = app.emit(
        "onboarding:progress",
        serde_json::json!({ "step": step, "line": line }),
    );
}

fn last_line(s: &str) -> Option<String> {
    s.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitignore_patch_adds_both_entries_to_empty() {
        let out = patch_gitignore(None).expect("should add entries");
        assert!(out.contains(".unity-vibe/inbox/"));
        assert!(out.contains(".unity-vibe/loop/"));
    }

    #[test]
    fn gitignore_patch_is_idempotent() {
        let first = patch_gitignore(None).unwrap();
        // Applying again over the produced content is a no-op.
        assert!(patch_gitignore(Some(&first)).is_none());
    }

    #[test]
    fn gitignore_patch_preserves_existing_and_appends_missing() {
        let existing = "Library/\nTemp/\n.unity-vibe/inbox/\n";
        let out = patch_gitignore(Some(existing)).expect("loop/ still missing");
        assert!(out.starts_with("Library/\nTemp/\n.unity-vibe/inbox/\n"));
        assert!(out.contains(".unity-vibe/loop/"));
        // inbox not duplicated.
        assert_eq!(out.matches(".unity-vibe/inbox/").count(), 1);
    }

    #[test]
    fn gitignore_patch_handles_missing_trailing_newline() {
        let out = patch_gitignore(Some("Library/")).unwrap();
        assert!(out.contains("Library/\n"));
        assert!(out.contains(".unity-vibe/loop/"));
    }

    #[test]
    fn manifest_detection_from_fixture() {
        let with = r#"{"dependencies":{"com.unity.ugui":"1.0.0","com.uvibe.os":"file:UnityVibeOS"}}"#;
        let without = r#"{"dependencies":{"com.unity.ugui":"1.0.0"}}"#;
        assert!(manifest_str_has_uvibe(with));
        assert!(!manifest_str_has_uvibe(without));
        assert!(!manifest_str_has_uvibe("not json"));
    }

    #[test]
    fn install_plan_matches_host_os() {
        let (program, args) = install_plan();
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "powershell");
            assert!(args.iter().any(|a| a.contains("install.ps1")));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(program, "bash");
            assert!(args.iter().any(|a| a.contains("install.sh")));
        }
    }
}
