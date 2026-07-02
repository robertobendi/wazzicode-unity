//! Live game/scene capture for the activity panel.
//!
//! Calls the Unity bridge's `screenshot.gameView` / `screenshot.sceneView`
//! method (result carries a base64 PNG), decodes it, and overwrites a single
//! per-project file under `<config_dir>/captures/`. The webview renders it via
//! `convertFileSrc` + a cache-busting query param, so a stable filename is
//! exactly what we want. The captures dir is granted to Tauri's asset-protocol
//! scope at startup (see lib.rs).

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    /// Absolute path to the freshly-written PNG.
    pub png_path: String,
}

/// Capture the game (or scene) view and write it to the per-project capture
/// file. Returns the path for the frontend to render. Bubbles up the friendly
/// bridge error codes (UNITY_NOT_CONNECTED / UNITY_RELOADING / …) on failure.
#[tauri::command]
pub async fn bridge_capture(
    project: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<CaptureResult> {
    let project_path = PathBuf::from(&project);
    let method = match kind.as_str() {
        "scene" => "screenshot.sceneView",
        // Default to the game view for anything else (incl. "game").
        _ => "screenshot.gameView",
    };
    let params = serde_json::json!({ "width": 960, "height": 540, "format": "png" });

    let result = crate::bridge::call(&project_path, method, params).await?;
    let b64 = result
        .get("pngBase64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Other("bridge returned no image".into()))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::Other(format!("decode image: {e}")))?;

    let dir = state.config_dir.join("captures");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!(
        "{}-latest.png",
        crate::mcpconfig::project_hash(&project_path)
    ));
    std::fs::write(&file, bytes)?;

    Ok(CaptureResult {
        png_path: file.to_string_lossy().into_owned(),
    })
}
