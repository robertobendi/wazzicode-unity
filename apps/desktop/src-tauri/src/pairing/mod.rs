//! Hidden-PTY driver for the company-account pairing flow.
//!
//! Model: **CLI-managed credentials, no token handling by us.** We run
//! `claude setup-token` in a hidden PTY (it refuses to run without a TTY), scan
//! its output for the OAuth URL, show the employee a "send this link to your
//! admin" screen, take back the one-time code the admin returns, and type it
//! into the PTY. The Claude CLI then stores its OWN credentials in `~/.claude`;
//! all later `claude` spawns just inherit the parent environment and use those.
//! We never capture, store, log, or inject any token — a detected
//! `sk-ant-oat01-…` in the transcript is used ONLY as an early "the exchange
//! succeeded" signal so we can stop waiting on the CLI's TUI (it stays open
//! after login). Success is decided by a cheap verify probe, not by us holding a
//! credential.
//!
//! Observed `claude setup-token` output (CLI 2.1.198, macOS), which drove the
//! parser design:
//!   - Auth URL host is **`claude.com`** (`https://claude.com/cai/oauth/authorize
//!     ?…&redirect_uri=https%3A%2F%2Fplatform.claude.com%2F…`) — NOT claude.ai.
//!   - The CLI hard-wraps the URL at the PTY width. We therefore open a very
//!     wide PTY (1000 cols) so the ~230-char URL lands on ONE line; extraction
//!     then only trusts a URL on a newline-terminated (complete) line, so a URL
//!     split across two `read()`s is never captured half-formed.
//!   - It prints "Paste code here if prompted >" — matched for `prompt_seen`.
//!   - It tries to auto-open a browser ("Opening browser to sign in…"); we set
//!     `BROWSER` to a no-op on unix to discourage that (best-effort; macOS may
//!     still open it — harmless, the employee is told to forward the link).
//!
//! Threading mirrors the terminal manager: one reader thread owns the whole
//! lifecycle (read loop → child exit → outcome), a watchdog thread enforces the
//! 10-minute cap, and writes go through a per-session locked writer. At most one
//! pairing is active at a time.

use crate::error::{AppError, AppResult};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

mod parse;
pub use parse::verify_probe;
use parse::{find_oauth_url, find_token, looks_like_prompt, strip_ansi, tail, failure_reason};

/// A very wide PTY so the CLI never wraps the (~230 char) OAuth URL across
/// lines — see module docs. Height is irrelevant for a hidden PTY.
const PTY_COLS: u16 = 1000;
const PTY_ROWS: u16 = 50;

/// Overall pairing deadline. The admin has to open the link, approve, and send
/// a code back — generous, but finite so a walked-away pairing can't leak a
/// child process forever.
const OVERALL_TIMEOUT: Duration = Duration::from_secs(600);

/// How long after code submission we let `claude setup-token` linger before
/// killing it on purpose and letting the verify probe decide. The CLI keeps
/// its TUI open after a successful login (observed live), so "wait for exit"
/// alone would hang until OVERALL_TIMEOUT and then wrongly report failure.
const POST_SUBMIT_GRACE_SECS: u64 = 90;

/// Bytes of ANSI-stripped tail kept for the "Show details" escape hatch on a
/// failed pairing.
const RAW_TAIL_BYTES: usize = 2048;

/// Transcript cap — we only ever need the URL/token/prompt, which appear early,
/// but the accumulated buffer must stay bounded against a chatty CLI.
const TRANSCRIPT_CAP: usize = 64 * 1024;

/// The pairing state machine, mirrored to the UI on every transition via the
/// `pairing:update` event (and readable on demand via `snapshot()`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingState {
    pub phase: Phase,
    /// The OAuth URL to forward to the admin (set at `AwaitingAdmin`).
    pub oauth_url: Option<String>,
    /// Always `"cli_managed"` on success (kept for UI compat; the UI stays quiet
    /// about it). We don't manage tokens — the CLI holds its own credentials.
    pub mode: Option<String>,
    /// Friendly failure message (set at `Failed`).
    pub error: Option<String>,
    /// Last ~2KB of ANSI-stripped output, for the failure "Show details" pane.
    pub raw_tail: Option<String>,
    /// True once the CLI has prompted for the code — lets the UI enable the
    /// input deterministically (belt-and-suspenders; it's enabled on URL too).
    pub prompt_seen: bool,
    /// Id of the active pairing, echoed back in `submit_code`.
    pub pairing_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Starting,
    AwaitingAdmin,
    Submitting,
    Verifying,
    Paired,
    Failed,
}

