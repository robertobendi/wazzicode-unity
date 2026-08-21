import { promises as fs } from "node:fs";
import path from "node:path";
import { listHubProjects } from "@uvibe/unity-cli";
import {
  ensureEditorPackageCurrent,
  readEditorPackageStatus,
  resolvePackageSource,
} from "@uvibe/unity-package";
import { PRODUCT_VERSION } from "@uvibe/core";
import { refreshAgentInstructions, type AgentInstructionsOutcome } from "@uvibe/project-brain";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";
import { mcpEntryIsStale, writeMcpConfig } from "./mcpConfig.js";

/**
 * `uvibe update` — bring every Unity Vibe OS install on this machine back in line with this build.
 *
 * The MCP server self-heals the project it serves, but a machine usually has several projects and
 * only one of them is open at a time. The others drift silently: an embedded Editor package from
 * an older release, or a `.mcp.json` whose absolute path stopped resolving after the repo moved.
 * This sweeps all of them in one command.
 *
 * Projects come from the Unity Hub registry (via Unity's CLI) plus the current `--project`, so it
 * works with or without that CLI installed.
 */

export interface ProjectUpdate {
  project: string;
  /** Editor package outcome. */
  package: {
    detected: boolean;
    installMode?: string;
    from?: string;
    to?: string;
    action: "updated" | "current" | "not-installed" | "skipped" | "failed";
    detail?: string;
  };
  mcpConfig: { action: "rewritten" | "current" | "absent" | "failed"; detail?: string };
  /** The CLAUDE.md / AGENTS.md block — the agent's standing brief in that project. */
  instructions: { action: AgentInstructionsOutcome | "failed"; detail?: string };
}

export async function runUpdate(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const dryRun = parsed.flags["dry-run"] === true;
  const projects = await collectProjects(g.project, parsed.flags.all !== false);
  const results: ProjectUpdate[] = [];

  for (const project of projects) {
    results.push(await updateOne(project, { dryRun }));
  }

  const changed = results.filter(changedProject);
  if (g.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ serverVersion: PRODUCT_VERSION, dryRun, projects: results }, null, 2) + "\n",
    };
  }

  const lines: string[] = [
    `Unity Vibe OS ${PRODUCT_VERSION} — ${dryRun ? "checking" : "updating"} ${results.length} project(s)`,
    "",
  ];
  for (const r of results) {
    const pkg =
      r.package.action === "updated"
        ? `package ${r.package.from ?? "?"} → ${r.package.to ?? PRODUCT_VERSION}`
        : r.package.action === "current"
          ? `package ${r.package.from ?? PRODUCT_VERSION} (current)`
          : r.package.action === "not-installed"
            ? "package not installed"
            : `package ${r.package.action}${r.package.detail ? ` — ${r.package.detail}` : ""}`;
    const mcp =
      r.mcpConfig.action === "rewritten"
        ? ".mcp.json rewritten"
        : r.mcpConfig.action === "current"
          ? ".mcp.json ok"
          : r.mcpConfig.action === "absent"
            ? "no .mcp.json"
            : `.mcp.json ${r.mcpConfig.action}${r.mcpConfig.detail ? ` — ${r.mcpConfig.detail}` : ""}`;
    const instructions =
      r.instructions.action === "current"
        ? "instructions ok"
        : `instructions ${r.instructions.action}${r.instructions.detail ? ` — ${r.instructions.detail}` : ""}`;
    const mark = changedProject(r) ? "↑" : "·";
    lines.push(`${mark} ${r.project}`);
    lines.push(`    ${pkg}; ${mcp}; ${instructions}`);
  }
  lines.push("");
  lines.push(
    dryRun
      ? `${changed.length} project(s) would be updated. Re-run without --dry-run to apply.`
      : changed.length > 0
        ? `${changed.length} project(s) updated. Unity re-imports the package the next time each project is focused.`
        : "Everything is already up to date."
  );
  return { exitCode: 0, stdout: lines.join("\n") + "\n" };
}

