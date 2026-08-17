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
    /// Looks like a real Unity project (has Assets/, Packages/ and ProjectSettings/).
    pub ok: bool,
    pub name: String,
    pub path: String,
    /// Parsed from ProjectSettings/ProjectVersion.txt when present.
    pub unity_version: Option<String>,
    pub has_assets: bool,
    pub has_project_settings: bool,
    /// Setup embeds the Unity package under Packages/, so its absence is fatal.
    pub has_packages: bool,
    /// `.unity-vibe/config.json` exists — the project has been `uvibe init`-ed.
    pub uvibe_initialized: bool,
    /// The canonical knowledge manifest exists — `uvibe brain` completed at
    /// least once for this project.
    pub brain_ready: bool,
    /// `safetyMode` from that config (read_only / confirm / autopilot), if any.
    pub safety_mode: Option<String>,
}

#[tauri::command]
pub async fn validate_unity_project(path: String) -> AppResult<ProjectInfo> {
    Ok(inspect_project(path))
}

/// Pure project inspection (no async, no Tauri) so onboarding can reuse it.
pub fn inspect_project(path: String) -> ProjectInfo {
    let root = PathBuf::from(&path);
    let has_assets = root.join("Assets").is_dir();
    let has_project_settings = root.join("ProjectSettings").is_dir();
    let has_packages = root.join("Packages").is_dir();
    let unity_version = read_unity_version(&root);
    let config = root.join(".unity-vibe").join("config.json");
    let uvibe_initialized = config.is_file();
    let brain_ready = crate::commands::project_map::project_map_is_initialized(&root);
    let safety_mode = if uvibe_initialized {
        read_safety_mode(&config)
    } else {
        None
    };
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    ProjectInfo {
        ok: has_assets && has_project_settings && has_packages,
        name,
        path,
        unity_version,
        has_assets,
        has_project_settings,
        has_packages,
        uvibe_initialized,
        brain_ready,
        safety_mode,
    }
}

/// Set the focused project and record it in the recents list (dedup,
/// most-recent-first, capped at 8).
#[tauri::command]
pub async fn set_current_project(path: String, state: State<'_, AppState>) -> AppResult<Settings> {
    // Project access is an implementation detail of Studio, not a setup task the
    // user should have to understand — so a project that has never been set up
    // gets a working config here rather than an error later.
    ensure_project_access(Path::new(&path))?;

    let mut settings = state.settings.write().await;
    settings.current_project = Some(path.clone());
    settings.recent_projects.retain(|p| p != &path);
    settings.recent_projects.insert(0, path);
    settings.recent_projects.truncate(8);
    save(&state.config_dir, &settings)?;
    Ok(settings.clone())
}

/// Make the selected project usable by app-managed agent runs.
///
/// A project that has never been set up gets the app-ready defaults written for
/// it. An existing config is left exactly as the user left it: the CLI already
/// writes autopilot + every write gate by default, so a narrower config (e.g.
/// `uvibe autonomy off`) is a deliberate choice, not damage to repair. A config
/// that cannot be parsed fails closed rather than being replaced, because
/// overwriting it would silently widen access the user thought was restricted.
/// The MCP server still wraps scene changes in Unity Undo and keeps its action
/// log; chat also creates a git checkpoint before each task.
pub fn ensure_project_access(project: &Path) -> AppResult<bool> {
    let dir = project.join(".unity-vibe");
    let file = dir.join("config.json");
    if file.is_file() {
        let raw = std::fs::read_to_string(&file)?;
        let config: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
            crate::error::AppError::Other(format!("Invalid {}: {error}", file.display()))
        })?;
        if !config.is_object() {
            return Err(crate::error::AppError::Other(format!(
                "Invalid {}: expected a JSON object",
                file.display()
            )));
        }
        return Ok(false);
    }

    let config = serde_json::json!({
        "safetyMode": "autopilot",
        "allowSceneWrites": true,
        "allowPrefabWrites": true,
        "allowScriptWrites": true,
        "allowAssetWrites": true,
        "allowMenuItems": true,
        "allowCodeExecution": true,
        "allowedMenuItems": ["*"],
        "autoSnapshot": true
    });

    std::fs::create_dir_all(&dir)?;
    let mut bytes = serde_json::to_vec_pretty(&config)?;
    bytes.push(b'\n');
    std::fs::write(file, bytes)?;
    Ok(true)
}

/// Read `m_EditorVersion:` out of ProjectSettings/ProjectVersion.txt.
fn read_unity_version(project: &Path) -> Option<String> {
    let txt =
        std::fs::read_to_string(project.join("ProjectSettings").join("ProjectVersion.txt")).ok()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_access_preserves_an_existing_config_verbatim() {
        let root =
            std::env::temp_dir().join(format!("unity-vibe-studio-access-{}", nanoid::nanoid!(10)));
        let config_dir = root.join(".unity-vibe");
        std::fs::create_dir_all(&config_dir).unwrap();
        let original = r#"{
              "safetyMode": "read_only",
              "allowSceneWrites": false,
              "allowCodeExecution": false,
              "bridgePort": 49999
            }"#;
        std::fs::write(config_dir.join("config.json"), original).unwrap();

        assert!(!ensure_project_access(&root).unwrap());
        assert_eq!(
            std::fs::read_to_string(config_dir.join("config.json")).unwrap(),
            original
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn project_access_writes_defaults_but_rejects_a_corrupt_config() {
        let root =
            std::env::temp_dir().join(format!("unity-vibe-studio-access-{}", nanoid::nanoid!(10)));
        std::fs::create_dir_all(&root).unwrap();

        assert!(ensure_project_access(&root).unwrap());
        assert!(!ensure_project_access(&root).unwrap());

        let file = root.join(".unity-vibe").join("config.json");
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(value["safetyMode"], "autopilot");
        for key in [
            "allowSceneWrites",
            "allowPrefabWrites",
            "allowScriptWrites",
            "allowAssetWrites",
            "allowMenuItems",
            "allowCodeExecution",
            "autoSnapshot",
        ] {
            assert_eq!(value[key], true, "{key} should be enabled");
        }
        assert_eq!(value["allowedMenuItems"], serde_json::json!(["*"]));

        std::fs::write(&file, "{ broken").unwrap();
        let error =
            ensure_project_access(&root).expect_err("corrupt safety config must not fail open");
        assert!(error.to_string().contains("Invalid"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ broken");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn project_inspection_requires_the_packages_directory() {
        let root =
            std::env::temp_dir().join(format!("unity-vibe-studio-inspect-{}", nanoid::nanoid!(10)));
        std::fs::create_dir_all(root.join("Assets")).unwrap();
        std::fs::create_dir_all(root.join("ProjectSettings")).unwrap();

        let without = inspect_project(root.to_string_lossy().into_owned());
        assert!(!without.ok);
        assert!(!without.has_packages);

        std::fs::create_dir_all(root.join("Packages")).unwrap();
        let with = inspect_project(root.to_string_lossy().into_owned());
        assert!(with.ok);
        assert!(with.has_packages);

        let _ = std::fs::remove_dir_all(root);
    }
}
