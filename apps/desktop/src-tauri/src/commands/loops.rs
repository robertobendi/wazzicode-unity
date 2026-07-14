//! Auto-mode commands: start/stop/query the autonomous dev loop.

use crate::error::{AppError, AppResult};
use crate::looprunner::{LoopOptions, LoopState};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Start an auto-mode loop for `project` toward `goal`. Writes the app-managed
/// MCP config (same as chat), snapshots current settings, and hands off to the
/// loop driver. Returns the `loopId`. Errors `"busy"` if a chat or another loop
/// is already running for the project.
#[tauri::command]
pub async fn loop_start(
    app: AppHandle,
    project: String,
    goal: String,
    options: LoopOptions,
    state: State<'_, AppState>,
) -> AppResult<String> {
    if goal.trim().is_empty() {
        return Err(AppError::Other("Describe what to build first.".into()));
    }
    let project_path = PathBuf::from(&project);
    if state.sessions.has_run_for(&project_path) {
        return Err(AppError::Other("busy: a chat is running".into()));
    }
    let mcp_config = crate::mcpconfig::ensure_mcp_config(&app, &state.config_dir, &project_path)?;
    let mcp_entry = crate::mcpconfig::mcp_entry(&app, &project_path);
    let settings = state.settings.read().await.clone();
    state
        .loops
        .start(
            app,
            project_path,
            goal,
            options,
            settings,
            mcp_config,
            mcp_entry,
        )
        .await
}

/// Stop the active loop immediately (kills the current builder/QA turn).
#[tauri::command]
pub async fn loop_stop(state: State<'_, AppState>) -> AppResult<()> {
    state.loops.stop().await;
    Ok(())
}

/// The current (or last) loop state, or `null` if no loop has run.
#[tauri::command]
pub async fn loop_state(state: State<'_, AppState>) -> AppResult<Option<LoopState>> {
    Ok(state.loops.state().await)
}