impl PairingState {
    fn idle() -> Self {
        Self {
            phase: Phase::Idle,
            oauth_url: None,
            mode: None,
            error: None,
            raw_tail: None,
            prompt_seen: false,
            pairing_id: None,
        }
    }
}

/// One live pairing: the locked writer and killable child.
struct Active {
    id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    /// We killed the child ON PURPOSE (token already captured, or post-submit
    /// grace expired) — resolve the outcome via the verify probe instead of the
    /// exit status. `claude setup-token` keeps its TUI open after a successful
    /// login (observed live, CLI 2.1.198), so waiting for a clean exit hangs.
    intentional: Arc<AtomicBool>,
}

/// Shared behind an `Arc` so the reader/watchdog threads can publish state and
/// deregister themselves. Held in `AppState`.
#[derive(Clone, Default)]
pub struct PairingManager {
    shared: Arc<Shared>,
}

#[derive(Default)]
struct Shared {
    active: Mutex<Option<Active>>,
    state: Mutex<Option<PairingState>>,
}

impl Shared {
    /// Mutate the canonical state and emit the snapshot. Single publish path so
    /// the on-demand `snapshot()` and the event stream can never disagree.
    fn publish(&self, app: &AppHandle, next: PairingState) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = Some(next.clone());
        let _ = app.emit("pairing:update", &next);
    }
}

