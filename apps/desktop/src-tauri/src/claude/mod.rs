//! Headless Claude Code integration: flag building + the per-turn session
//! manager that spawns `claude -p` and streams its output to the webview.

pub mod flags;
pub mod session;

pub use session::SessionManager;
