//! OS-keychain storage for the company Claude OAuth token.
//!
//! Primary store: the platform keychain via the `keyring` crate (macOS
//! Keychain, Windows Credential Manager, Linux Secret Service). Some headless /
//! minimal Linux boxes have no Secret Service daemon; there `set_token` falls
//! back to a `0600` file under the app config dir. macOS/Windows keychains are
//! effectively always available, so the file path is Linux-only in practice —
//! and it's written plaintext there (the whole point is that box has no
//! keyring), which is no worse than the CLI's own `~/.claude` credentials file.
//!
//! The token is injected as `CLAUDE_CODE_OAUTH_TOKEN` on every Claude spawn
//! (see `claude/session.rs`), never written into the game project.

use crate::error::AppResult;
use crate::store::config_dir;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "unity-vibe-studio";
const ACCOUNT: &str = "claude-oauth-token";
const FILE_NAME: &str = "secret.json";

/// Where a resolved token came from — surfaced to the UI's auth status so an
/// admin can tell keychain storage from the file fallback (or a dev env var).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSource {
    Keychain,
    File,
    Env,
}

impl TokenSource {
    pub fn as_str(self) -> &'static str {
        match self {
            TokenSource::Keychain => "keychain",
            TokenSource::File => "file",
            TokenSource::Env => "env",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct FileSecret {
    token: String,
}

/// Store `token` in the OS keychain. On keychain failure (no Secret Service,
/// locked keyring, etc.) fall back to a `0600` file. On keychain success, drop
/// any stale fallback file so the two locations can never drift.
pub fn set_token(token: &str) -> AppResult<()> {
    match keyring_entry().and_then(|e| e.set_password(token)) {
        Ok(()) => {
            if let Ok(path) = secret_file() {
                let _ = std::fs::remove_file(path);
            }
            Ok(())
        }
        Err(e) => {
            log::warn!("keychain set failed ({e}); using 0600 file fallback");
            write_file(token)
        }
    }
}

/// Resolve the stored token and its source: keychain first, then the fallback
/// file, then the `CLAUDE_CODE_OAUTH_TOKEN` env var (dev convenience on a box
/// that's already logged in). `None` if no token anywhere.
pub fn get_token() -> Option<(String, TokenSource)> {
    if let Ok(entry) = keyring_entry() {
        if let Ok(pw) = entry.get_password() {
            if !pw.is_empty() {
                return Some((pw, TokenSource::Keychain));
            }
        }
    }
    if let Some(tok) = read_file().filter(|t| !t.is_empty()) {
        return Some((tok, TokenSource::File));
    }
    match std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        Ok(v) if !v.is_empty() => Some((v, TokenSource::Env)),
        _ => None,
    }
}

/// Just the token value — spawns only need the string. See `get_token`.
pub fn token() -> Option<String> {
    get_token().map(|(t, _)| t)
}

/// Remove the token from both the keychain and the fallback file. Best-effort:
/// a missing entry / file is not an error (used by "Re-pair account").
pub fn clear_token() {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = secret_file() {
        let _ = std::fs::remove_file(path);
    }
}

fn keyring_entry() -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

fn secret_file() -> AppResult<std::path::PathBuf> {
    Ok(config_dir()?.join(FILE_NAME))
}

fn write_file(token: &str) -> AppResult<()> {
    let path = secret_file()?;
    let bytes = serde_json::to_vec(&FileSecret {
        token: token.to_string(),
    })?;
    std::fs::write(&path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_file() -> Option<String> {
    let bytes = std::fs::read(secret_file().ok()?).ok()?;
    let parsed: FileSecret = serde_json::from_slice(&bytes).ok()?;
    Some(parsed.token)
}
