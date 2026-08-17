# Install Unity Vibe OS

> **For Claude reading this:** if a user gave you this repo and asked you to set it up in their Unity project, you only need to run **one command**. Skip the rest of this file unless that command fails.

## TL;DR (one command)

```bash
node /absolute/path/to/wazzicode-unity/bootstrap.mjs /absolute/path/to/UnityProject
```

That's it. The script is idempotent and self-contained.

If you run it from inside a Unity project (or any subdirectory), the path argument is optional — the bootstrap walks up to find the Unity project:

```bash
cd /path/to/UnityProject
node /absolute/path/to/wazzicode-unity/bootstrap.mjs
```

## What the bootstrap does

1. Installs Node deps with `pnpm` (a real `pnpm` on PATH, else the pinned one via `corepack`). npm is not a fallback — it cannot resolve this workspace's `workspace:*` deps.
2. Builds the TypeScript packages in topological order (`tsc -p` per package; no pnpm-specific magic required).
3. Runs `uvibe setup` against the Unity project, which:
   - Writes `.unity-vibe/{config.json, conventions.md, project_brain.{md,json}, claude_context.md}`.
   - Embeds a portable copy of the package at `Packages/com.uvibe.os/`, which Unity auto-discovers (no `manifest.json` entry, so it resolves on every machine that clones the project). `--unity-install-mode=manifest` writes a `file:` dependency instead.
   - Writes `.mcp.json` at the Unity project root with **absolute paths** (no `uvibe` on PATH required).
   - Updates `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex) with marker-delimited Unity Vibe OS sections. Existing project instructions are preserved and reruns update only the managed sections.
   - Runs `uvibe doctor` for a green-light check.

## After bootstrap

1. **Open the Unity project** in Unity Editor — the bridge auto-starts on `127.0.0.1:38578`.
2. **Restart Claude Code** in the Unity project directory:
   ```bash
   cd /path/to/UnityProject
   claude
   ```
   Claude Code auto-discovers `.mcp.json` and prompts you to approve the `unity-vibe-os` server.
3. **Verify**: `claude mcp list` (or `uvibe doctor`).

That's it. Claude can now drive Unity through 75 MCP tools — including one-call **`unity_orient`** (session bootstrap), **`unity_verify`** (compile + console + tests in a single verdict), and **`unity_batch`** (apply a multi-step plan in one round trip) — plus scene/selection inspection, console + compile, **multimodal screenshots** (it can literally see your Game/Scene view), live **performance counters**, the **Test Framework runner**, play-mode control + runtime inspection, asset/reference-graph diagnostics, **autonomous scene navigation** (open / additive-load scenes), **layout editing** (set-transform, reparent), **prefab-mode editing** (open / save / apply), **play-mode input simulation**, **animator** state/parameter/transition control, a whitelisted **menu-item** escape hatch, the **2D/asset pipeline** (import, sprite slicing, tilemap painting), and the rest of the safety-gated write tools.

## Prerequisites

- Node ≥ 20
- `pnpm` ≥ 10 — required (`npm install -g pnpm`, or `brew install pnpm` on macOS). `corepack enable pnpm` also works where corepack is installed.
- A Unity project (Unity ≥ 2021.3)

## Bootstrap flags

| Flag | Effect |
|---|---|
| `--rebuild` | Force `install` + `tsc` even if artifacts exist |
| `--build-only` | Recompile only — skip install, force rebuild (use after a `git pull` that only changed TS source) |
| `--skip-install` | Skip dependency install |
| `--skip-build` | Skip TS build |
| `--skip-unity-install` | Don't install the Unity package into the project |
| `--unity-install-mode=copy\|manifest\|symlink` | How to register the Unity package (default: `copy` = portable embedded copy under `Packages/`) |

## Re-running

Safe and recommended after `git pull`. The bootstrap detects existing `node_modules` and `dist/`, skips them by default. Pass `--rebuild` to force.

## What if bootstrap fails?

Run the steps yourself:

```bash
cd /path/to/wazzicode-unity
pnpm install
pnpm build              # or: for each package, run: node node_modules/typescript/lib/tsc.js -p <package>/tsconfig.json
node apps/cli/bin/uvibe setup --project=/path/to/UnityProject
```

Each step is idempotent.

## What this DOES NOT do

- It does **not** modify `~/.claude.json` or any global config. Configuration is per-project (`.mcp.json` at the Unity project root).
- It does **not** publish anything online or phone home. Everything is local; the bridge binds to `127.0.0.1` only.
- It does **not** install anything inside Unity itself beyond the embedded package under `Packages/`. Unity will compile it on next Editor load.

## Uninstall

```bash
# 1. Remove the Unity package
rm -rf /path/to/UnityProject/Packages/com.uvibe.os
# (If you installed with --unity-install-mode=manifest instead, delete the
#  "com.uvibe.os" line from /path/to/UnityProject/Packages/manifest.json.)

# 2. Remove generated artifacts
rm /path/to/UnityProject/.mcp.json
rm -rf /path/to/UnityProject/.unity-vibe

# 3. (Optional) Strip the unity-vibe-os blocks from CLAUDE.md and AGENTS.md
# It's clearly marked: <!-- BEGIN unity-vibe-os --> ... <!-- END unity-vibe-os -->
```
