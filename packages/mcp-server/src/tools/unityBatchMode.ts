import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "@uvibe/safety";
import {
  buildPlayer,
  cleanProject,
  cliIdentity,
  defaultBridgeProbe,
  editorHoldsProject,
  readEditorRunningState,
  readNUnitReport,
  readProjectVersion,
  runTestsBatch,
  type BatchTestReport,
  type RunOptions,
} from "@uvibe/unity-cli";
import { ToolEnvelope } from "@uvibe/core";
import { ToolDef, ToolContext } from "../registry.js";
import { err, ok } from "./_helpers.js";
import { reportProgress } from "../interaction.js";

/**
 * Batch-mode Editor work: player builds, headless test runs, and cache cleanup.
 *
 * All three spawn a *second* Unity process against the project, and Unity only lets one process
 * own a project at a time. So they share one precondition — no Editor may be holding the project —
 * and they are the only tools here that deliberately do NOT go through the live bridge. When the
 * Editor is open, the in-Editor equivalents (unity_run_tests, unity_verify) are both faster and
 * correct; these exist for the cases where there is no Editor to talk to.
 */

interface BatchPreconditions {
  cliOpts: RunOptions;
  editorVersion?: string;
}

async function requireBatchMode(
  ctx: ToolContext,
  action: string
): Promise<BatchPreconditions | ToolEnvelope<never>> {
  if (ctx.configMockMode) {
    return err("MOCK_MODE_ACTIVE", `${action} is not simulated in mock mode.`, { source: "mock" }) as ToolEnvelope<never>;
  }
  const config = await loadConfig(ctx.projectPath);
  const cliOpts: RunOptions = config.unityCliPath ? { cliPath: config.unityCliPath } : {};

  const identity = await cliIdentity(cliOpts);
  if (!identity.available) {
    return err(
      "UNITY_CLI_UNAVAILABLE",
      `${action} needs Unity's \`unity\` CLI, which is not available here (${identity.error ?? "not installed"}).`,
      { source: "unity_cli" }
    ) as ToolEnvelope<never>;
  }

  const running = await readEditorRunningState(ctx.projectPath, defaultBridgeProbe);
  if (editorHoldsProject(running)) {
    return err(
      "EDITOR_HOLDS_PROJECT",
      `${action} needs the project to itself, but a Unity Editor is holding it${
        running.bridgeConnected ? " (the bridge is answering)" : running.lockfilePresent ? " (Temp/UnityLockfile is present)" : ""
      }.`,
      { source: "unity_cli" },
      {
        bridgeConnected: running.bridgeConnected,
        editorProcessAlive: running.editorProcessAlive,
        lockfilePresent: running.lockfilePresent,
      }
    ) as ToolEnvelope<never>;
  }

  const required = await readProjectVersion(ctx.projectPath);
  return { cliOpts, ...(required.editorVersion ? { editorVersion: required.editorVersion } : {}) };
}

function isEnvelope(value: BatchPreconditions | ToolEnvelope<never>): value is ToolEnvelope<never> {
  return "ok" in value;
}

// ---------------------------------------------------------------------------
// unity_build_player
// ---------------------------------------------------------------------------

const BuildInput = {
  target: z
    .string()
    .optional()
    .describe("Build target, e.g. StandaloneOSX, StandaloneWindows64, Android, iOS, WebGL. Required unless profile is given."),
  outputPath: z
    .string()
    .optional()
    .describe("Where to write the player. Required for Unity's built-in build; with executeMethod it is forwarded as -buildOutput."),
  profile: z
    .string()
    .optional()
    .describe("Unity 6+ build profile: a path to a .asset, or a profile name under Assets/Settings/Build Profiles. Defines the target."),
  executeMethod: z
    .string()
    .optional()
    .describe("Static C# method to run instead of the built-in build (e.g. Builder.PerformBuild)."),
  buildTargetGroup: z.string().optional(),
  timeoutMs: z.number().int().min(60_000).max(14_400_000).optional().describe("Build budget (default 45 min)."),
  extraArgs: z.string().optional().describe("Extra arguments forwarded to the Editor."),
  allowInstall: z
    .boolean()
    .optional()
    .describe("Let the CLI install the project's Editor version if it is missing (multi-GB download)."),
};

interface BuildResult {
  succeeded: boolean;
  target?: string;
  profile?: string;
  outputPath?: string;
  logFile: string;
  durationMs: number;
  /** Error lines lifted out of the Unity build log — the actionable part of a 20k-line file. */
  errors: string[];
  logTail: string[];
  detail?: Record<string, unknown>;
}