/** Did this project actually need anything? Drives the summary line and the per-project marker. */
function changedProject(r: ProjectUpdate): boolean {
  return (
    r.package.action === "updated" ||
    r.mcpConfig.action === "rewritten" ||
    (r.instructions.action !== "current" && r.instructions.action !== "failed")
  );
}

async function updateOne(project: string, opts: { dryRun: boolean }): Promise<ProjectUpdate> {
  const status = await readEditorPackageStatus(project);
  const result: ProjectUpdate = {
    project,
    package: {
      detected: status.detected,
      ...(status.installMode ? { installMode: status.installMode } : {}),
      ...(status.version ? { from: status.version } : {}),
      action: "current",
    },
    mcpConfig: { action: "absent" },
    instructions: { action: "current" },
  };

  if (!status.detected) {
    result.package.action = "not-installed";
  } else if (!status.needsUpdate) {
    // A symlink or `file:` manifest install resolves to the source tree — nothing to copy.
    result.package.action = status.current === false ? "skipped" : "current";
    if (status.current === false) result.package.detail = `${status.installMode} install tracks the source tree`;
  } else if (opts.dryRun) {
    result.package.action = "updated";
    result.package.to = PRODUCT_VERSION;
  } else if (!resolvePackageSource()) {
    result.package.action = "failed";
    result.package.detail = "could not locate the unity/UnityVibeOS source";
  } else {
    const ensured = await ensureEditorPackageCurrent(project, { enabled: true });
    if (ensured.updated) {
      result.package.action = "updated";
      result.package.to = ensured.status.version ?? PRODUCT_VERSION;
    } else {
      result.package.action = "failed";
      result.package.detail = ensured.error ?? ensured.skipped;
    }
  }

  // A `.mcp.json` that names a CLI path which no longer exists (the repo moved or was renamed)
  // leaves Claude Code unable to start the server at all — silently, at launch.
  const mcpPath = path.join(project, ".mcp.json");
  try {
    const raw = await fs.readFile(mcpPath, "utf8");
    const stale = mcpEntryIsStale(raw);
    if (!stale) {
      result.mcpConfig.action = "current";
    } else if (opts.dryRun) {
      result.mcpConfig.action = "rewritten";
      result.mcpConfig.detail = stale;
    } else {
      await writeMcpConfig(project, { mock: false, bare: false });
      result.mcpConfig.action = "rewritten";
      result.mcpConfig.detail = stale;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      result.mcpConfig.action = "failed";
      result.mcpConfig.detail = error instanceof Error ? error.message : String(error);
    }
  }

  // A project set up against an older release keeps that release's instructions, which is how a
  // project ends up telling the agent to ask the user to open Unity long after it learned to do
  // it itself. Rewriting touches only the text between the markers.
  try {
    if (opts.dryRun) {
      const current = await fs.readFile(path.join(project, "CLAUDE.md"), "utf8").catch(() => null);
      result.instructions.action = current === null ? "created" : "current";
      if (current !== null && !current.includes("unity_launch_editor")) {
        result.instructions.action = "updated";
      }
    } else {
      const refreshed = await refreshAgentInstructions(project);
      result.instructions.action =
        refreshed.claudeMd !== "current" ? refreshed.claudeMd : refreshed.agentsMd;
    }
  } catch (error) {
    result.instructions.action = "failed";
    result.instructions.detail = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/** Every Unity project worth checking: the Hub registry, plus whatever `--project` points at. */
async function collectProjects(currentProject: string, includeHub: boolean): Promise<string[]> {
  const seen = new Map<string, string>();
  const add = (candidate: string) => {
    const resolved = path.resolve(candidate);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) seen.set(key, resolved);
  };

  if (await isUnityProject(currentProject)) add(currentProject);
  if (includeHub) {
    const hub = await listHubProjects();
    if (hub.ok) {
      for (const project of hub.data) {
        if (project.path && (await isUnityProject(project.path))) add(project.path);
      }
    }
  }
  return [...seen.values()];
}

async function isUnityProject(candidate: string): Promise<boolean> {
  try {
    await fs.access(path.join(candidate, "ProjectSettings", "ProjectVersion.txt"));
    return true;
  } catch {
    return false;
  }
}
