//! Headless agent session manager (chat turns).
//!
//! Spawns the selected backend (`claude -p …` or `codex exec --json …`) per chat
//! turn via the shared [`spawn_streaming`](crate::agent::spawn) core, which
//! streams stdout (one JSON object per line) to the webview as
//! `agent:stream:<runId>`. On exit this manager emits either `agent:done:<runId>`
//! (a terminal result was seen) or `agent:error:<runId>` (crash / never produced
//! a result, or user cancellation). Stream *parsing* into chat messages happens
//! in the webview (`src/lib/streamMapper.ts`, which reduces both vocabularies);
//! Rust stays a thin, dumb pipe.
//!
//! Concurrency: at most one active run per project. Cancellation kills the
//! whole process group, then the reader task produces an `ExitInfo` with
//! `cancelled: true` so there's a single exit-emit code path.

use crate::agent::spawn::{friendly_spawn_error, spawn_streaming, ChildHandle, ExitInfo};
use crate::agent::Backend;
use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// One live chat run: the cancellation handle plus the project it targets.
struct RunHandle {
    handle: ChildHandle,
    project: PathBuf,
}

/// Tracks active runs. Cheap to clone (shared `Arc` map). Held in `AppState`.
#[derive(Clone, Default)]
pub struct SessionManager {
    runs: Arc<Mutex<HashMap<String, RunHandle>>>,
}

impl SessionManager {
    /// Spawn an agent run. Returns the `runId` used in the event names.
    /// Errors with `"busy"` if a run for `project` is already active.
    pub async fn start_run(
        &self,
        app: AppHandle,
        backend: Backend,
        project: PathBuf,
        prompt: String,
        args: Vec<String>,
    ) -> AppResult<String> {
        // One active run per project.
        if self.has_run_for(&project) {
            return Err(AppError::Other("busy".into()));
        }

        let run_id = nanoid::nanoid!();
        let (handle, join) =
            spawn_streaming(app.clone(), backend, run_id.clone(), &project, args, prompt)?;
        self.runs
            .lock()
            .unwrap()
            .insert(run_id.clone(), RunHandle { handle, project });

        let runs_map = self.runs.clone();
        let run_id_task = run_id.clone();
        tokio::spawn(async move {
            let info = join.await.unwrap_or_default();
            runs_map.lock().unwrap().remove(&run_id_task);
            emit_terminal(&app, backend, &run_id_task, &info);
        });

        Ok(run_id)
    }

    /// Stop a run: kills the process group. The reader then reports the run as
    /// cancelled, so `emit_terminal` emits "Stopped". No-op if already done.
    pub async fn cancel(&self, run_id: &str) {
        let handle = self
            .runs
            .lock()
            .unwrap()
            .get(run_id)
            .map(|h| h.handle.clone());
        if let Some(h) = handle {
            h.cancel().await;
        }
    }

    /// True if any chat run is active for `project`. Used for cross-exclusion
    /// with the auto-loop (loop_start refuses while a chat is in flight).
    pub fn has_run_for(&self, project: &Path) -> bool {
        self.runs
            .lock()
            .unwrap()
            .values()
            .any(|h| h.project == project)
    }
}

/// Emit the terminal `agent:done`/`agent:error` event for a finished run.
fn emit_terminal(app: &AppHandle, backend: Backend, run_id: &str, info: &ExitInfo) {
    if info.cancelled {
        let _ = app.emit(
            &format!("agent:error:{run_id}"),
            serde_json::json!({ "friendly": "Stopped.", "raw": "Run cancelled by user." }),
        );
    } else if info.result_seen {
        let _ = app.emit(
            &format!("agent:done:{run_id}"),
            serde_json::json!({
                "sessionId": info.session_id,
                "costUsd": info.cost_usd,
                "tokens": info.tokens,
                "isError": info.is_error,
                "resultText": info.result_text,
                "numTurns": info.num_turns,
            }),
        );
    } else {
        let _ = app.emit(
            &format!("agent:error:{run_id}"),
            serde_json::json!({
                "friendly": friendly_spawn_error(backend, &info.stderr_tail, info.exit_code),
                "raw": format!("{}\n(exit code: {:?})", info.stderr_tail, info.exit_code),
            }),
        );
    }
}
