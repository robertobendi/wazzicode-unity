use crate::bridge::StatusTask;
use crate::claude::SessionManager;
use crate::gitutil::Checkpoint;
use crate::looprunner::LoopManager;
use crate::pairing::PairingManager;
use crate::store::settings::Settings;
use std::collections::HashMap;
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
    /// The hidden-PTY company-account pairing driver (one active at a time).
    pub pairing: PairingManager,
    /// The single active auto-mode loop, if any.
    pub loops: LoopManager,
    /// The last studio checkpoint taken per project (before a chat turn), used
    /// by `revert_last`. Keyed by project path.
    pub checkpoints: Mutex<HashMap<PathBuf, Checkpoint>>,
}

impl AppState {
    pub fn new(config_dir: PathBuf, settings: Settings) -> Self {
        Self {
            settings: RwLock::new(settings),
            config_dir,
            sessions: SessionManager::default(),
            status_task: Mutex::new(None),
            pairing: PairingManager::default(),
            loops: LoopManager::default(),
            checkpoints: Mutex::new(HashMap::new()),
        }
    }
}
