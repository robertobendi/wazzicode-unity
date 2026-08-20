import { promises as fs } from "node:fs";
import path from "node:path";
import { writeConfigIfMissing } from "@uvibe/safety";
import { DEFAULT_CONVENTIONS_MD } from "@uvibe/project-brain";
import { CommandResult, GlobalOptions } from "../options.js";

const CLAUDE_MD_BEGIN = "<!-- BEGIN unity-vibe-os -->";
const CLAUDE_MD_END = "<!-- END unity-vibe-os -->";
const AGENTS_MD_BEGIN = "<!-- BEGIN unity-vibe-os -->";
const AGENTS_MD_END = "<!-- END unity-vibe-os -->";

// Volatile per-machine state under .unity-vibe/. The heading matches the one the
// desktop app writes (commands/onboarding.rs `patch_gitignore`), so whichever
// runs second adds nothing and the file never grows a duplicate section.
const GITIGNORE_HEADING = "# foundry-unity scratch (safe to ignore)";
const GITIGNORE_ENTRIES = [
  ".unity-vibe/inbox/",
  ".unity-vibe/loop/",
  ".unity-vibe/studio/",
  ".unity-vibe/action_log.jsonl",
  ".unity-vibe/snapshots/",
  ".unity-vibe/screenshots/",
  // Unity CLI answers cached per machine, and headless test reports.
  ".unity-vibe/cache/",
  ".unity-vibe/test-results/",
];

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

  const gitignore = path.join(g.project, ".gitignore");
  out.push(`${await upsertGitignore(gitignore)} ${gitignore}`);

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

async function upsertGitignore(file: string): Promise<"created" | "updated" | "kept"> {
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return "kept";

  const prefix = current.length === 0 || current.endsWith("\n") ? current : current + "\n";
  const heading = current.includes(GITIGNORE_HEADING)
    ? ""
    : `${prefix.length ? "\n" : ""}${GITIGNORE_HEADING}\n`;
  await fs.writeFile(file, `${prefix}${heading}${missing.join("\n")}\n`, "utf8");
  return current.length === 0 ? "created" : "updated";
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
    "7. Treat `.unity-vibe/knowledge/` as the source-backed project map and `.unity-vibe/conventions.md` as project-specific rules. The MCP server refreshes the map before it is queried and marks it dirty after persistent writes.",
    "",
    "### Bridge",
    "",
    "Unity bridge runs at `127.0.0.1:38578`. It auto-starts when the Unity Editor is open with the `com.uvibe.os` package installed.",
    "",
    "If a `unity_*` tool returns `UNITY_NOT_CONNECTED`, do not stop and ask the user to open Unity: `unity_orient` and `unity_verify` already try to start the Editor themselves, and `unity_launch_editor` does it on demand. Ask the user only when that tool reports it cannot — e.g. `UNITY_CLI_UNAVAILABLE` (Unity's own `unity` CLI is not installed here) or the Editor version this project pins is missing.",
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
