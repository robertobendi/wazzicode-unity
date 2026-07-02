//! Project selection + validation commands.

use crate::error::AppResult;
use crate::state::AppState;
use crate::store::settings::{save, Settings};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// What the ProjectPicker needs to decide whether a folder is a usable Unity
/// project and how far along its Vibe OS setup is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// Looks like a real Unity project (has both Assets/ and ProjectSettings/).
    pub ok: bool,
    pub name: String,
    pub path: String,
    /// Parsed from ProjectSettings/ProjectVersion.txt when present.
    pub unity_version: Option<String>,
    pub has_assets: bool,
    pub has_project_settings: bool,
    /// `.unity-vibe/config.json` exists — the project has been `uvibe init`-ed.
    pub uvibe_initialized: bool,
    /// `safetyMode` from that config (read_only / confirm / autopilot), if any.
    pub safety_mode: Option<String>,
}

#[tauri::command]
pub async fn validate_unity_project(path: String) -> AppResult<ProjectInfo> {
    let root = PathBuf::from(&path);
    let has_assets = root.join("Assets").is_dir();
    let has_project_settings = root.join("ProjectSettings").is_dir();
    let unity_version = read_unity_version(&root);
    let config = root.join(".unity-vibe").join("config.json");
    let uvibe_initialized = config.is_file();
    let safety_mode = if uvibe_initialized {
        read_safety_mode(&config)
    } else {
        None
    };
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    Ok(ProjectInfo {
        ok: has_assets && has_project_settings,
        name,
        path,
        unity_version,
        has_assets,
        has_project_settings,
        uvibe_initialized,
        safety_mode,
    })
}

/// Set the focused project and record it in the recents list (dedup,
/// most-recent-first, capped at 8).
#[tauri::command]
pub async fn set_current_project(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Settings> {
    let mut settings = state.settings.write().await;
    settings.current_project = Some(path.clone());
    settings.recent_projects.retain(|p| p != &path);
    settings.recent_projects.insert(0, path);
    settings.recent_projects.truncate(8);
    save(&state.config_dir, &settings)?;
    Ok(settings.clone())
}

/// Read `m_EditorVersion:` out of ProjectSettings/ProjectVersion.txt.
fn read_unity_version(project: &Path) -> Option<String> {
    let txt = std::fs::read_to_string(
        project.join("ProjectSettings").join("ProjectVersion.txt"),
    )
    .ok()?;
    for line in txt.lines() {
        if let Some(rest) = line.strip_prefix("m_EditorVersion:") {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn read_safety_mode(config: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(config).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("safetyMode")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
}
