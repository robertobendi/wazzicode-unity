//! Project selection + validation commands.

use crate::error::AppResult;
use crate::state::AppState;
use crate::store::settings::{save, Settings};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

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
pub async fn set_current_project(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Settings> {
    // Project access is an implementation detail of Studio, not a setup task the
    // user should have to understand — so a project that has never been set up
    // gets a working config here rather than an error later.
    ensure_project_access(Path::new(&path))?;

    // Opening a project is the moment to make sure its install still matches this build: a
    // project set up against an older release carries an older Editor package and older agent
    // instructions, and both change behaviour silently. Fire-and-forget so opening never blocks
    // or fails on it; the UI hears about it only when something actually changed.
    spawn_project_self_heal(app, path.clone());

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
    fn self_heal_summary_names_each_repair_and_stays_silent_when_nothing_changed() {
        let nothing = serde_json::json!({
            "projects": [{
                "package": { "action": "current", "from": "0.6.0" },
                "mcpConfig": { "action": "current" },
                "instructions": { "action": "current" }
            }]
        });
        // An install that was already current must not toast at the user for opening a project.
        assert!(summarize_self_heal(&nothing).is_empty());

        let repaired = serde_json::json!({
            "projects": [{
                "package": { "action": "updated", "from": "0.5.2", "to": "0.6.0" },
                "mcpConfig": { "action": "rewritten" },
                "instructions": { "action": "updated" }
            }]
        });
        let lines = summarize_self_heal(&repaired);
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("0.5.2 → 0.6.0"));
        assert!(lines[1].contains(".mcp.json"));
        assert!(lines[2].contains("agent instructions"));
    }

    #[test]
    fn self_heal_summary_tolerates_output_it_does_not_recognise() {
        assert!(summarize_self_heal(&serde_json::json!({})).is_empty());
        assert!(summarize_self_heal(&serde_json::json!({ "projects": "nope" })).is_empty());
    }

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

/// Payload of the `project:self-heal` event: what opening this project had to repair.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealReport {
    pub project: String,
    /// Human-readable summary of each repair, empty when the install was already current.
    pub repaired: Vec<String>,
}

/// Run `uvibe update` for one project in the background and announce anything it fixed.
///
/// Deliberately silent on failure: a machine without the CLI resolved, a project mid-move, or a
/// permission problem must not stop the user opening their project. Whatever it could not fix is
/// still reported by `uvibe doctor` and by unity_diagnose_connection.
fn spawn_project_self_heal(app: AppHandle, project: String) {
    tauri::async_runtime::spawn(async move {
        let (cmd, prefix) = crate::mcpconfig::resolve_uvibe(&app);
        let args = vec![
            "update".to_string(),
            "--project".to_string(),
            project.clone(),
            "--json".to_string(),
        ];
        let command = match crate::mcpconfig::resolved_uvibe_command(&cmd, &prefix, &args) {
            Ok(command) => command,
            Err(error) => {
                log::warn!("project self-heal could not start: {error}");
                return;
            }
        };
        let output = tokio::task::spawn_blocking(move || {
            crate::proc::output_with_timeout(command, Duration::from_secs(120))
        })
        .await;
        let stdout = match output {
            Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).to_string(),
            Ok(Err(error)) => {
                log::warn!("project self-heal failed: {error}");
                return;
            }
            Err(error) => {
                log::warn!("project self-heal task failed: {error}");
                return;
            }
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout.trim()) else {
            return;
        };
        let repaired = summarize_self_heal(&value);
        if repaired.is_empty() {
            return;
        }
        log::info!("project self-heal repaired: {}", repaired.join("; "));
        let _ = app.emit("project:self-heal", SelfHealReport { project, repaired });
    });
}

/// Turn `uvibe update --json` into the one-line-per-repair list the UI shows. Pure, so the
/// wording is testable without spawning anything.
pub fn summarize_self_heal(value: &serde_json::Value) -> Vec<String> {
    let mut repaired = Vec::new();
    let Some(projects) = value.get("projects").and_then(|p| p.as_array()) else {
        return repaired;
    };
    for project in projects {
        if project.pointer("/package/action").and_then(|a| a.as_str()) == Some("updated") {
            let from = project
                .pointer("/package/from")
                .and_then(|v| v.as_str())
                .unwrap_or("an older build");
            let to = project
                .pointer("/package/to")
                .and_then(|v| v.as_str())
                .unwrap_or("this build");
            repaired.push(format!("Updated the Unity package ({from} → {to})"));
        }
        if project.pointer("/mcpConfig/action").and_then(|a| a.as_str()) == Some("rewritten") {
            repaired.push("Repaired the agent connection (.mcp.json)".to_string());
        }
        match project
            .pointer("/instructions/action")
            .and_then(|a| a.as_str())
        {
            Some("updated") | Some("appended") => {
                repaired.push("Refreshed the project's agent instructions".to_string())
            }
            Some("created") => {
                repaired.push("Wrote the project's agent instructions".to_string())
            }
            _ => {}
        }
    }
    repaired
}
