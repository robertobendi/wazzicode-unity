use crate::agent::Backend;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Bump when the on-disk shape changes in a way that needs migration.
/// v2 added backend/model selection; v3 adds per-backend reasoning defaults.
/// Older files deserialize cleanly because every added field has a default.
const CURRENT_SCHEMA_VERSION: u32 = 3;

/// Persistent user settings. Lives at `<config_dir>/settings.json`.
///
/// Every field carries a `serde` default so a settings file written by an
/// older build (missing newer keys) still deserializes cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Recently opened Unity project paths, most-recent-first.
    #[serde(default)]
    pub recent_projects: Vec<String>,
    /// The Unity project currently in focus, if any.
    #[serde(default)]
    pub current_project: Option<String>,
    /// Which coding agent drives runs. Defaults to Claude, so an existing
    /// settings file (schema v1, no such key) keeps its current behaviour.
    #[serde(default)]
    pub agent_backend: Backend,
    /// Admin escape hatch: drops the agent's permission gate (Claude:
    /// `bypassPermissions`; Codex: `--dangerously-bypass-approvals-and-sandbox`).
    #[serde(default)]
    pub power_mode: bool,
    /// Preferred Claude model id, or None to let the CLI decide.
    #[serde(default)]
    pub model: Option<String>,
    /// Preferred Codex model id, or None to let the CLI decide. Kept separate
    /// from `model` so switching backends can't hand `claude-opus-4-8` to Codex
    /// (or `gpt-5-codex` to Claude), which would fail the run outright.
    #[serde(default)]
    pub codex_model: Option<String>,
    /// Preferred Claude reasoning effort, or None to let the CLI decide.
    #[serde(default)]
    pub effort: Option<String>,
    /// Preferred Codex reasoning effort. Kept separate because Codex support is
    /// model-specific and can differ from Claude's accepted values.
    #[serde(default)]
    pub codex_effort: Option<String>,
    /// Show the raw stream / debug drawer in the UI.
    #[serde(default)]
    pub debug_drawer: bool,
    /// Set true after the first successful pair/verify. Lets the app skip the
    /// pairing gate on subsequent launches (pairing is per-machine).
    #[serde(default)]
    pub paired_ok: bool,
    /// Set true once the onboarding wizard completes. When false, the wizard
    /// subsumes the pairing gate + project pick on first run. "Redo setup"
    /// flips it back off. Defaults false so existing files re-onboard once.
    #[serde(default)]
    pub onboarded: bool,
}

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

impl Settings {
    /// The model override for `backend`, or `None` to let that CLI decide.
    /// Empty strings (a cleared text field in the UI) count as unset.
    pub fn model_for(&self, backend: Backend) -> Option<&str> {
        let raw = match backend {
            Backend::Claude => self.model.as_deref(),
            Backend::Codex => self.codex_model.as_deref(),
        };
        raw.filter(|m| !m.trim().is_empty())
    }

    pub fn effort_for(&self, backend: Backend) -> Option<&str> {
        let raw = match backend {
            Backend::Claude => self.effort.as_deref(),
            Backend::Codex => self.codex_effort.as_deref(),
        };
        raw.map(str::trim).filter(|v| !v.is_empty())
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            recent_projects: Vec::new(),
            current_project: None,
            agent_backend: Backend::default(),
            power_mode: false,
            model: None,
            codex_model: None,
            effort: None,
            codex_effort: None,
            debug_drawer: false,
            paired_ok: false,
            onboarded: false,
        }
    }
}

const FILE_NAME: &str = "settings.json";

pub fn load(config_dir: &Path) -> AppResult<Settings> {
    let path = config_dir.join(FILE_NAME);
    if !path.exists() {
        let s = Settings::default();
        save(config_dir, &s)?;
        return Ok(s);
    }
    let bytes = std::fs::read(&path)?;
    match serde_json::from_slice::<Settings>(&bytes) {
        Ok(mut s) => {
            if s.schema_version < CURRENT_SCHEMA_VERSION {
                s.schema_version = CURRENT_SCHEMA_VERSION;
                save(config_dir, &s)?;
            }
            Ok(s)
        }
        Err(_) => {
            // Corrupt file — back it up and reset to defaults so a bad edit
            // never bricks startup.
            let backup = path.with_extension("json.corrupt");
            let _ = std::fs::rename(&path, &backup);
            let s = Settings::default();
            save(config_dir, &s)?;
            Ok(s)
        }
    }
}

/// Atomic write: serialize to a temp file, then rename over the target so a
/// crash mid-write can never leave a half-written settings file.
pub fn save(config_dir: &Path, settings: &Settings) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let path = config_dir.join(FILE_NAME);
    let tmp = config_dir.join(format!("{FILE_NAME}.tmp"));
    let bytes = serde_json::to_vec_pretty(settings)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_v1_file_without_agent_backend_still_loads_as_claude() {
        // Exactly what schema v1 wrote — no `agentBackend`, no `codexModel`.
        let v1 = r#"{
            "schemaVersion": 1,
            "recentProjects": ["/Users/x/Game"],
            "currentProject": "/Users/x/Game",
            "powerMode": true,
            "model": "claude-opus-4-8",
            "debugDrawer": false,
            "pairedOk": true,
            "onboarded": true
        }"#;
        let s: Settings = serde_json::from_str(v1).expect("v1 settings must still deserialize");
        assert_eq!(s.agent_backend, Backend::Claude);
        assert_eq!(s.codex_model, None);
        assert_eq!(s.effort, None);
        assert_eq!(s.codex_effort, None);
        assert!(s.power_mode);
        assert_eq!(s.model.as_deref(), Some("claude-opus-4-8"));
    }

    #[test]
    fn model_for_is_per_backend_and_ignores_blanks() {
        let s = Settings {
            model: Some("claude-opus-4-8".into()),
            codex_model: Some("  ".into()),
            ..Settings::default()
        };
        assert_eq!(s.model_for(Backend::Claude), Some("claude-opus-4-8"));
        // A whitespace-only override must not become `--model "  "`.
        assert_eq!(s.model_for(Backend::Codex), None);
    }

    #[test]
    fn effort_for_is_per_backend_and_ignores_blanks() {
        let s = Settings {
            effort: Some("high".into()),
            codex_effort: Some(" ".into()),
            ..Settings::default()
        };
        assert_eq!(s.effort_for(Backend::Claude), Some("high"));
        assert_eq!(s.effort_for(Backend::Codex), None);
    }
}
