//! Build the argument vector for a headless `claude -p` run.
//!
//! Verified against the installed Claude Code CLI 2.1.198. The prompt is NOT
//! an argument — it's written to the child's stdin (see `session.rs`).

use crate::store::settings::Settings;
use std::path::Path;

/// Per-run inputs, distinct from the persisted `Settings`.
pub struct FlagInput<'a> {
    /// App-managed `--mcp-config` file (see `mcpconfig.rs`).
    pub mcp_config_path: &'a Path,
    /// Continue an existing Claude session (multi-turn chat) when set.
    pub resume_session_id: Option<&'a str>,
}

/// Tools we hand Claude. `--allowedTools` is variadic (`<tools...>`), so each
/// entry is pushed as its own argv element after the flag. `mcp__unity-vibe-os`
/// (no `__tool` suffix) whitelists every tool exposed by that MCP server, so
/// Claude can drive Unity without us enumerating all 60-odd `unity_*` tools.
/// Bash is deliberately absent — employees never get a shell through the app.
const ALLOWED_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "MultiEdit",
    "TodoWrite",
    "WebFetch",
    "mcp__unity-vibe-os",
];

/// Assemble the full argv (everything after the `claude` program name).
pub fn build_args(settings: &Settings, input: &FlagInput) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    // Admin "Power mode" removes the per-tool permission prompts entirely;
    // otherwise we run in acceptEdits (file edits auto-approved, unknown/
    // dangerous tools still gated). `unity_*` writes stay double-gated by the
    // project's own `.unity-vibe/config.json` regardless.
    args.push("--permission-mode".into());
    args.push(if settings.power_mode {
        "bypassPermissions".into()
    } else {
        "acceptEdits".into()
    });

    // Variadic: flag once, then one arg per tool. The next token is a `--`
    // flag, which stops the collection.
    args.push("--allowedTools".into());
    for tool in ALLOWED_TOOLS {
        args.push((*tool).to_string());
    }

    // App-managed MCP config, and *only* that config — `--strict-mcp-config`
    // ignores any project `.mcp.json`, so machine-specific paths never leak
    // into the game repo and no interactive server-approval is needed.
    args.push("--mcp-config".into());
    args.push(input.mcp_config_path.to_string_lossy().into_owned());
    args.push("--strict-mcp-config".into());

    if let Some(model) = settings.model.as_deref().filter(|m| !m.is_empty()) {
        args.push("--model".into());
        args.push(model.to_string());
    }

    if let Some(sid) = input.resume_session_id.filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }

    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn base_settings() -> Settings {
        Settings::default()
    }

    #[test]
    fn includes_core_flags_and_variadic_tools() {
        let cfg = PathBuf::from("/tmp/mcp.json");
        let args = build_args(
            &base_settings(),
            &FlagInput {
                mcp_config_path: &cfg,
                resume_session_id: None,
            },
        );
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        // Variadic tools each present as their own arg.
        assert!(args.contains(&"mcp__unity-vibe-os".to_string()));
        assert!(args.contains(&"Read".to_string()));
        // Default (non-power) permission mode.
        let i = args.iter().position(|a| a == "--permission-mode").unwrap();
        assert_eq!(args[i + 1], "acceptEdits");
        // No resume when session id absent.
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn power_mode_flips_permission_mode() {
        let mut s = base_settings();
        s.power_mode = true;
        let cfg = PathBuf::from("/tmp/mcp.json");
        let args = build_args(
            &s,
            &FlagInput {
                mcp_config_path: &cfg,
                resume_session_id: Some("sess-123"),
            },
        );
        let i = args.iter().position(|a| a == "--permission-mode").unwrap();
        assert_eq!(args[i + 1], "bypassPermissions");
        let r = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[r + 1], "sess-123");
    }

    #[test]
    fn model_appended_when_set() {
        let mut s = base_settings();
        s.model = Some("claude-opus-4-8".into());
        let cfg = PathBuf::from("/tmp/mcp.json");
        let args = build_args(
            &s,
            &FlagInput {
                mcp_config_path: &cfg,
                resume_session_id: None,
            },
        );
        let m = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[m + 1], "claude-opus-4-8");
    }
}
