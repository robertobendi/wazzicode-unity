use crate::agent::{AgentModelOption, Backend};
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::Duration;

#[tauri::command]
pub async fn agent_model_catalog(backend: Backend) -> AppResult<Vec<AgentModelOption>> {
    tokio::task::spawn_blocking(move || model_catalog_blocking(backend))
        .await
        .map_err(|e| AppError::Other(format!("model catalog task failed: {e}")))?
}

fn model_catalog_blocking(backend: Backend) -> AppResult<Vec<AgentModelOption>> {
    match backend {
        // Claude has no machine-readable model catalog. These are its documented
        // stable aliases; full provider-specific model ids remain available via Custom.
        Backend::Claude => Ok(vec![
            AgentModelOption::claude(
                "sonnet",
                "Sonnet",
                crate::agent::options::claude_efforts_for(Some("sonnet")),
            ),
            AgentModelOption::claude(
                "opus",
                "Opus",
                crate::agent::options::claude_efforts_for(Some("opus")),
            ),
            AgentModelOption::claude(
                "fable",
                "Fable",
                crate::agent::options::claude_efforts_for(Some("fable")),
            ),
            AgentModelOption::claude(
                "haiku",
                "Haiku",
                crate::agent::options::claude_efforts_for(Some("haiku")),
            ),
        ]),
        Backend::Codex => codex_catalog(),
    }
}

fn codex_catalog() -> AppResult<Vec<AgentModelOption>> {
    run_codex_catalog().map_err(|error| {
        AppError::Other(format!(
            "Couldn't read the Codex model catalog. Update the Codex CLI and try again: {error}"
        ))
    })
}

fn run_codex_catalog() -> AppResult<Vec<AgentModelOption>> {
    let mut cmd = crate::proc::command("codex")?;
    // `debug models` lacks `--ignore-user-config`. It needs no credentials when
    // reading the CLI's bundled catalog, so give it an empty app-owned home to
    // prevent user provider/routing config from being loaded at all.
    let catalog_home = crate::store::config_dir()?.join("codex-catalog-home");
    std::fs::create_dir_all(&catalog_home)?;
    cmd.args(["debug", "models", "--bundled"]);
    crate::codexauth::isolate_child_environment(&mut cmd);
    cmd.env("CODEX_HOME", catalog_home);
    let out = crate::proc::output_with_timeout(cmd, Duration::from_secs(20))?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr);
        let detail = detail.lines().rev().find(|l| !l.trim().is_empty());
        return Err(AppError::Other(
            detail
                .unwrap_or("Codex rejected the model catalog command.")
                .trim()
                .into(),
        ));
    }
    parse_codex_catalog(&out.stdout)
}

#[derive(Deserialize)]
struct RawCatalog {
    models: Vec<RawModel>,
}

#[derive(Deserialize)]
struct RawModel {
    slug: String,
    display_name: Option<String>,
    description: Option<String>,
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<RawEffort>,
    visibility: Option<String>,
}

#[derive(Deserialize)]
struct RawEffort {
    effort: String,
}

fn parse_codex_catalog(bytes: &[u8]) -> AppResult<Vec<AgentModelOption>> {
    let raw: RawCatalog = serde_json::from_slice(bytes)
        .map_err(|e| AppError::Other(format!("Codex returned an unreadable model catalog: {e}")))?;
    Ok(raw
        .models
        .into_iter()
        .filter(|m| m.visibility.as_deref() == Some("list"))
        .map(|m| AgentModelOption {
            label: m.display_name.unwrap_or_else(|| m.slug.clone()),
            id: m.slug,
            description: m.description,
            default_effort: m.default_reasoning_level,
            efforts: m
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_visible_models_and_their_exact_efforts() {
        let fixture = br#"{
            "models": [
                {
                    "slug": "gpt-visible",
                    "display_name": "GPT Visible",
                    "description": "Useful",
                    "default_reasoning_level": "medium",
                    "supported_reasoning_levels": [
                        {"effort": "low"}, {"effort": "medium"}, {"effort": "max"}
                    ],
                    "visibility": "list"
                },
                {
                    "slug": "internal-review",
                    "supported_reasoning_levels": [{"effort": "high"}],
                    "visibility": "hide"
                }
            ]
        }"#;
        let models = parse_codex_catalog(fixture).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-visible");
        assert_eq!(models[0].label, "GPT Visible");
        assert_eq!(models[0].default_effort.as_deref(), Some("medium"));
        assert_eq!(models[0].efforts, ["low", "medium", "max"]);
    }

    #[test]
    fn claude_catalog_exposes_only_verified_efforts() {
        let models = model_catalog_blocking(Backend::Claude).unwrap();
        let efforts = |id: &str| {
            models
                .iter()
                .find(|model| model.id == id)
                .unwrap()
                .efforts
                .as_slice()
        };
        assert_eq!(efforts("opus"), ["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(efforts("sonnet"), ["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(efforts("fable"), ["low", "medium", "high", "xhigh", "max"]);
        assert!(efforts("haiku").is_empty());
    }
}
