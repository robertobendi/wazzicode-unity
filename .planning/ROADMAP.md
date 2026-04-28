# Unity Vibe OS — Roadmap

## Mission
Make Unity vibe-coding with Claude Code dramatically easier by exposing structured Unity state through MCP tools.

## Phases (autonomous loop)

| # | Phase | State | DoD |
|---|---|---|---|
| 0 | Repo discovery + planning | done | planning files exist; GSD terminal absent → mirror manually |
| 1 | Core schemas + bridge protocol | done | Zod schemas, error codes, envelope, JSON-RPC types |
| 2 | MCP server MVP (8 tools) | done | server starts, tools list, mock bridge returns valid envelopes |
| 3 | Unity Editor package MVP | done | bridge HTTP server, scene/selection inspectors, console capture, compile watcher |
| 4 | Project Brain MVP | done | `uvibe brain` writes 5 files |
| 5 | CLI MVP | done | init/serve/brain/doctor/verify/mcp-config |
| 6 | Tests + verification | done | vitest green, mock-mode acceptance tests pass |
| 7 | Docs | done | architecture, MCP tools, Unity package, safety, troubleshooting, manual checklist |
| 8 | Screenshots + polish | done | `unity_capture_game_view`, `unity_capture_scene_view`, `unity_capture_selected`; multimodal image content; `uvibe install-unity-package` |
| 9 | One-command install + Claude onboarding | done | `bootstrap.mjs`, `uvibe setup`, `mcp-config --write`, marker-delimited CLAUDE.md, INSTALL.md |
| 10 | Diagnostics tools | future | missing refs/scripts, prefab inspect, scriptable objects |
| 10 | Runtime tools | future | play mode, runtime inspection |
| 11 | Safety + write tools | future | snapshots, action log, GameObject mutators |
| 12 | Automation loop (`uvibe loop`) | future | task-driven autonomous loop |
| 13 | Dashboard | future | minimal web UI |

## Future tools (not yet implemented)
See `docs/MCP_TOOLS.md` "Planned" section.
