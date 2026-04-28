# Unity Vibe OS

**Make Claude Code see and edit your Unity project.**

A local MCP server + Unity Editor package + project brain. Claude gets 11 tools, including 3 multimodal screenshots — it literally sees your Game and Scene views. Read-only by default. Everything runs on `127.0.0.1`.

---

## 🚀 Use it (3 steps)

### Step 1 — Install (one command)

Paste this prompt into Claude Code from anywhere:

> **Install Unity Vibe OS into my Unity project. Run exactly:**
> `node /ABS/PATH/TO/wazzicode-unity/bootstrap.mjs /ABS/PATH/TO/MyUnityProject`
> **It's idempotent. When it finishes, tell me the next steps.**

Or run it yourself:

```bash
node /ABS/PATH/TO/wazzicode-unity/bootstrap.mjs /ABS/PATH/TO/MyUnityProject
```

That single command installs deps, builds, drops the Unity package into `Packages/manifest.json`, generates `.unity-vibe/`, writes a per-project `.mcp.json` (Claude Code auto-discovers it), and updates `CLAUDE.md` with usage rules. Idempotent — safe to re-run.

### Step 2 — Open Unity, restart Claude Code

```bash
# 1. Open the Unity project in Unity Editor — bridge auto-starts at 127.0.0.1:38578
# 2. Then in your terminal:
cd /ABS/PATH/TO/MyUnityProject
claude       # approve the unity-vibe-os MCP server when prompted
```

Optionally: `claude mcp list` to confirm.

### Step 3 — Talk to Claude in your Unity project

Claude already read your `CLAUDE.md` and knows the workflow. Just ask:

```
What's open in Unity? What's selected? Show me the game view.
```

```
Are there any compile errors right now? Walk me through fixing them.
```

```
Inspect the selected object, capture it, and suggest three improvements.
```

```
Generate the project brain so future Claude sessions understand this game.
```

```
Why is the player not shooting? Diagnose with whatever Unity tools you have.
```

That's it.

---

## 🧰 Sample prompts you'll use again

### Sanity / health
```
Run `uvibe doctor` and tell me if anything is red.
```
```
Run `uvibe verify --mock` to confirm all 10 MVP tools are wired without Unity.
```

### After a `git pull` of this repo
```
Re-run: node /ABS/PATH/TO/wazzicode-unity/bootstrap.mjs /ABS/PATH/TO/MyUnityProject --rebuild
```

### Daily Unity work
```
Compile, then check console for warnings/errors. Summarize anything new.
```
```
Show me the scene view. What's wrong with the framing?
```
```
List the prefabs in this project that depend on the WeaponData ScriptableObject.
(Note: ScriptableObject deep-inspect tools land in a future phase; for now Claude
will use unity_inspect_selected + filesystem search.)
```

---

## 🛠 What ships

- **MCP server** with **11 tools**, three of them multimodal screenshots:
  `unity_project_summary`, `unity_get_open_scenes`, `unity_get_scene_hierarchy`,
  `unity_inspect_selected`, `unity_get_console_logs`, `unity_wait_for_compile`,
  `unity_check_git_status`, `unity_generate_project_brain`,
  **`unity_capture_game_view`**, **`unity_capture_scene_view`**, **`unity_capture_selected`**.
- **Unity Editor package** (`unity/UnityVibeOS`) — localhost HTTP JSON-RPC bridge, scene/selection inspectors, console capture, compile watcher, screenshot capture.
- **CLI** (`uvibe`) — `setup`, `init`, `serve`, `brain`, `doctor`, `verify`, `mcp-config`, `install-unity-package`.
- **Project brain** — filesystem scan (no Unity needed) → `.unity-vibe/project_brain.{md,json}`, `claude_context.md`, `conventions.md`, `config.json`.
- **Mock bridge** — every MCP tool, including screenshots, works without Unity for testing.
- **Safety layer** — read-only by default; snapshot + action-log primitives ready for write tools (not yet exposed).

---

## 🆘 If something's off

```
Run `uvibe doctor` and follow the suggestions it prints.
```

Common fixes:

- **Bridge unreachable** → open the Unity project in Unity Editor (the `com.uvibe.os` package was added by the bootstrap; bridge auto-starts on Editor load).
- **Claude doesn't see the tools** → `cd` into the Unity project and restart Claude Code; approve the `unity-vibe-os` server when prompted.
- **`tsc` errors after a pull** → re-run with `--rebuild`.
- **Port 38578 in use** → see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## 📂 Repo layout

```
bootstrap.mjs              one-command install
apps/cli/                  uvibe CLI (TypeScript)
packages/core/             protocol, schemas, errors, envelope
packages/mcp-server/       MCP server, bridge client, mock bridge, 11 tools
packages/project-brain/    Unity-project detector + brain generator
packages/safety/           config, safety mode, snapshot+action-log primitives
unity/UnityVibeOS/         Unity Editor package (C#) — installs in Unity projects
docs/                      architecture, MCP tools, Unity package, safety, manual checklist
.planning/                 plan/phases/status/verify/decisions (GSD-style)
tests/                     vitest tests + sample Unity fixture
examples/                  example MCP config and brain
INSTALL.md                 install detail (prerequisites, flags, uninstall)
```

---

## 📚 Docs

- [`INSTALL.md`](INSTALL.md) — install detail, flags, uninstall
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/MCP_TOOLS.md`](docs/MCP_TOOLS.md) — MCP tool reference (implemented + planned)
- [`docs/UNITY_PACKAGE.md`](docs/UNITY_PACKAGE.md) — Unity package internals
- [`docs/SAFETY_MODEL.md`](docs/SAFETY_MODEL.md) — safety modes, snapshots, action log
- [`docs/PROJECT_BRAIN.md`](docs/PROJECT_BRAIN.md) — what the project brain captures
- [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md) — dev loop
- [`docs/GSD_AUTOMATION.md`](docs/GSD_AUTOMATION.md) — internal GSD-style workflow
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — common issues
- [`docs/UNITY_MANUAL_TEST_CHECKLIST.md`](docs/UNITY_MANUAL_TEST_CHECKLIST.md) — what to verify inside Unity

---

## 📊 Status

- ✅ Vertical slice green: 32/32 vitest, end-to-end MCP exchange verified against the mock bridge, multimodal images decoded and rendered.
- ✅ One-command install: `bootstrap.mjs` → idempotent, per-project `.mcp.json` with absolute paths, marker-delimited `CLAUDE.md` block.
- ⚠ The Unity Editor package compiles against documented Editor APIs but **runtime verification requires opening the package inside a Unity Editor**. See [`docs/UNITY_MANUAL_TEST_CHECKLIST.md`](docs/UNITY_MANUAL_TEST_CHECKLIST.md).
- 🚧 Diagnostics, runtime/play-mode, write tools, dashboard, and `uvibe loop` are planned — see `.planning/ROADMAP.md`.

## License

MIT.
