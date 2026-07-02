use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Bump when the on-disk shape changes in a way that needs migration.
const CURRENT_SCHEMA_VERSION: u32 = 1;

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
    /// Admin escape hatch: flips Claude spawns to bypassPermissions.
    #[serde(default)]
    pub power_mode: bool,
    /// Preferred Claude model id, or None to let the CLI decide.
    #[serde(default)]
    pub model: Option<String>,
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

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            recent_projects: Vec::new(),
            current_project: None,
            power_mode: false,
            model: None,
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
        Ok(s) => Ok(s),
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
