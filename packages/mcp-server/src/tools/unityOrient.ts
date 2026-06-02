import { z } from "zod";
import { ToolEnvelope } from "@uvibe/core";
import { brainAgeMs } from "@uvibe/project-brain";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall, ok } from "./_helpers.js";
import { unityCheckGitStatus } from "./unityCheckGitStatus.js";

/**
 * One-call session bootstrap. Instead of Claude making 6 separate round trips to understand the
 * project at the start of a task, unity_orient fans them out in parallel and returns a single
 * compact snapshot: identity, open scenes, current selection, compile status, recent problems, git
 * state, and project-brain freshness. Read-only; every section degrades gracefully to an error
 * marker if the bridge or git is unavailable, so a partial answer is still useful.
 */

const InputShape = {
  problemLimit: z.number().int().min(0).max(200).optional().describe("Max recent warning/error logs to include (default 20)."),
};

export const unityOrient: ToolDef<typeof InputShape, unknown> = {
  name: "unity_orient",
  description:
    "Session bootstrap: returns project summary, open scenes, current selection, compile status, recent warnings/errors, git status, and project-brain age in ONE call. Call this first when starting work in a Unity project instead of issuing those reads separately. Read-only.",
  requires: ["unity_bridge", "git", "project_brain"],
  inputShape: InputShape,
  async run(args, ctx) {
    const problemLimit = args.problemLimit ?? 20;
    const warnings: string[] = [];
    const section = (label: string, env: ToolEnvelope<unknown>): unknown => {
      if (env.ok) return env.data;
      warnings.push(`${label}: ${env.error.code}`);
      return { unavailable: env.error.code };
    };

    const [summary, scenes, selection, compile, problems, git, ageMs] = await Promise.all([
      bridgeCall(ctx.bridge, BRIDGE_METHODS.systemSummary),
      bridgeCall(ctx.bridge, BRIDGE_METHODS.sceneGetOpenScenes),
      bridgeCall(ctx.bridge, BRIDGE_METHODS.selectionInspect, { includeFields: false }),
      bridgeCall(ctx.bridge, BRIDGE_METHODS.compileStatus),
      bridgeCall(ctx.bridge, BRIDGE_METHODS.consoleGetLogs, { level: "warning_or_error", limit: problemLimit }),
      unityCheckGitStatus.run({}, ctx),
      brainAgeMs(ctx.projectPath).catch(() => null),
    ]);

    const bridgeReachable = summary.ok;
    if (!bridgeReachable) warnings.push("Unity bridge not reachable — open the Editor for live state.");

    const data = {
      bridgeReachable,
      summary: section("summary", summary),
      openScenes: section("openScenes", scenes),
      selection: section("selection", selection),
      compile: section("compile", compile),
      recentProblems: section("recentProblems", problems),
      git: section("git", git),
      brain: { exists: ageMs !== null, ageMs: ageMs ?? undefined, stale: ageMs !== null && ageMs > 24 * 3_600_000 },
    };

    return ok(data, { source: ctx.bridge.source, durationMs: 0 }, warnings);
  },
};
