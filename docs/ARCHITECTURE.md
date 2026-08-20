# Architecture

```
                  Claude Code
                       │
                       │ MCP (stdio)
                       ▼
            ┌──────────────────────┐
            │ @uvibe/mcp-server    │  ◀── tools registry, mock bridge, bridge client
            └──────────┬───────────┘
                       │ HTTP JSON-RPC (127.0.0.1:38578)
                       ▼
            ┌──────────────────────┐
            │  UnityVibeOS pkg     │  ◀── HttpListener + main-thread dispatcher
            │  (Unity Editor)      │      Inspectors / ConsoleCapture / CompileWatcher
            └──────────┬───────────┘
                       │ UnityEditor APIs
                       ▼
                Unity Project
```

## Packages

| Package | Purpose |
|---|---|
| `@uvibe/core` | Protocol types, Zod schemas, error codes, envelope helpers, version constants. Has no Unity or MCP knowledge. |
| `@uvibe/mcp-server` | MCP server (stdio), 8 MVP tools, HTTP bridge client, mock bridge. Depends on core, project-brain, safety. |
| `@uvibe/project-brain` | Filesystem-only Unity detector + brain generator. Writes `.unity-vibe/`. Depends on core, safety. |
| `@uvibe/safety` | Config schema, safety-mode evaluator, snapshot + action-log primitives. |
| `@uvibe/unity-cli` | Optional adapter for Unity's own `unity` CLI: binary discovery, JSON-envelope exec with hard timeouts, TTL cache, editor/environment queries, the launch state machine, batch-mode build/test/clean, NUnit report parsing. Never throws and never a hard dependency — every entry point degrades when the CLI is absent. Depends on core + bridge-client (it needs the bridge only to *probe* liveness). |
| `@uvibe/cli` (`uvibe`) | Init/serve/brain/doctor/verify/mcp-config commands, plus the Unity-CLI-backed launch/env/projects/build/test-headless/clean. Each is testable as a function (no spawn). |
| `unity/UnityVibeOS` | Unity Editor C# package. HttpListener bridge + inspectors. |

## Two envelopes

The brief specifies two intentionally different shapes; we implement both.

**Bridge envelope** (Unity ↔ MCP server):

```json
{ "id": "...", "ok": true, "result": {...}, "error": null,
  "meta": { "unityVersion": "...", "projectPath": "...", "durationMs": 12 } }
```

**Tool envelope** (MCP server → Claude):

```json
{ "ok": true, "data": {...}, "warnings": [],
  "meta": { "source": "unity_bridge|mock|git|project_brain|filesystem",
            "durationMs": 12, "detailLevel": "summary|normal|full" } }
```

Errors keep the same shape on both layers but only the tool envelope adds `recoverable` and `suggestedAction`.

Helper functions live in `@uvibe/core/envelope.ts` (`ok`, `err`, `timed`).

## Threading in Unity

`HttpListener` callbacks land on the threadpool. All Unity Editor APIs require the main thread. Each request is parsed on the listener thread, then queued via `MainThreadDispatcher` to run on `EditorApplication.update`. The listener thread blocks on a `ManualResetEventSlim` (15s timeout) and writes the response after the main thread completes.

## Module style

ESM throughout. NodeNext module resolution. Source imports use `.js` extensions (per Node ESM rules). Vitest aliases workspace package names to `src/index.ts` so tests don't require a build step.

## Bridge protocol versioning

Versioned at `1.0`. Breaking changes bump the major version (`2.0`). Minor evolutions (added optional fields) keep `1.x`. The version is sent on every request and echoed implicitly via response shape.
