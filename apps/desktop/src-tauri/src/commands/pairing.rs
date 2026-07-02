//! Pairing + auth commands.
//!
//! `pairing_*` drives the hidden-PTY `claude setup-token` flow (state streamed
//! on `pairing:update`). `auth_*` inspects / verifies / clears the stored
//! company token.

use crate::error::AppResult;
use crate::pairing::PairingState;
use crate::secrets;
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
    pub has_token: bool,
    /// "keychain" | "file" | "env" | null.
    pub source: Option<String>,
}

/// Whether a company token is stored, and where it lives.
#[tauri::command]
pub async fn auth_status() -> AppResult<AuthStatus> {
    Ok(match secrets::get_token() {
        Some((_, src)) => AuthStatus {
            has_token: true,
            source: Some(src.as_str().to_string()),
        },
        None => AuthStatus {
            has_token: false,
            source: None,
        },
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthVerify {
    pub ok: bool,
    pub error: Option<String>,
}

/// Verify the stored token still works (cheap `claude -p "…OK"` probe). Runs on
/// a blocking thread — the probe spawns a subprocess with a hard timeout.
#[tauri::command]
pub async fn auth_verify() -> AppResult<AuthVerify> {
    let res = tokio::task::spawn_blocking(|| {
        let token = secrets::token();
        crate::pairing::verify_probe(token.as_deref())
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("verify task failed: {e}")))?;

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

/// Forget the stored token (keychain + file). Used by "Re-pair account".
#[tauri::command]
pub async fn auth_clear() -> AppResult<()> {
    secrets::clear_token();
    Ok(())
}
