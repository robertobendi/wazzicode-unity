import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The marker-delimited Unity Vibe OS block written into a project's CLAUDE.md and AGENTS.md.
 *
 * This is the agent's standing brief inside the user's own project — where there is no wazzicode
 * CLAUDE.md — so it is where behaviour rules actually take effect. It also *rots*: a project set
 * up months ago keeps whatever the block said then, which is how a project ends up instructing the
 * agent to "ask the user to open Unity" long after the tools learned to open it themselves.
 *
 * Hence living here rather than in the CLI command: `uvibe init`, `uvibe update` and the MCP
 * server's start-up self-update all render the same block, and rewriting is idempotent and
 * preserves everything outside the markers.
 */

export const AGENT_BLOCK_BEGIN = "<!-- BEGIN unity-vibe-os -->";
export const AGENT_BLOCK_END = "<!-- END unity-vibe-os -->";

export type AgentInstructionsOutcome = "created" | "updated" | "appended" | "current";

export async function upsertAgentInstructions(
  file: string,
  projectPath: string,
  begin: string,
  end: string,
  filename: string,
  audience: string,
): Promise<AgentInstructionsOutcome> {
  const block = renderAgentBlock(projectPath, begin, end);
  if (!(await exists(file))) {
    await fs.writeFile(file, defaultAgentMd(projectPath, block, filename, audience), "utf8");
    return "created";
  }
  const existing = await fs.readFile(file, "utf8");
  if (existing.includes(begin) && existing.includes(end)) {
    const replaced = existing.replace(
      new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`),
      block
    );
    // Nothing to say when the block is already what we would write — callers report per-project.
    if (replaced === existing) return "current";
    await fs.writeFile(file, replaced, "utf8");
    return "updated";
  }
  // No existing markers: append, preserving user's prior content.
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(file, existing + sep + block + "\n", "utf8");
  return "appended";
}


/**
 * Refresh both agent files for a project. Returns what happened to each, so `uvibe update` can
 * report it and the server can stay quiet when nothing changed.
 */
export async function refreshAgentInstructions(
  projectPath: string
): Promise<{ claudeMd: AgentInstructionsOutcome; agentsMd: AgentInstructionsOutcome }> {
  const claudeMd = await upsertAgentInstructions(
    path.join(projectPath, "CLAUDE.md"),
    projectPath,
    AGENT_BLOCK_BEGIN,
    AGENT_BLOCK_END,
    "CLAUDE.md",
    "Claude Code"
  );
  const agentsMd = await upsertAgentInstructions(
    path.join(projectPath, "AGENTS.md"),
    projectPath,
    AGENT_BLOCK_BEGIN,
    AGENT_BLOCK_END,
    "AGENTS.md",
    "Codex and other coding agents"
  );
  return { claudeMd, agentsMd };
}

function renderAgentBlock(projectPath: string, begin: string, end: string): string {
  return [
    begin,
    "## Unity Vibe OS",
    "",
    "This project has **Unity Vibe OS** installed. Always prefer the `unity_*` MCP tools over reading raw `.unity` / `.prefab` YAML.",
    "",
    "### Tools at your disposal",
    "",
    "- `unity_project_summary` — Unity version, render pipeline, input system, packages.",
    "- `unity_get_open_scenes`, `unity_get_scene_hierarchy` — what's loaded and the GameObject tree.",
    "- `unity_inspect_selected` — full inspector view (transform, components, serialized fields, prefab info, missing-script warnings) of `Selection.activeGameObject`.",
    "- `unity_get_console_logs`, `unity_wait_for_compile` — feedback after C# changes.",
    "- `unity_capture_game_view`, `unity_capture_scene_view`, `unity_capture_selected` — multimodal screenshots; you literally see what the user sees.",
    "- `unity_check_git_status` — repo state before any change.",
    "- `unity_generate_project_brain` — explicitly rebuild the maintained project map.",
    "- `unity_query_project_brain` — query the maintained project map with bounded, source-backed results.",
    "- `unity_launch_editor` — start the Unity Editor for this project (right version, waits for the bridge) when none is running.",
    "- `unity_environment` — what the machine has: installed Editor versions vs. the one this project needs, whether an Editor holds the project, Unity CLI availability.",
    "- `unity_build_player`, `unity_run_tests_headless`, `unity_project_clean` — batch-mode work with the Editor closed (real player builds, headless tests, cache repair).",
    "",
    "### Workflow rules",
    "",
    "1. Start with `unity_orient({ task: \"<the current request>\" })`; use `unity_query_project_brain` for deeper project-specific questions.",
    "2. After C# changes: call `unity_verify` and do not claim success unless it passes.",
    "3. When the user references \"this\" / \"the selected\" / \"this object\": call `unity_inspect_selected` first.",
    "4. When the user asks \"how does this look\" / \"show me\" / \"what do you see\": call `unity_capture_game_view` (or `_scene_view` / `_selected`).",
    "5. Before any change that touches tracked files: `unity_check_git_status`.",
    "6. Access is app-managed; use the Unity tools directly without asking the user to change permissions or run setup commands. Changes are protected by checkpoints, Unity Undo, snapshots, and the action log.",
    "7. **Answer from the project map before you read the project.** `.unity-vibe/knowledge/` holds a generated, source-backed map of every script, scene, prefab and their relationships. `unity_orient` validates and refreshes it (it is marked dirty after writes and rebuilt when the source fingerprint changes) and returns the parts relevant to your task; `unity_query_project_brain` answers follow-ups with bounded, cited results. Grepping the whole project for something the map already knows is slower and misses the relationships. `.unity-vibe/conventions.md` holds project-specific rules.",
    "",
    "### Bridge",
    "",
    "Unity bridge runs at `127.0.0.1:38578`. It auto-starts when the Unity Editor is open with the `com.uvibe.os` package installed.",
    "",
    // Worded so the old instruction ("ask the user to open Unity") survives nowhere in the block:
    // a stale copy of that sentence is exactly what kept agents stopping instead of launching.
    "If a `unity_*` tool returns `UNITY_NOT_CONNECTED`, do not stop there. `unity_orient` and `unity_verify` already try to start the Editor themselves, and `unity_launch_editor` does it on demand. Escalate to the user only when that tool reports it cannot — e.g. `UNITY_CLI_UNAVAILABLE` (Unity's own `unity` CLI is not installed here) or the Editor version this project pins is missing.",
    "",
    "### Re-verify",
    "",
    `If anything seems off, run \`uvibe doctor --project=${projectPath}\` (or via \`node /path/to/wazzicode-unity/apps/cli/bin/uvibe doctor --project=${projectPath}\`).`,
    "",
    end,
  ].join("\n");
}

function defaultAgentMd(
  projectPath: string,
  uvibeBlock: string,
  filename: string,
  audience: string,
): string {
  const name = path.basename(projectPath);
  return [
    `# ${filename} — ${name}`,
    "",
    `Project-specific instructions for ${audience}.`,
    "",
    uvibeBlock,
    "",
  ].join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
