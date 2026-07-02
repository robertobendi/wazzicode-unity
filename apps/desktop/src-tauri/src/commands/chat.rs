//! Chat commands: spawn/cancel a headless Claude run against a project.

use crate::claude::flags::{build_args, FlagInput};
use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Start a chat turn. Writes the app-managed MCP config, builds the argv from
/// current settings, spawns Claude, and returns the `runId` the frontend
/// subscribes to (`claude:stream:<runId>`, `claude:done:<runId>`,
/// `claude:error:<runId>`). Errors with `"busy"` if a run is already active
/// for the project.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    project: String,
    prompt: String,
    resume_session_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let project_path = PathBuf::from(&project);
    // Chat and auto mode are mutually exclusive per project.
    if state.loops.is_running_for(&project_path).await {
        return Err(crate::error::AppError::Other("busy: auto mode is running".into()));
    }
    let mcp_config = crate::mcpconfig::ensure_mcp_config(&app, &state.config_dir, &project_path)?;
    let settings = state.settings.read().await.clone();
    let args = build_args(
        &settings,
        &FlagInput {
            mcp_config_path: &mcp_config,
            resume_session_id: resume_session_id.as_deref(),
        },
    );
    state
        .sessions
        .start_run(app, project_path, prompt, args)
        .await
}

/// Stop the active run (kills the Claude process tree). No-op if it already
/// finished.
#[tauri::command]
pub async fn chat_cancel(run_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.sessions.cancel(&run_id).await;
    Ok(())
}
