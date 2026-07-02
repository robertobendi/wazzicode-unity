use crate::bridge::StatusTask;
use crate::claude::SessionManager;
use crate::store::settings::Settings;
use std::path::PathBuf;
use tokio::sync::{Mutex, RwLock};

/// Application state shared across Tauri commands.
///
/// Held by Tauri as `tauri::State<AppState>`. Fields are async-locked so
/// command handlers can read/write without blocking the runtime.
pub struct AppState {
    pub settings: RwLock<Settings>,
    pub config_dir: PathBuf,
    /// Headless Claude runs (one active per project). Cheap to clone.
    pub sessions: SessionManager,
    /// The single running bridge status poller, if any.
    pub status_task: Mutex<Option<StatusTask>>,
}

impl AppState {
    pub fn new(config_dir: PathBuf, settings: Settings) -> Self {
        Self {
            settings: RwLock::new(settings),
            config_dir,
            sessions: SessionManager::default(),
            status_task: Mutex::new(None),
        }
    }
}
