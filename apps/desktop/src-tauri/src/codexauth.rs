//! Codex sign-in driver.
//!
//! Same principle as the Claude pairing flow — **CLI-managed credentials, no
//! token handling by us** — but a much simpler mechanism, because `codex login`
//! doesn't need a TTY the way `claude setup-token` does. It starts a local
//! callback server, opens the browser at ChatGPT, and writes its own credentials
//! to `$CODEX_HOME/auth.json` (default `~/.codex`). We never see, store, or
//! inject a token; later `codex exec` spawns just inherit the environment and
//! use those credentials.
//!
//! So this module only has to:
//!   1. run `codex login status` to ask "are we signed in?" (exit 0 = yes);
//!   2. spawn `codex login`, scrape the sign-in URL off its output so the user
//!      can click it (or forward it) if the browser didn't open by itself;
//!   3. poll status until it flips, then stop the child.
//!
//! **Subscription only, by construction.** Plain `codex login` is the ChatGPT
//! sign-in, which bills the user's *plan*. Codex also supports an API-key login
//! (`--with-api-key`), which bills *API credits* instead — a different wallet, and
//! not one this product wants to spend from by accident. We therefore don't
//! expose that path at all, AND we scrub `OPENAI_API_KEY` from every child we
//! spawn (see [`scrub_api_key`]), because the CLI would otherwise happily pick a
//! stray env var up and silently bill credits. There is no config key to force
//! this (`preferred_auth_method` is not recognized by codex-cli 0.144.4), so
//! scrubbing the environment is the enforceable way to guarantee it.
//!
//! At most one login runs at a time.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

/// Environment variables that would make the Codex CLI authenticate with API
/// credits rather than the user's ChatGPT subscription. Removed from every child
/// we spawn — the app is subscription-only on purpose.
pub const API_KEY_ENV_VARS: &[&str] = &["OPENAI_API_KEY", "CODEX_API_KEY"];

/// Strip the API-key env vars from a command, so the child can only fall back on
/// the CLI's own stored (ChatGPT) credentials.
pub fn scrub_api_key(cmd: &mut Command) {
    for var in API_KEY_ENV_VARS {
        cmd.env_remove(var);
    }
}

/// How long we let a browser sign-in run before giving up. The user has to
/// switch to a browser, sign in, and come back — generous, but finite so a
/// walked-away login can't leak a child process forever.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// How often we re-ask `codex login status` while waiting.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Result of `codex login status`.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexAuthStatus {
    /// Is the `codex` binary on PATH at all?
    pub installed: bool,
    pub logged_in: bool,
    /// Whatever the CLI said — e.g. the signed-in account or auth mode. Shown
    /// verbatim as a subtitle; never parsed for control flow.
    pub detail: Option<String>,
}

/// Progress of an in-flight `codex login`, mirrored to the UI on every change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginUpdate {
    pub phase: LoginPhase,
    /// The ChatGPT sign-in URL, once the CLI prints it.
    pub url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginPhase {
    Starting,
    /// Waiting on the user to finish in the browser.
    AwaitingBrowser,
    Success,
    Failed,
    Cancelled,
}

/// Tracks the single in-flight login so it can be cancelled.
#[derive(Clone, Default)]
pub struct CodexLoginManager {
    child: Arc<AsyncMutex<Option<tokio::process::Child>>>,
}

impl CodexLoginManager {
    /// Ask the CLI whether we're signed in. Cheap; safe to call on every render.
    pub async fn status(&self) -> CodexAuthStatus {
        if !crate::proc::is_installed("codex") {
            return CodexAuthStatus::default();
        }
        let Ok(mut cmd) = crate::proc::command("codex") else {
            return CodexAuthStatus::default();
        };
        cmd.args(["login", "status"]);
        scrub_api_key(&mut cmd);
        let out = tokio::process::Command::from(cmd).output().await;

        match out {
            // `codex login status` exits non-zero when there are no credentials,
            // which is the whole signal — we don't try to parse "Not logged in".
            Ok(o) => {
                let text = String::from_utf8_lossy(&o.stdout);
                let detail = text
                    .lines()
                    .map(str::trim)
                    .find(|l| !l.is_empty())
                    .map(str::to_string);
                CodexAuthStatus {
                    installed: true,
                    logged_in: o.status.success(),
                    detail,
                }
            }
            Err(_) => CodexAuthStatus {
                installed: true,
                logged_in: false,
                detail: None,
            },
        }
    }

