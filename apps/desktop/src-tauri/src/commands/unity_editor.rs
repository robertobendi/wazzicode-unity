//! Unity Editor lifecycle for the desktop app.
//!
//! Studio can only do anything once a Unity Editor is actually running with the UnityVibeOS
//! package — until then every tool call fails and the user has to go and open Unity themselves.
//! Unity's own `unity` CLI removes that step, and `uvibe` already wraps it (`uvibe env`,
//! `uvibe launch`, `uvibe projects`), so these commands shell out to the same CLI the MCP server
//! uses rather than reimplementing binary discovery, timeouts and JSON parsing in Rust.
//!
//! Every command returns the CLI's JSON verbatim so the webview can render new fields without a
//! Rust change, and a missing Unity CLI is a normal payload (`cli.available: false`), not an error.

use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;

/// `uvibe env` is filesystem + Hub metadata only; it should answer in well under a second.
const ENV_TIMEOUT: Duration = Duration::from_secs(45);
/// A cold Editor start plus first-time asset import can legitimately take minutes.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(420);

/// Machine-side Unity environment for a project: Unity CLI presence, installed Editor versions,
/// the version this project requires, and whether an Editor currently holds it.
#[tauri::command]
pub async fn unity_editor_environment(app: AppHandle, project: String) -> AppResult<Value> {
    let command = uvibe(&app, &["env", "--project", &project, "--json"])?;
    run_json(command, ENV_TIMEOUT).await
}

/// Start the Unity Editor for a project (installing its Editor version first when `install`).
/// With `wait` false this returns as soon as the launch is underway and the status poller picks
/// the bridge up on its own.
#[tauri::command]
pub async fn unity_editor_launch(
    app: AppHandle,
    project: String,
    install: Option<bool>,
    wait: Option<bool>,
) -> AppResult<Value> {
    let mut args: Vec<String> = vec![
        "launch".into(),
        "--project".into(),
        project,
        "--json".into(),
    ];
    if install.unwrap_or(false) {
        args.push("--install".into());
    }
    if !wait.unwrap_or(true) {
        args.push("--no-wait".into());
    }
    let command = uvibe_owned(&app, args)?;
    run_json(command, LAUNCH_TIMEOUT).await
}

/// The Unity Hub's project registry — path, Editor version, render pipeline — for the picker.
#[tauri::command]
pub async fn unity_hub_projects(app: AppHandle) -> AppResult<Value> {
    let command = uvibe(&app, &["projects", "--json"])?;
    run_json(command, ENV_TIMEOUT).await
}

fn uvibe(app: &AppHandle, args: &[&str]) -> AppResult<Command> {
    uvibe_owned(app, args.iter().map(|a| a.to_string()).collect())
}

fn uvibe_owned(app: &AppHandle, args: Vec<String>) -> AppResult<Command> {
    let (cmd, prefix) = crate::mcpconfig::resolve_uvibe(app);
    crate::mcpconfig::resolved_uvibe_command(&cmd, &prefix, &args)
}

/// Run a uvibe subcommand off the async runtime and parse its JSON.
///
/// A non-zero exit is not necessarily a failure here: `uvibe launch` exits 1 when it could not
/// reach a live Editor and 3 when the Unity CLI is missing, and in both cases stdout carries the
/// structured explanation the UI wants to show. So we parse first and only error when there is
/// nothing to parse.
async fn run_json(command: Command, timeout: Duration) -> AppResult<Value> {
    let output = tokio::task::spawn_blocking(move || crate::proc::output_with_timeout(command, timeout))
        .await
        .map_err(|e| AppError::Other(format!("unity CLI task failed: {e}")))??;
    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<Value>(stdout.trim()) {
        Ok(value) => Ok(value),
        Err(_) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                "no output".to_string()
            };
            Err(AppError::Other(format!("uvibe returned no JSON: {detail}")))
        }
    }
}