export const unityBuildPlayer: ToolDef<typeof BuildInput, BuildResult> = {
  name: "unity_build_player",
  description:
    "Builds an actual player (game executable) by running Unity in batch mode through its CLI — the step unity_get_build_settings only checks readiness for. Requires the Unity Editor to be CLOSED for this project (Unity allows one process per project) and Unity's `unity` CLI. Returns a pass/fail verdict with the compiler/build error lines extracted from the build log, plus the log path. Give either target (+outputPath) or a Unity 6 build profile.",
  requires: ["unity_cli", "filesystem"],
  write: true,
  writeTarget: "build",
  inputShape: BuildInput,
  async run(args, ctx) {
    const pre = await requireBatchMode(ctx, "Building a player");
    if (isEnvelope(pre)) return pre;
    if (!args.target && !args.profile) {
      return err("INVALID_ARGUMENT", "Give a build target (e.g. StandaloneOSX) or a Unity 6 build profile.", {
        source: "unity_cli",
      });
    }
    if (!args.profile && !args.executeMethod && !args.outputPath) {
      return err(
        "INVALID_ARGUMENT",
        "Unity's built-in build needs outputPath — the destination for the player.",
        { source: "unity_cli" }
      );
    }

    const started = Date.now();
    const logFile = path.join(
      ctx.projectPath,
      "Logs",
      `uvibe-build-${(args.target ?? args.profile ?? "profile").replace(/[^A-Za-z0-9_.-]/g, "_")}-${started}.log`
    );
    await fs.mkdir(path.dirname(logFile), { recursive: true });

    let step = 0;
    reportProgress(ctx, ++step, undefined, `building ${args.target ?? args.profile}…`);
    const build = await buildPlayer({
      projectPath: ctx.projectPath,
      ...pre.cliOpts,
      ...(args.target ? { target: args.target } : {}),
      ...(args.profile ? { profile: args.profile } : {}),
      ...(args.executeMethod ? { executeMethod: args.executeMethod } : {}),
      ...(args.outputPath ? { outputPath: path.resolve(ctx.projectPath, args.outputPath) } : {}),
      ...(args.buildTargetGroup ? { buildTargetGroup: args.buildTargetGroup } : {}),
      ...(args.extraArgs ? { extraArgs: args.extraArgs } : {}),
      ...(args.allowInstall ? { allowInstall: true } : {}),
      ...(pre.editorVersion ? { editorVersion: pre.editorVersion } : {}),
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      logFile,
      onLine: (line) => {
        if (/error|failed|exception/i.test(line)) reportProgress(ctx, ++step, undefined, line.slice(0, 160));
      },
    });

    const log = await readLogTail(logFile);
    const durationMs = Date.now() - started;
    const result: BuildResult = {
      succeeded: build.ok,
      ...(args.target ? { target: args.target } : {}),
      ...(args.profile ? { profile: args.profile } : {}),
      ...(args.outputPath ? { outputPath: path.resolve(ctx.projectPath, args.outputPath) } : {}),
      logFile,
      durationMs,
      errors: log.errors,
      logTail: log.tail,
      ...(build.ok ? { detail: build.data } : {}),
    };

    if (!build.ok) {
      return err(
        build.code === "CLI_TIMEOUT" ? "BRIDGE_TIMEOUT" : "UNITY_CLI_FAILED",
        `Build failed: ${build.message}`,
        { source: "unity_cli", durationMs },
        { ...result }
      );
    }
    return ok(result, { source: "unity_cli", durationMs }, build.warnings);
  },
};

// ---------------------------------------------------------------------------
// unity_run_tests_headless
// ---------------------------------------------------------------------------

const HeadlessTestInput = {
  mode: z.enum(["EditMode", "PlayMode"]).optional().describe("Test platform (default EditMode)."),
  filter: z.string().optional().describe("Run only tests whose names match this filter."),
  outputPath: z
    .string()
    .optional()
    .describe("Where to write the NUnit report (default .unity-vibe/test-results/…). Relative paths resolve against the project."),
  coverage: z.boolean().optional().describe("Collect code coverage (needs com.unity.testtools.codecoverage)."),
  timeoutMs: z.number().int().min(60_000).max(7_200_000).optional().describe("Run budget (default 30 min)."),
};

interface HeadlessTestResult {
  mode: string;
  pass: boolean;
  reportPath: string;
  durationMs: number;
  report?: BatchTestReport;
  detail?: Record<string, unknown>;
}

