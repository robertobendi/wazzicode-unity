//! App-managed `--mcp-config` writer.
//!
//! Mirrors `apps/cli/src/commands/mcpConfig.ts:buildEntry`: the entry runs the
//! uvibe CLI's `serve` command via Node with `UVIBE_PROJECT` pointing at the
//! Unity project, so Claude's headless run gets the `unity-vibe-os` MCP server
//! without touching the game repo's own `.mcp.json`.
//!
//! We key the file by a stable hash of the project path so multiple projects
//! don't collide, and rewrite it on every chat send (cheap, self-healing).

use crate::error::AppResult;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Write `<config_dir>/mcp/<projectHash>.json` and return its path.
/// `config_dir` is the app's config dir (already `.../unity-vibe-studio`).
pub fn ensure_mcp_config(config_dir: &Path, project: &Path) -> AppResult<PathBuf> {
    let dir = config_dir.join("mcp");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!("{}.json", project_hash(project)));

    let (command, args) = uvibe_command();
    let config = serde_json::json!({
        "mcpServers": {
            "unity-vibe-os": {
                "command": command,
                "args": args,
                "env": { "UVIBE_PROJECT": project.to_string_lossy() }
            }
        }
    });
    std::fs::write(&file, serde_json::to_vec_pretty(&config)?)?;
    Ok(file)
}

/// First 16 hex chars of SHA-256 over the project path — short but collision-
/// safe enough to name a per-project file (mcp config, capture image, …).
pub fn project_hash(project: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(16);
    for b in digest.iter().take(8) {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// Resolve how to launch the MCP server.
///
// B6: replace with the bundled sidecar — a Node 20 `externalBin` plus the
// esbuild-bundled `uvibe.cjs` shipped as a Tauri resource, version-locking the
// MCP server to the app release. Until then we shell out to the monorepo CLI
// through the system `node`.
fn uvibe_command() -> (String, Vec<String>) {
    if let Some(entry) = dev_uvibe_entry() {
        return entry;
    }
    log::warn!("uvibe CLI entry not found; falling back to `uvibe serve` on PATH");
    ("uvibe".into(), vec!["serve".into()])
}

/// Locate the monorepo CLI (`apps/cli/bin/uvibe`) for dev builds and return
/// `(node, [uvibe, "serve"])`. Tries walking up from the running executable
/// first (covers `tauri dev` where the binary sits under `target/`), then the
/// compile-time manifest dir.
fn dev_uvibe_entry() -> Option<(String, Vec<String>)> {
    let node = crate::proc::resolve("node")?
        .to_string_lossy()
        .into_owned();

    let make = |uvibe: &Path| (node.clone(), vec![uvibe.to_string_lossy().into_owned(), "serve".into()]);

    // 1. Walk up from the current exe.
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            let candidate = d.join("apps").join("cli").join("bin").join("uvibe");
            if candidate.is_file() {
                return Some(make(&candidate));
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }

    // 2. Compile-time manifest dir: apps/desktop/src-tauri → ../../.. = repo root.
    let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("apps")
        .join("cli")
        .join("bin")
        .join("uvibe");
    if candidate.is_file() {
        return Some(make(&candidate));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_and_short() {
        let a = project_hash(Path::new("/Users/x/Game"));
        let b = project_hash(Path::new("/Users/x/Game"));
        let c = project_hash(Path::new("/Users/x/Other"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }
}
