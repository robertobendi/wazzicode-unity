# GSD Status

Last updated: 2026-08-20

| Phase | Status | Notes |
|---|---|---|
| 0 — discovery | ✅ done | empty repo, no GSD CLI, mirroring workflow |
| 1 — protocol/schemas | ✅ done | `@uvibe/core` |
| 2 — MCP server MVP | ✅ done | 8 tools, mock bridge, stdio transport |
| 3 — Unity package MVP | ⚠ code complete, manual verification required | Unity not runnable from shell |
| 4 — Project Brain MVP | ✅ done | detects Unity version, packages, scenes; writes 5 files |
| 5 — CLI MVP | ✅ done | init/serve/brain/doctor/verify/mcp-config |
| 6 — verification | ✅ done | vitest green; mock acceptance tests pass |
| 7 — docs | ✅ done | architecture, MCP tools, Unity package, safety, troubleshooting, manual checklist |
| 8 — screenshots + polish | ✅ done | game/scene/selected captures with multimodal image content; install-unity-package CLI; 27/27 vitest |
| 9 — one-command install | ✅ done | `bootstrap.mjs`, `uvibe setup`, per-project `.mcp.json` w/ absolute paths, marker-delimited CLAUDE.md, INSTALL.md; 32/32 vitest; idempotent end-to-end smoke verified |
| 15 — Unity CLI integration | ⚠ code complete, GUI launch unverified from this shell | `@uvibe/unity-cli` + `machine` tool group (launch/install/environment/build/headless tests/clean), auto-launch in orient/verify/diagnose, `uvibe launch|env|projects|build|test-headless|clean`, Studio "Open Unity" + onboarding launch step; 226/226 vitest |

## Honest disclosure
The Unity CLI integration was exercised against the real `unity` CLI (v1.0.0-beta.5) for
discovery, editors, projects and environment reporting, and against a fake CLI for the launch
state machine, timeouts and failure paths. **`unity open` → live bridge could not be verified from
this shell**: a Unity Editor started from an agent/headless session registers as a macOS
`BackgroundOnly` app (`lsappinfo`), never boots the editor loop, and so never starts the bridge —
verify it from a Terminal, the Unity Hub, or Studio.

Unity Editor APIs cannot be exercised from this shell. The Unity package compiles against documented Editor APIs and uses standard idioms; **runtime verification requires opening the package inside a Unity Editor**. Manual checklist in `docs/UNITY_MANUAL_TEST_CHECKLIST.md`.

## Active blockers
None as of MVP. Future phases (runtime, write tools, dashboard) are not started.