    /// Start a browser sign-in. Returns immediately; progress arrives on the
    /// `codex:login` event. Errors if a login is already running.
    ///
    /// Plain `codex login` — the ChatGPT flow, which bills the user's plan. The
    /// API-key flow (`--with-api-key`) is deliberately not offered: it spends API
    /// credits, which is a different wallet from the subscription this product is
    /// built around.
    pub async fn start(&self, app: AppHandle) -> AppResult<()> {
        {
            let guard = self.child.lock().await;
            if guard.is_some() {
                return Err(AppError::Other("A Codex sign-in is already running.".into()));
            }
        }

        let mut cmd = crate::proc::command("codex")?;
        cmd.arg("login")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        scrub_api_key(&mut cmd);
        let mut child = tokio::process::Command::from(cmd)
            .spawn()
            .map_err(|e| AppError::Other(format!("could not start Codex: {e}")))?;

        emit(&app, LoginPhase::Starting, None, None);

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.child.lock().await = Some(child);

        // Scrape the sign-in URL off whichever stream it lands on. Codex prints
        // it while it waits on the local callback, and may or may not have
        // managed to open a browser itself — so we always surface it.
        if let Some(out) = stdout {
            scan_for_url(app.clone(), out);
        }
        if let Some(err) = stderr {
            scan_for_url(app.clone(), err);
        }

        // Poll the CLI's own view of the world rather than trying to interpret
        // its output — status is the ground truth, and it's what every later
        // `codex exec` will consult too.
        let this = self.clone();
        tokio::spawn(async move {
            let deadline = tokio::time::Instant::now() + LOGIN_TIMEOUT;
            loop {
                tokio::time::sleep(POLL_INTERVAL).await;

                // Cancelled: `cancel()` took the child and killed it.
                if this.child.lock().await.is_none() {
                    emit(&app, LoginPhase::Cancelled, None, None);
                    return;
                }
                if this.status().await.logged_in {
                    this.reap().await;
                    emit(&app, LoginPhase::Success, None, None);
                    return;
                }
                if tokio::time::Instant::now() >= deadline {
                    this.reap().await;
                    emit(
                        &app,
                        LoginPhase::Failed,
                        None,
                        Some("Sign-in timed out. Try again.".into()),
                    );
                    return;
                }
            }
        });

        Ok(())
    }

    /// Cancel an in-flight sign-in.
    pub async fn cancel(&self) {
        self.reap().await;
    }

    /// Kill and clear the child, if any.
    async fn reap(&self) {
        if let Some(mut c) = self.child.lock().await.take() {
            let _ = c.start_kill();
        }
    }

    /// Forget the stored credentials (`codex logout`).
    pub async fn logout(&self) -> AppResult<()> {
        let mut cmd = crate::proc::command("codex")?;
        cmd.arg("logout");
        let _ = tokio::process::Command::from(cmd).output().await;
        Ok(())
    }
}

/// Watch one of the child's pipes for the sign-in URL and push it to the UI.
fn scan_for_url<R>(app: AppHandle, pipe: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(url) = find_url(&line) {
                emit(&app, LoginPhase::AwaitingBrowser, Some(url), None);
            }
        }
    });
}

fn emit(app: &AppHandle, phase: LoginPhase, url: Option<String>, error: Option<String>) {
    let _ = app.emit("codex:login", LoginUpdate { phase, url, error });
}

/// First `https://` URL on a line, trimmed of trailing punctuation the CLI may
/// wrap it in. Deliberately dumb — the URL is only ever *shown*, never followed.
fn find_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '<' || c == '>')
        .unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches(|c| matches!(c, '.' | ',' | ')' | ']'));
    if url.len() > "https://".len() {
        Some(url.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_sign_in_url() {
        let line = "  Open this URL to sign in: https://auth.openai.com/oauth?x=1&y=2 ";
        assert_eq!(
            find_url(line).as_deref(),
            Some("https://auth.openai.com/oauth?x=1&y=2")
        );
    }

    #[test]
    fn strips_trailing_punctuation_and_ignores_urlless_lines() {
        assert_eq!(
            find_url("Go to https://example.com/login.").as_deref(),
            Some("https://example.com/login")
        );
        assert_eq!(find_url("Starting local login server..."), None);
        // Bare scheme is not a URL.
        assert_eq!(find_url("https://"), None);
    }

    /// Money guard: a stray `OPENAI_API_KEY` in the environment would make the
    /// Codex CLI bill API credits instead of the user's ChatGPT subscription.
    /// Every Codex child must have it removed.
    #[test]
    fn api_key_env_vars_are_scrubbed_from_children() {
        let mut cmd = Command::new("codex");
        cmd.env("OPENAI_API_KEY", "sk-should-never-reach-the-child");
        cmd.env("CODEX_API_KEY", "sk-nor-this");
        cmd.env("PATH", "/usr/bin");
        scrub_api_key(&mut cmd);

        let kept: Vec<_> = cmd
            .get_envs()
            // `env_remove` records the var with a `None` value — that's the
            // removal instruction, not an inherited value.
            .filter(|(_, v)| v.is_some())
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        assert!(kept.contains(&"PATH".to_string()), "PATH must survive");
        for var in API_KEY_ENV_VARS {
            assert!(
                !kept.contains(&var.to_string()),
                "{var} must not reach a Codex child"
            );
        }
    }
}
