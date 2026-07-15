import { promises as fs } from "node:fs";
import path from "node:path";
import { writeConfigIfMissing } from "@uvibe/safety";
import { DEFAULT_CONVENTIONS_MD } from "@uvibe/project-brain";
import { CommandResult, GlobalOptions } from "../options.js";

const CLAUDE_MD_BEGIN = "<!-- BEGIN unity-vibe-os -->";
const CLAUDE_MD_END = "<!-- END unity-vibe-os -->";
const AGENTS_MD_BEGIN = "<!-- BEGIN unity-vibe-os -->";
const AGENTS_MD_END = "<!-- END unity-vibe-os -->";

export async function runInit(g: GlobalOptions): Promise<CommandResult> {
  const out: string[] = [];
  const cfg = await writeConfigIfMissing(g.project);
  out.push(cfg.written ? `wrote ${cfg.path}` : `kept ${cfg.path}`);

  const conv = path.join(g.project, ".unity-vibe", "conventions.md");
  if (!(await exists(conv))) {
    await fs.mkdir(path.dirname(conv), { recursive: true });
    await fs.writeFile(conv, DEFAULT_CONVENTIONS_MD, "utf8");
    out.push(`wrote ${conv}`);
  } else {
    out.push(`kept ${conv}`);
  }

  const claudeMd = path.join(g.project, "CLAUDE.md");
  const claudeStatus = await upsertAgentInstructions(
    claudeMd,
    g.project,
    CLAUDE_MD_BEGIN,
    CLAUDE_MD_END,
    "CLAUDE.md",
    "Claude Code",
  );
  out.push(`${claudeStatus} ${claudeMd}`);

  // Codex discovers repository guidance through AGENTS.md. Keep a native file
  // for each client instead of relying on Codex to know about Claude's file.
  // The marker-delimited update is idempotent and preserves existing guidance.
  const agentsMd = path.join(g.project, "AGENTS.md");
  const agentsStatus = await upsertAgentInstructions(
    agentsMd,
    g.project,
    AGENTS_MD_BEGIN,
    AGENTS_MD_END,
    "AGENTS.md",
    "Codex and other coding agents",
  );
  out.push(`${agentsStatus} ${agentsMd}`);

  if (g.json) {
    return { exitCode: 0, stdout: JSON.stringify({ project: g.project, actions: out }, null, 2) + "\n" };
  }
  return {
    exitCode: 0,
    stdout: ["Unity Vibe OS — init", ...out].join("\n") + "\n",
  };
}

async function upsertAgentInstructions(
  file: string,
  projectPath: string,
  begin: string,
  end: string,
  filename: string,
  audience: string,
): Promise<"created" | "updated" | "appended"> {
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
    await fs.writeFile(file, replaced, "utf8");
    return "updated";
  }
  // No existing markers: append, preserving user's prior content.
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(file, existing + sep + block + "\n", "utf8");
  return "appended";
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
    "- `unity_generate_project_brain` — refresh `.unity-vibe/` summaries.",
    "",
    "### Workflow rules",
    "",
    "1. After C# changes: call `unity_wait_for_compile` then `unity_get_console_logs` (`level=warning_or_error`).",
    "2. When the user references \"this\" / \"the selected\" / \"this object\": call `unity_inspect_selected` first.",
    "3. When the user asks \"how does this look\" / \"show me\" / \"what do you see\": call `unity_capture_game_view` (or `_scene_view` / `_selected`).",
    "4. Before any change that touches tracked files: `unity_check_git_status`.",
    "5. After major refactors or new packages: `unity_generate_project_brain`.",
    "6. Writes are enabled by default (`safetyMode: autopilot`); just edit — every change is Undo-wrapped and logged. If a write returns `SAFETY_MODE_BLOCKED`, the user ran `uvibe autonomy off`; ask them to run `uvibe autonomy on` rather than hand-editing `.unity-vibe/config.json`.",
    "7. Read `.unity-vibe/claude_context.md` and `.unity-vibe/conventions.md` for project-specific facts and rules.",
    "",
    "### Bridge",
    "",
    "Unity bridge runs at `127.0.0.1:38578`. It auto-starts when the Unity Editor is open with the `com.uvibe.os` package installed. If a `unity_*` tool returns `UNITY_NOT_CONNECTED`, ask the user to open Unity.",
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
