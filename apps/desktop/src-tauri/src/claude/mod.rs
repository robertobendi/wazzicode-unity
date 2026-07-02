//! Headless Claude Code integration: flag building, the shared spawn/stream
//! core, and the per-turn chat session manager.

pub mod flags;
pub mod session;
pub mod spawn;

pub use session::SessionManager;
pub use spawn::{spawn_streaming, ChildHandle, ExitInfo};