impl PairingManager {
    /// Start a pairing. Kills any pre-existing one (start-over safety), spawns
    /// `claude setup-token` in a hidden wide PTY, and returns the pairing id.
    pub fn start(&self, app: AppHandle) -> AppResult<String> {
        // At most one active pairing — replace any leftover.
        self.kill_active();

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: PTY_ROWS,
                cols: PTY_COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("openpty: {e}")))?;

        let Some(claude) = crate::proc::resolve("claude") else {
            return Err(AppError::Other(
                "The Claude CLI couldn't be found. Please install it, then try again.".into(),
            ));
        };

        let mut cmd = CommandBuilder::new(claude);
        cmd.arg("setup-token");
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
        // CommandBuilder clears env on Windows; pass the parent env through as-is,
        // then override only the terminal setup. We skip COLUMNS/LINES so a stray
        // parent value can't re-introduce URL wrapping (we rely on the wide PTY
        // winsize below).
        for (k, v) in std::env::vars() {
            if matches!(k.as_str(), "TERM" | "PATH" | "BROWSER" | "COLUMNS" | "LINES") {
                continue;
            }
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("PATH", crate::proc::search_path());
        // Discourage the CLI from auto-opening a browser on the employee's box
        // (best-effort; see module docs).
        #[cfg(unix)]
        cmd.env("BROWSER", "/usr/bin/true");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(format!("could not start Claude: {e}")))?;
        // Slave dropped here so the master reader sees EOF when the child exits.

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(format!("clone reader: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(format!("take writer: {e}")))?;

        let id = nanoid::nanoid!(10);
        let cancelled = Arc::new(AtomicBool::new(false));
        let timed_out = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let intentional = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(child));

        *self.shared.active.lock().unwrap_or_else(|e| e.into_inner()) = Some(Active {
            id: id.clone(),
            writer: Arc::new(Mutex::new(writer)),
            child: child.clone(),
            cancelled: cancelled.clone(),
            finished: finished.clone(),
            intentional: intentional.clone(),
        });

        let mut starting = PairingState::idle();
        starting.phase = Phase::Starting;
        starting.pairing_id = Some(id.clone());
        self.shared.publish(&app, starting);
        log::info!("pairing {id}: started setup-token");

        spawn_watchdog(child.clone(), finished.clone(), timed_out.clone());
        self.spawn_reader(
            app,
            reader,
            child,
            id.clone(),
            cancelled,
            timed_out,
            finished,
            intentional,
        );

        Ok(id)
    }

    /// Type the admin's one-time code into the PTY. Appends the platform newline
    /// so the CLI's line-reader accepts it, then moves to `Submitting`.
    pub fn submit_code(&self, app: AppHandle, pairing_id: &str, code: &str) -> AppResult<()> {
        let (writer, child, cancelled, finished, intentional) = {
            let guard = self.shared.active.lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_ref() {
                Some(a) if a.id == pairing_id => (
                    a.writer.clone(),
                    a.child.clone(),
                    a.cancelled.clone(),
                    a.finished.clone(),
                    a.intentional.clone(),
                ),
                _ => return Err(AppError::Other("This pairing is no longer active.".into())),
            }
        };
        // ConPTY wants CRLF; a real pty on unix takes CR as Enter.
        #[cfg(windows)]
        let line = format!("{}\r\n", code.trim());
        #[cfg(not(windows))]
        let line = format!("{}\r", code.trim());

        let mut w = writer.lock().unwrap_or_else(|e| e.into_inner());
        w.write_all(line.as_bytes())
            .map_err(|e| AppError::Other(format!("could not submit code: {e}")))?;
        w.flush()
            .map_err(|e| AppError::Other(format!("could not submit code: {e}")))?;
        drop(w);

        // Preserve the URL/prompt fields already in state.
        if let Some(mut st) = self.snapshot() {
            st.phase = Phase::Submitting;
            self.shared.publish(&app, st);
        }
        log::info!("pairing {pairing_id}: code submitted");

        // The CLI accepts the code, prints its success screen, and (observed
        // live) keeps the TUI open rather than exiting. The reader resolves
        // early the moment a token appears in the stream; this grace watchdog
        // covers the no-token variant (CLI stored its own credentials): if the
        // child is still alive after the grace period, kill it on purpose and
        // let the verify probe decide the outcome honestly.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(POST_SUBMIT_GRACE_SECS));
            if !finished.load(Ordering::SeqCst) && !cancelled.load(Ordering::SeqCst) {
                log::info!("pairing: post-submit grace expired; resolving via verify probe");
                intentional.store(true, Ordering::SeqCst);
                let _ = child.lock().unwrap_or_else(|e| e.into_inner()).kill();
            }
        });
        Ok(())
    }

    /// Cancel the active pairing (kills the child; the reader exits quietly) and
    /// return to `Idle`.
    pub fn cancel(&self, app: AppHandle) {
        self.kill_active();
        self.shared.publish(&app, PairingState::idle());
    }

    /// Latest known state, for the UI to reconcile after a reload/reopen.
    pub fn snapshot(&self) -> Option<PairingState> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Kill and forget any active pairing. Marks it cancelled first so its
    /// reader emits nothing on the resulting EOF.
    fn kill_active(&self) {
        let active = self
            .shared
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(active) = active {
            active.cancelled.store(true, Ordering::SeqCst);
            let mut child = active.child.lock().unwrap_or_else(|e| e.into_inner());
            let _ = child.kill();
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_reader(
        &self,
        app: AppHandle,
        mut reader: Box<dyn Read + Send>,
        child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
        id: String,
        cancelled: Arc<AtomicBool>,
        timed_out: Arc<AtomicBool>,
        finished: Arc<AtomicBool>,
        intentional: Arc<AtomicBool>,
    ) {
        let shared = self.shared.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending: Vec<u8> = Vec::new();
            let mut transcript = String::new();
            let mut url_seen = false;
            let mut prompt_seen = false;
            let mut token_seen = false;
            let mut oauth_url: Option<String> = None;

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // A cancel / start-over already published a fresh state
                        // (or Idle) — stop so this dying reader can't clobber it.
                        if cancelled.load(Ordering::SeqCst) {
                            break;
                        }
                        pending.extend_from_slice(&buf[..n]);
                        // Emit only the longest valid-UTF-8 prefix; keep any
                        // trailing partial codepoint for the next read.
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(e) => e.valid_up_to(),
                        };
                        if valid > 0 {
                            transcript.push_str(&String::from_utf8_lossy(&pending[..valid]));
                            pending.drain(..valid);
                        }
                        // Safety net for a stream that never forms valid UTF-8.
                        if pending.len() > 16 * 1024 {
                            transcript.push_str(&String::from_utf8_lossy(&pending));
                            pending.clear();
                        }
                        cap_front(&mut transcript, TRANSCRIPT_CAP);

                        if !url_seen {
                            if let Some(url) = find_oauth_url(&transcript) {
                                url_seen = true;
                                oauth_url = Some(url.clone());
                                let mut st = PairingState::idle();
                                st.phase = Phase::AwaitingAdmin;
                                st.pairing_id = Some(id.clone());
                                st.oauth_url = Some(url);
                                st.prompt_seen = prompt_seen;
                                shared.publish(&app, st);
                            }
                        }
                        if !prompt_seen && looks_like_prompt(&transcript) {
                            prompt_seen = true;
                            // Only surface once we already have a URL to show.
                            if url_seen {
                                let mut st = PairingState::idle();
                                st.phase = Phase::AwaitingAdmin;
                                st.pairing_id = Some(id.clone());
                                st.oauth_url = oauth_url.clone();
                                st.prompt_seen = true;
                                shared.publish(&app, st);
                            }
                        }
                        if !token_seen && find_token(&transcript).is_some() {
                            // A token on screen means the exchange succeeded. We
                            // do NOT capture or store it — it's only a signal to
                            // stop waiting on the CLI's TUI (it stays open after
                            // login). Resolve now via the post-loop verify path.
                            token_seen = true;
                            log::info!("pairing {id}: exchange succeeded; resolving early");
                            intentional.store(true, Ordering::SeqCst);
                            let mut st = PairingState::idle();
                            st.phase = Phase::Verifying;
                            st.pairing_id = Some(id.clone());
                            st.oauth_url = oauth_url.clone();
                            st.prompt_seen = prompt_seen;
                            shared.publish(&app, st);
                            let _ = child.lock().unwrap_or_else(|e| e.into_inner()).kill();
                        }
                    }
                    Err(_) => break,
                }
            }

            finished.store(true, Ordering::SeqCst);
            let status = child.lock().unwrap_or_else(|e| e.into_inner()).wait();

            // A cancel/start-over already published Idle — say nothing more.
            if cancelled.load(Ordering::SeqCst) {
                shared.active.lock().unwrap_or_else(|e| e.into_inner()).take();
                return;
            }

            let stripped = strip_ansi(&transcript);
            let raw_tail = tail(&stripped, RAW_TAIL_BYTES);
            let did_timeout = timed_out.load(Ordering::SeqCst);
            // An intentional kill (token captured, or post-submit grace) is a
            // success path: the verify probe is the honest arbiter, not the
            // exit status of a child we killed ourselves.
            let intentional_finish = intentional.load(Ordering::SeqCst);
            let exit_ok = intentional_finish
                || (status.map(|s| s.success()).unwrap_or(false) && !did_timeout);

            let _ = token_seen; // success signal only; nothing captured/stored
            let outcome = if exit_ok {
                resolve_outcome()
            } else if did_timeout {
                Outcome::Failed("Pairing timed out. Please start over.".into())
            } else {
                Outcome::Failed(
                    failure_reason(&stripped)
                        .unwrap_or_else(|| "Pairing didn't complete. Please try again.".into()),
                )
            };

            let mut st = PairingState::idle();
            st.pairing_id = Some(id.clone());
            st.raw_tail = Some(raw_tail);
            match outcome {
                Outcome::Paired => {
                    st.phase = Phase::Paired;
                    st.mode = Some("cli_managed".into());
                    st.oauth_url = oauth_url;
                }
                Outcome::Failed(reason) => {
                    st.phase = Phase::Failed;
                    st.error = Some(reason);
                    st.oauth_url = oauth_url;
                }
            }
            shared.publish(&app, st);
            shared.active.lock().unwrap_or_else(|e| e.into_inner()).take();
        });
    }
}

