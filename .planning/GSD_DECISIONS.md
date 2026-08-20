# Decisions

## D-001 — GSD integration mode
GSD is only available as Claude slash commands in this environment, not a terminal binary. Mirroring workflow manually using `.planning/` files. `uvibe gsd-auto` is left as a future command and will detect a real GSD CLI if present.

## D-002 — Monorepo
pnpm workspaces. Three TS packages (`core`, `mcp-server`, `project-brain`, `safety`) plus one app (`cli`). Unity package lives outside the TS workspace.

## D-003 — Bridge protocol
HTTP localhost JSON-RPC at `127.0.0.1:38578`. Versioned (`v1`). Same envelope used both at the bridge layer and at the MCP tool result layer for consistency.

## D-004 — MCP transport
Stdio. Standard for Claude Code. No TCP port for MCP itself.

## D-005 — Schemas
Zod. Tools register Zod schemas with the MCP SDK directly.

## D-006 — Mock mode
Built into the bridge client; activated by `UVIBE_MOCK=1` env var or `--mock` CLI flag. Mock data is realistic and per-method.

## D-007 — Safety default
`read_only`. Write tools are gated by `packages/safety` and **not exposed in the MCP server in MVP**. They will be wired up only after snapshot + action log are implemented.

## D-008 — Unity APIs
Editor-only. Use `EditorSceneManager`, `Selection`, `SerializedObject`, `Application.logMessageReceivedThreaded`, `CompilationPipeline`. Console capture installs a log callback at editor load (best-effort: messages prior to package load are not captured; documented in MANUAL_TEST_CHECKLIST.md).

## D-009 — TypeScript module style
ESM, NodeNext. Top-level `await`. Node 20+ engines (compatible with installed Node 25).

## D-010 — No write tools in MVP
The brief explicitly says "Read-only first" and "Do not implement scene/prefab mutation until inspection, diagnostics, project brain, snapshots, and action logs work." MVP omits all unity_* write tools.

## D-011 — Unity's own `unity` CLI is an optional accelerator, not a dependency
Unity ships a CLI (v1.0.0-beta) that can list/install Editors, open a project with the right
version, run batch-mode builds/tests, and read the Hub registry. We wrap it in
`packages/unity-cli` and expose it as the `machine` tool group, under strict rules: never
required, never in `bootstrap.mjs`, every call `--json --non-interactive --no-banner` (a fresh
install prompts for analytics consent, and its subcommands reject the documented-as-global
`--no-pager`), every call time-bounded (`unity license status` has hung indefinitely; `unity
doctor` takes ~13s), and slow answers TTL-cached per binary.

Rejected: `unity status` for Editor liveness — it only sees Editors running Unity's *Pipeline*
package; our own `bridge.json` + PID + `Temp/UnityLockfile` are authoritative. Rejected:
`unity command`/`pipeline` as a bridge — it duplicates a small subset of what our package already
does. Rejected: batch-mode tests as the default verification path — a cold Editor start is far
slower than the live bridge, and Unity's one-process-per-project lock makes it impossible while
the user has the Editor open (`EDITOR_HOLDS_PROJECT`).

## D-012 — The agent starts Unity instead of asking the user to
`UNITY_NOT_CONNECTED` used to end a task. `unity_orient` and `unity_verify` now call the launch
state machine when the bridge is silent (config `autoLaunchEditor`, default on) and report it in
`warnings[]`; `unity_launch_editor` does it explicitly. Editor *installs* stay opt-in
(`autoInstallEditor`, default off) because they are multi-gigabyte. A launch waits for an Editor
that is already booting rather than starting a second one, which Unity's project lock would refuse.
