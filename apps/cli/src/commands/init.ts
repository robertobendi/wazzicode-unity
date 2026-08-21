import { promises as fs } from "node:fs";
import path from "node:path";
import { writeConfigIfMissing } from "@uvibe/safety";
import { DEFAULT_CONVENTIONS_MD, refreshAgentInstructions } from "@uvibe/project-brain";
import { CommandResult, GlobalOptions } from "../options.js";

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

  // Codex discovers repository guidance through AGENTS.md, Claude Code through CLAUDE.md. Both
  // get the same marker-delimited block; rewriting it preserves everything outside the markers.
  // The renderer lives in @uvibe/project-brain so `uvibe update` and the MCP server's start-up
  // self-update can refresh a project that was set up against an older release.
  const refreshed = await refreshAgentInstructions(g.project);
  out.push(`${refreshed.claudeMd} ${path.join(g.project, "CLAUDE.md")}`);
  out.push(`${refreshed.agentsMd} ${path.join(g.project, "AGENTS.md")}`);

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

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
