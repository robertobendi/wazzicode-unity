//! Bridge status-loop commands.

use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Start (or restart) the 2s Unity bridge status poller for `project`. Emits
/// `status:update` events.
#[tauri::command]
pub async fn status_start(
    app: AppHandle,
    project: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::bridge::start_status_loop(app, &state, PathBuf::from(project)).await;
    Ok(())
}

/// Stop the status poller.
#[tauri::command]
pub async fn status_stop(state: State<'_, AppState>) -> AppResult<()> {
    crate::bridge::stop_status_loop(&state).await;
    Ok(())
}
