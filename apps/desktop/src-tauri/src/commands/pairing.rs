//! Pairing + auth commands.
//!
//! `pairing_*` drives the hidden-PTY `claude setup-token` flow (state streamed
//! on `pairing:update`). `auth_*` tracks whether this machine is connected —
//! we don't manage tokens, so "connected" is just the persisted `paired_ok`
//! flag plus a live `claude` probe against the CLI's own credentials.

use crate::error::AppResult;
use crate::pairing::PairingState;
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, State};

/// Begin pairing. Returns the pairing id used in `pairing_submit_code`. State
/// transitions arrive on the `pairing:update` event.
#[tauri::command]
pub async fn pairing_start(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    state.pairing.start(app)
}

/// Submit the admin's one-time code into the running pairing.
#[tauri::command]
pub async fn pairing_submit_code(
    app: AppHandle,
    pairing_id: String,
    code: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.pairing.submit_code(app, &pairing_id, &code)
}

/// Cancel / start over: kill the running pairing and return to idle.
#[tauri::command]
pub async fn pairing_cancel(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.pairing.cancel(app);
    Ok(())
}

/// Latest pairing state (UI refresh safety after a reload). `None` if no
/// pairing has run this session.
#[tauri::command]
pub async fn pairing_state(state: State<'_, AppState>) -> AppResult<Option<PairingState>> {
    Ok(state.pairing.snapshot())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// This machine has connected at least once (persisted flag). Cheap read —
    /// no probe (a probe costs ~$0.13 and ~15s; the app-level gate uses this).
    pub paired_ok: bool,
}

/// Whether this machine is marked connected. Read from settings only.
#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> AppResult<AuthStatus> {
    Ok(AuthStatus {
        paired_ok: state.settings.read().await.paired_ok,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthVerify {
    pub ok: bool,
    pub error: Option<String>,
}

/// Live "is this machine authenticated" check — a cheap `claude -p "…OK"` probe
/// against the CLI's own credentials (no token injected). On success, persist
/// `paired_ok=true` so the gate skips pairing next launch. Runs the subprocess
/// on a blocking thread with a hard timeout.
#[tauri::command]
pub async fn auth_verify(state: State<'_, AppState>) -> AppResult<AuthVerify> {
    let res = tokio::task::spawn_blocking(crate::pairing::verify_probe)
        .await
        .map_err(|e| crate::error::AppError::Other(format!("verify task failed: {e}")))?;

    if res.is_ok() {
        let mut s = state.settings.write().await;
        if !s.paired_ok {
            s.paired_ok = true;
            crate::store::settings::save(&state.config_dir, &s)?;
        }
    }

    Ok(match res {
        Ok(()) => AuthVerify {
            ok: true,
            error: None,
        },
        Err(e) => AuthVerify {
            ok: false,
            error: Some(e),
        },
    })
}

/// Forget the connection (clears `paired_ok`). Used by "Re-pair account"; the
/// CLI's own credentials are left untouched (use `claude logout` to switch
/// accounts). The re-pair screen then re-probes and re-pairs as needed.
#[tauri::command]
pub async fn auth_clear(state: State<'_, AppState>) -> AppResult<()> {
    let mut s = state.settings.write().await;
    s.paired_ok = false;
    crate::store::settings::save(&state.config_dir, &s)?;
    Ok(())
}