export const unityRunTestsHeadless: ToolDef<typeof HeadlessTestInput, HeadlessTestResult> = {
  name: "unity_run_tests_headless",
  description:
    "Runs the Unity Test Framework in a headless batch-mode Editor via Unity's CLI and returns parsed pass/fail counts plus failure messages. Use ONLY when no Editor can be open (CI, or the user closed Unity) — it is much slower than unity_run_tests/unity_verify because it cold-starts an Editor and re-imports, and it fails with EDITOR_HOLDS_PROJECT while the Editor is running. Prefer unity_verify whenever the bridge is live.",
  requires: ["unity_cli", "filesystem"],
  inputShape: HeadlessTestInput,
  async run(args, ctx) {
    const pre = await requireBatchMode(ctx, "A headless test run");
    if (isEnvelope(pre)) return pre;

    const mode = args.mode ?? "EditMode";
    const started = Date.now();
    const reportPath = args.outputPath
      ? path.resolve(ctx.projectPath, args.outputPath)
      : path.join(ctx.projectPath, ".unity-vibe", "test-results", `headless-${mode}-${started}.xml`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });

    let step = 0;
    reportProgress(ctx, ++step, undefined, `starting headless ${mode} tests (cold Editor start)…`);
    const run = await runTestsBatch({
      projectPath: ctx.projectPath,
      output: reportPath,
      mode,
      ...pre.cliOpts,
      ...(args.filter ? { filter: args.filter } : {}),
      ...(args.coverage ? { coverage: true } : {}),
      ...(pre.editorVersion ? { editorVersion: pre.editorVersion } : {}),
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      onLine: (line) => {
        if (/tests?|error|failed/i.test(line)) reportProgress(ctx, ++step, undefined, line.slice(0, 160));
      },
    });

    // The report is the ground truth: `unity test` exits non-zero when tests fail, which is a
    // legitimate result rather than a tool error, so parse before judging the exit code.
    const report = await readNUnitReport(reportPath);
    const durationMs = Date.now() - started;
    const pass = report ? report.failed === 0 && report.total > 0 : run.ok;
    const result: HeadlessTestResult = {
      mode,
      pass,
      reportPath,
      durationMs,
      ...(report ? { report } : {}),
      ...(run.ok ? { detail: run.data } : {}),
    };

    if (!report && !run.ok) {
      return err(
        run.code === "CLI_TIMEOUT" ? "BRIDGE_TIMEOUT" : "UNITY_CLI_FAILED",
        `Headless test run failed before producing a report: ${run.message}`,
        { source: "unity_cli", durationMs },
        { reportPath, ...(run.output ? { output: run.output } : {}) }
      );
    }
    const warnings = [
      ...(run.ok ? run.warnings : [`The CLI exited with an error (${run.message}) but a report was produced.`]),
      ...(report && report.failed > 0 ? [`${report.failed} test(s) failed.`] : []),
    ];
    return ok(result, { source: "unity_cli", durationMs }, warnings);
  },
};

// ---------------------------------------------------------------------------
// unity_project_clean
// ---------------------------------------------------------------------------

const CleanInput = {
  dryRun: z
    .boolean()
    .optional()
    .describe("List the folders that would be deleted, with sizes, and delete nothing. Default true — pass false to actually delete."),
};

interface CleanResult {
  dryRun: boolean;
  detail?: Record<string, unknown>;
}

export const unityProjectClean: ToolDef<typeof CleanInput, CleanResult> = {
  name: "unity_project_clean",
  description:
    "Deletes a Unity project's regenerable cache folders (Library, Temp, Logs…) through Unity's CLI — the standard repair for a corrupt import, a wedged Library, or reclaiming disk. Unity rebuilds them on the next open, which can take several minutes on a large project. Requires the Editor to be CLOSED. Defaults to a dry run: pass dryRun:false to actually delete, and tell the user about the re-import cost first.",
  requires: ["unity_cli", "filesystem"],
  write: true,
  writeTarget: "build",
  inputShape: CleanInput,
  async run(args, ctx) {
    const pre = await requireBatchMode(ctx, "Cleaning the project caches");
    if (isEnvelope(pre)) return pre;
    const dryRun = args.dryRun ?? true;
    const started = Date.now();
    const cleaned = await cleanProject(ctx.projectPath, { ...pre.cliOpts, dryRun });
    if (!cleaned.ok) {
      return err("UNITY_CLI_FAILED", cleaned.message, { source: "unity_cli", durationMs: Date.now() - started });
    }
    return ok(
      { dryRun, detail: cleaned.data },
      { source: "unity_cli", durationMs: Date.now() - started },
      dryRun
        ? ["Dry run — nothing was deleted. Re-call with dryRun:false to delete these folders."]
        : ["Unity will re-import the project on next open; that can take several minutes."]
    );
  },
};

/** Unity build logs run to tens of thousands of lines; keep the errors and the last few lines. */
async function readLogTail(logFile: string): Promise<{ errors: string[]; tail: string[] }> {
  try {
    const raw = await fs.readFile(logFile, "utf8");
    const lines = raw.split(/\r?\n/);
    const errors = lines
      .filter((line) =>
        /(\berror CS\d+|BuildFailedException|Error building Player|Build completed with a result of 'Failed'|Aborting batchmode|UnityException|Failed to build)/i.test(
          line
        )
      )
      .slice(0, 40);
    return { errors, tail: lines.filter((line) => line.trim()).slice(-25) };
  } catch {
    return { errors: [], tail: [] };
  }
}
