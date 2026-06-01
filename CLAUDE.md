# CLAUDE.md — Unity Vibe OS

This repository builds **Unity Vibe OS**, a local Unity-aware operating layer for Claude Code. It exposes Unity project state to Claude through MCP tools (`unity_*`) so Claude does not have to guess from .unity / .prefab YAML or hidden inspector state.

## How to work in this repo

- TypeScript monorepo (pnpm workspaces). Three packages + one CLI app + one Unity Editor package.
- ESM, NodeNext, strict TS. Imports use `.js` extensions even from `.ts` source.
- `pnpm build` builds all packages in topological order.
- `pnpm test` runs vitest (TS source via vite alias — no pre-build needed for tests).
- `node apps/cli/bin/uvibe <command>` runs the CLI.

## How Claude (the agent reading this file) should behave

- Prefer the `unity_*` MCP tools over reading raw `.unity` / `.prefab` YAML or shelling out to inspect the project.
- When the user says "this object" or "the selected one", call `unity_inspect_selected` first.
- Treat write tools as gated by `.unity-vibe/config.json#safetyMode`. Default is `read_only`. Do not bypass.
- Use `unity_check_git_status` before suggesting any change that modifies tracked files.
- Use `unity_generate_project_brain` (or `uvibe brain`) to refresh `.unity-vibe/` after major work.

### Canonical edit loop (follow this without being told)

After **any** C# change:
1. `unity_wait_for_compile` (it rides through the script-domain reload automatically).
2. `unity_get_console_logs` (level=`warning_or_error`) — confirm no new errors.
3. `unity_run_tests` (EditMode; add PlayMode for runtime behaviour) — this is the ground truth that the code *works*, not just compiles. Use `filter` to scope to the area you touched.

For runtime / "does it actually play" questions:
- `unity_enter_play_mode` → observe with `unity_get_console_logs`, `unity_find_runtime_objects` + `unity_inspect_runtime_object`, `unity_capture_game_view`, and `unity_get_performance_stats` → `unity_exit_play_mode`. Use `unity_step_frame` to advance deterministically. Profiler counters (draw calls, GC, FPS) only accrue while playing.

For "why is my scene/prefab broken":
- `unity_find_missing_scripts`, `unity_find_missing_references` (dangling links → runtime NREs), and `unity_find_references` / `unity_find_dependencies` to trace the asset graph before deleting/renaming.

### When the bridge is unavailable

- `UNITY_RELOADING` — the bridge is mid script-domain reload (post-compile or entering play). It is **recoverable**; tool calls already retry for ~20s. Just wait; don't treat it as fatal.
- `UNITY_NOT_CONNECTED` — no Unity Editor with the UnityVibeOS package is running for this project. Ask the user to open Unity, then `uvibe doctor`.
- `PROJECT_IDENTITY_MISMATCH` — a Unity Editor answered but for a different project (the client auto-discovers the bridge via `Library/UnityVibeOS/bridge.json` and verifies project identity). Ask the user to open the correct project.
- `TEST_FRAMEWORK_MISSING` — `unity_run_tests` needs `com.unity.test-framework`; suggest installing it.

## Useful CLI

- `uvibe doctor` — health check (MCP, bridge, brain, git, config).
- `uvibe brain` — refresh project brain.
- `uvibe verify --mock` — MVP acceptance checks against the mock bridge.
- `uvibe mcp-config` — print Claude MCP config snippet.
- `uvibe init` — create `.unity-vibe/` scaffold.
- `uvibe serve` — start the MCP server (used in your Claude config).

## Internal planning

Plan / phase / status / verify / decisions live in `.planning/`. The format mirrors GSD; this repo does not require a GSD CLI.

## Limits

- Unity Editor APIs cannot run from this shell. The Unity package compiles against documented APIs and follows standard idioms; runtime verification is the user's job (see `docs/UNITY_MANUAL_TEST_CHECKLIST.md`).
- Write tools are wired and gated by `safetyMode`: scene edits (`unity_set_serialized_field`, `unity_assign_reference`, `unity_add_component`, `unity_create_gameobject`, `unity_instantiate_prefab`, `unity_wire_ui_button`, `unity_save_scene`), asset creators (`unity_create_scriptable_object`, `unity_create_material`), prefab (`unity_create_prefab_variant`), and `unity_clear_console`. All are blocked under the default `read_only`; the user must opt in via `.unity-vibe/config.json` (`confirm`/`autopilot` + the relevant `allow*Writes` flag — scene/prefab/script). Every Unity mutation is wrapped in Unity's Undo system (Ctrl+Z) and recorded to `.unity-vibe/action_log.jsonl`.
- The Test Framework integration lives in a separate assembly guarded by `UNITY_INCLUDE_TESTS`, so the core bridge still compiles when `com.unity.test-framework` is absent.