enum Outcome {
    Paired,
    Failed(String),
}

/// Decide the outcome after `setup-token` finished (or we killed it on the
/// success path). We store nothing — the CLI holds its own credentials — so the
/// honest arbiter is a cheap probe against those credentials.
fn resolve_outcome() -> Outcome {
    match verify_probe() {
        Ok(()) => Outcome::Paired,
        Err(_) => Outcome::Failed(
            "Pairing finished but the account check didn't pass. Please try again.".into(),
        ),
    }
}

/// Watchdog: after the overall deadline, kill the child if the reader hasn't
/// already finished. Flags `timed_out` so the outcome reports a timeout rather
/// than a generic failure.
fn spawn_watchdog(
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    finished: Arc<AtomicBool>,
    timed_out: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + OVERALL_TIMEOUT;
        while std::time::Instant::now() < deadline {
            if finished.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if !finished.load(Ordering::SeqCst) {
            timed_out.store(true, Ordering::SeqCst);
            let _ = child.lock().unwrap_or_else(|e| e.into_inner()).kill();
        }
    });
}

/// Keep only the last `cap` bytes of the transcript (the URL/token appear early
/// and are captured incrementally, so dropping the front is safe). Trims to a
/// char boundary so the `String` stays valid UTF-8.
fn cap_front(s: &mut String, cap: usize) {
    if s.len() <= cap {
        return;
    }
    let mut cut = s.len() - cap;
    while cut < s.len() && !s.is_char_boundary(cut) {
        cut += 1;
    }
    s.replace_range(..cut, "");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_front_trims_to_char_boundary() {
        let mut s = "α".repeat(100); // 2 bytes each => 200 bytes
        cap_front(&mut s, 50);
        assert!(s.len() <= 50);
        assert!(s.chars().all(|c| c == 'α')); // never split a codepoint
    }
}
