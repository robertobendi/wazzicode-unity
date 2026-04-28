# Safety model

Unity Vibe OS is **read-only by default**. Write tools are not exposed in the MVP. The safety package designs the gate that future write tools will pass through.

## Modes

Set in `.unity-vibe/config.json#safetyMode`. Default: `read_only`.

| Mode | Behavior |
|---|---|
| `read_only` | All write tools blocked with `SAFETY_MODE_BLOCKED`. Inspection, diagnostics, screenshots, brain generation are allowed. |
| `suggest` | Write tools return a structured proposed change instead of applying it. |
| `confirm` | Write tools allowed only for tool categories explicitly enabled in config. Snapshots required if `autoSnapshot=true`. |
| `autopilot` | Same as `confirm` but without per-call confirmation prompts. Still gated by per-category flags and snapshots. |

## Per-category flags

```json
{
  "allowSceneWrites": false,
  "allowPrefabWrites": false,
  "allowScriptWrites": true,
  "autoSnapshot": true
}
```

Even in `autopilot`, scene/prefab writes need their flag set. Script writes default to allowed because Claude Code already edits source files.

## Snapshots

`packages/safety/snapshot.ts` exposes:

- `createSnapshot(projectPath, files: string[])` — copies files into `.unity-vibe/snapshots/<ISO>/` with a manifest.
- `listSnapshots(projectPath)` — newest-first.
- `restoreSnapshot(projectPath, id)` — copies files back.

Future write tools must `createSnapshot` before mutation when `autoSnapshot=true` or refuse with `WRITE_REQUIRES_SNAPSHOT`.

## Action log

Every write attempt — success, error, or blocked — is appended as JSONL to `.unity-vibe/action_log.jsonl`. Tool: `unity_list_ai_actions` (planned). Entry shape:

```json
{
  "timestamp": 1714327200000,
  "tool": "unity_set_serialized_field",
  "args": {"path": "...", "field": "...", "value": "..."},
  "result": "ok|error|blocked",
  "errorCode": null,
  "snapshotId": "2026-04-28T19-22-14-001Z",
  "notes": null
}
```

## Hard rules (from the brief)

- Bridge bound only to `127.0.0.1`. No remote exposure.
- No arbitrary shell execution exposed via MCP tools.
- No edits to `.unity` / `.prefab` YAML; mutations go through Unity Editor APIs.
- Never delete assets permanently — moved to `.unity-vibe/trash/` with explicit override.
- Never mass-rename or mass-move assets without an explicit task plan.

## Why write tools are not yet exposed

The brief is explicit: "Do not implement scene/prefab mutation until inspection, diagnostics, project brain, snapshots, and action logs work." Inspection ✓, brain ✓, snapshot+action-log primitives ✓, but the mutation handlers themselves are deliberately not yet wired through the MCP server. Shipping them without verifiable end-to-end safety would defeat the point.
