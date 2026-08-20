import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "@uvibe/safety";
import {
  buildPlayer,
  cleanProject,
  defaultBridgeProbe,
  describeEditorEnvironment,
  editorHoldsProject,
  ensureEditorRunning,
  listHubProjects,
  readEditorRunningState,
  readNUnitReport,
  readProjectVersion,
  runTestsBatch,
  type EditorEnvironment,
  type RunOptions,
} from "@uvibe/unity-cli";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";

/**
 * CLI surface over Unity's own `unity` CLI: the same Editor lifecycle / batch-mode operations the
 * MCP tools expose, available from a terminal and from scripts. Everything degrades to a clear
 * message (exit code 3) when the Unity CLI is not installed, so these are safe to put in a Makefile
 * or CI job that may run on a machine without it.
 */

const EXIT_UNAVAILABLE = 3;

/** Failure exit code: 3 means "the Unity CLI isn't here", so scripts can tell it from a real failure. */
function failureExit(result: { ok: boolean; code?: string }): number {
  return !result.ok && result.code === "CLI_NOT_FOUND" ? EXIT_UNAVAILABLE : 1;
}

async function cliOptionsFor(projectPath: string): Promise<RunOptions> {
  const config = await loadConfig(projectPath);
  return config.unityCliPath ? { cliPath: config.unityCliPath } : {};
}

function flagBool(parsed: ParsedArgs, name: string): boolean {
  const value = parsed.flags[name];
  return value === true || value === "true";
}

function flagString(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

function flagNumber(parsed: ParsedArgs, name: string): number | undefined {
  const value = flagString(parsed, name);
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

// ---------------------------------------------------------------------------
// uvibe env
// ---------------------------------------------------------------------------

export async function runEnv(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const opts = await cliOptionsFor(g.project);
  const environment = await describeEditorEnvironment(g.project, {
    ...opts,
    includeLicense: flagBool(parsed, "license"),
    force: flagBool(parsed, "refresh"),
    probeBridge: g.mock ? async () => false : defaultBridgeProbe,
  });
  const hub = flagBool(parsed, "projects") && environment.cli.available ? await listHubProjects(opts) : null;

  if (g.json) {
    return {
      exitCode: 0,
      stdout:
        JSON.stringify({ ...environment, ...(hub?.ok ? { hubProjects: hub.data } : {}) }, null, 2) + "\n",
    };
  }
  return { exitCode: 0, stdout: formatEnvironment(environment, hub?.ok ? hub.data.length : undefined) };
}

function formatEnvironment(env: EditorEnvironment, hubProjectCount?: number): string {
  const tick = (value: boolean) => (value ? "✓" : "·");
  const lines: string[] = [];
  lines.push("Unity environment");
  lines.push("");
  lines.push(
    `Unity CLI:      ${tick(env.cli.available)} ${
      env.cli.available ? `${env.cli.version ?? "unknown version"} (${env.cli.path})` : env.cli.error ?? "not installed"
    }`
  );
  lines.push(
    `Project:        ${tick(env.project.isUnityProject)} ${env.project.path}${
      env.project.required.editorVersion ? ` — needs Unity ${env.project.required.editorVersion}` : ""
    }`
  );
  const editorList = env.editors.length
    ? env.editors.map((editor) => `${editor.version} (${editor.architecture ?? "?"})`).join(", ")
    : env.editorsError ?? "(none found)";
  lines.push(`Installed:      ${tick(env.editors.length > 0)} ${editorList}`);
  lines.push(
    `Required build: ${tick(env.match.installed)} ${
      env.match.installed
        ? env.match.exact?.location ?? "installed"
        : env.match.nearby.length
          ? `missing — nearby: ${env.match.nearby.map((editor) => editor.version).join(", ")}`
          : "missing"
    }`
  );
  const running = env.running;
  const runningText = running.bridgeConnected
    ? `bridge answering on port ${running.discovery?.port ?? "?"} (pid ${running.discovery?.pid ?? "?"})`
    : running.editorProcessAlive
      ? `Editor pid ${running.discovery?.pid} alive, bridge silent`
      : running.lockfilePresent
        ? "Temp/UnityLockfile present (Editor open, or a stale lock from a crash)"
        : "no Editor holding this project";
  lines.push(`Editor:         ${tick(running.bridgeConnected)} ${runningText}`);
  if (env.license) {
    lines.push(`Licence:        ${tick(env.license.available)} ${env.license.state ?? env.license.error ?? "unknown"}`);
  }
  if (hubProjectCount !== undefined) lines.push(`Hub projects:   ${hubProjectCount}`);
  if (env.suggestions.length) {
    lines.push("");
    lines.push("Suggestions:");
    for (const suggestion of env.suggestions) lines.push(`  • ${suggestion}`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// uvibe projects
// ---------------------------------------------------------------------------

/**
 * The Hub's project registry — what Unity itself already knows about the user's projects (path,
 * Editor version, render pipeline, VCS). Studio's project picker uses this instead of scanning
 * the filesystem for ProjectVersion.txt files.
 */
export async function runProjects(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const opts = await cliOptionsFor(g.project);
  const listed = await listHubProjects({ ...opts, force: flagBool(parsed, "refresh") });
  if (!listed.ok) {
    const unavailable = listed.code === "CLI_NOT_FOUND";
    if (g.json) {
      return {
        exitCode: unavailable ? EXIT_UNAVAILABLE : 1,
        stdout: JSON.stringify({ available: false, error: listed.message, projects: [] }, null, 2) + "\n",
      };
    }
    return { exitCode: unavailable ? EXIT_UNAVAILABLE : 1, stderr: `${listed.message}\n` };
  }
  if (g.json) {
    return { exitCode: 0, stdout: JSON.stringify({ available: true, projects: listed.data }, null, 2) + "\n" };
  }
  const lines = listed.data.map(
    (project) =>
      `${project.title}\t${project.version ?? "?"}\t${project.renderPipeline ?? "-"}\t${project.path}`
  );
  return { exitCode: 0, stdout: (lines.join("\n") || "(no projects registered with the Unity Hub)") + "\n" };
}

// ---------------------------------------------------------------------------
// uvibe launch
// ---------------------------------------------------------------------------

export async function runLaunch(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const opts = await cliOptionsFor(g.project);
  const config = await loadConfig(g.project);
  const result = await ensureEditorRunning(g.project, {
    ...opts,
    installMissingEditor: flagBool(parsed, "install") || config.autoInstallEditor,
    waitForBridge: !flagBool(parsed, "no-wait"),
    ...(flagNumber(parsed, "timeout") !== undefined ? { timeoutMs: flagNumber(parsed, "timeout")! } : {}),
    onProgress: (message) => {
      if (!g.json) process.stderr.write(`… ${message}\n`);
    },
  });

  if (g.json) return { exitCode: result.ready ? 0 : 1, stdout: JSON.stringify(result, null, 2) + "\n" };
  const summary = `${result.ready ? "✓" : "✗"} ${result.outcome}: ${result.message}\n`;
  if (result.ready) return { exitCode: 0, stdout: summary };
  return {
    exitCode: result.outcome === "cli_unavailable" ? EXIT_UNAVAILABLE : 1,
    stdout: summary,
    stderr: `${result.nextAction}\n`,
  };
}

// ---------------------------------------------------------------------------
// uvibe build
// ---------------------------------------------------------------------------

export async function runBuild(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const target = flagString(parsed, "target");
  const profile = flagString(parsed, "profile");
  const output = flagString(parsed, "output");
  if (!target && !profile) {
    return { exitCode: 2, stderr: "uvibe build needs --target=<BuildTarget> or --profile=<name>.\n" };
  }
  const guard = await guardBatchMode(g.project);
  if (guard) return guard;

  const opts = await cliOptionsFor(g.project);
  const required = await readProjectVersion(g.project);
  const started = Date.now();
  const logFile =
    flagString(parsed, "log") ??
    path.join(g.project, "Logs", `uvibe-build-${(target ?? profile ?? "profile").replace(/[^A-Za-z0-9_.-]/g, "_")}-${started}.log`);
  await fs.mkdir(path.dirname(logFile), { recursive: true });

  const build = await buildPlayer({
    projectPath: g.project,
    ...opts,
    ...(target ? { target } : {}),
    ...(profile ? { profile } : {}),
    ...(output ? { outputPath: path.resolve(g.project, output) } : {}),
    ...(flagString(parsed, "execute-method") ? { executeMethod: flagString(parsed, "execute-method")! } : {}),
    ...(required.editorVersion ? { editorVersion: required.editorVersion } : {}),
    ...(flagNumber(parsed, "timeout") !== undefined ? { timeoutMs: flagNumber(parsed, "timeout")! } : {}),
    allowInstall: flagBool(parsed, "install"),
    logFile,
    onLine: (line) => {
      if (!g.json) process.stderr.write(`${line}\n`);
    },
  });

  const payload = {
    succeeded: build.ok,
    target,
    profile,
    outputPath: output ? path.resolve(g.project, output) : undefined,
    logFile,
    durationMs: Date.now() - started,
    ...(build.ok ? { detail: build.data } : { error: build.message }),
  };
  if (g.json) return { exitCode: build.ok ? 0 : failureExit(build), stdout: JSON.stringify(payload, null, 2) + "\n" };
  return build.ok
    ? { exitCode: 0, stdout: `✓ Build succeeded in ${Math.round(payload.durationMs / 1000)}s — log: ${logFile}\n` }
    : {
        exitCode: failureExit(build),
        stdout: `✗ Build failed: ${build.message}\n`,
        stderr: `Log: ${logFile}\n`,
      };
}

// ---------------------------------------------------------------------------
// uvibe test-headless
// ---------------------------------------------------------------------------

export async function runHeadlessTests(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const guard = await guardBatchMode(g.project);
  if (guard) return guard;

  const opts = await cliOptionsFor(g.project);
  const mode = (flagString(parsed, "mode") as "EditMode" | "PlayMode" | undefined) ?? "EditMode";
  const started = Date.now();
  const reportPath = flagString(parsed, "output")
    ? path.resolve(g.project, flagString(parsed, "output")!)
    : path.join(g.project, ".unity-vibe", "test-results", `headless-${mode}-${started}.xml`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const required = await readProjectVersion(g.project);

  const run = await runTestsBatch({
    projectPath: g.project,
    output: reportPath,
    mode,
    ...opts,
    ...(flagString(parsed, "filter") ? { filter: flagString(parsed, "filter")! } : {}),
    ...(required.editorVersion ? { editorVersion: required.editorVersion } : {}),
    ...(flagNumber(parsed, "timeout") !== undefined ? { timeoutMs: flagNumber(parsed, "timeout")! } : {}),
    onLine: (line) => {
      if (!g.json) process.stderr.write(`${line}\n`);
    },
  });
  const report = await readNUnitReport(reportPath);
  const pass = report ? report.failed === 0 && report.total > 0 : run.ok;
  const payload = { mode, pass, reportPath, durationMs: Date.now() - started, report, ...(run.ok ? {} : { error: run.message }) };

  if (g.json) return { exitCode: pass ? 0 : failureExit(run), stdout: JSON.stringify(payload, null, 2) + "\n" };
  if (!report) {
    return {
      exitCode: failureExit(run),
      stdout: `✗ Headless ${mode} run produced no report: ${run.ok ? "unknown error" : run.message}\n`,
    };
  }
  const lines = [
    `${pass ? "✓" : "✗"} ${mode}: ${report.passed}/${report.total} passed, ${report.failed} failed, ${report.skipped} skipped`,
    `Report: ${reportPath}`,
    ...report.failures.map((failure) => `  • ${failure.name}${failure.message ? ` — ${failure.message.split("\n")[0]}` : ""}`),
  ];
  return { exitCode: pass ? 0 : 1, stdout: lines.join("\n") + "\n" };
}

// ---------------------------------------------------------------------------
// uvibe clean
// ---------------------------------------------------------------------------

export async function runClean(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const guard = await guardBatchMode(g.project);
  if (guard) return guard;
  const opts = await cliOptionsFor(g.project);
  // Deleting Library costs a full re-import, so deletion is opt-in even here.
  const apply = flagBool(parsed, "apply");
  const cleaned = await cleanProject(g.project, { ...opts, dryRun: !apply });
  if (g.json) {
    return {
      exitCode: cleaned.ok ? 0 : failureExit(cleaned),
      stdout: JSON.stringify({ dryRun: !apply, ...(cleaned.ok ? { detail: cleaned.data } : { error: cleaned.message }) }, null, 2) + "\n",
    };
  }
  if (!cleaned.ok) {
    return {
      exitCode: failureExit(cleaned),
      stdout: `✗ ${cleaned.message}\n`,
    };
  }
  return {
    exitCode: 0,
    stdout: apply
      ? "✓ Regenerable caches deleted. Unity will re-import on next open (this takes a while).\n"
      : `Dry run — nothing deleted. Re-run with --apply to delete.\n${JSON.stringify(cleaned.data, null, 2)}\n`,
  };
}

/** Batch-mode work needs the project to itself; report that up front rather than failing inside Unity. */
async function guardBatchMode(projectPath: string): Promise<CommandResult | null> {
  const running = await readEditorRunningState(projectPath, defaultBridgeProbe);
  if (!editorHoldsProject(running)) return null;
  return {
    exitCode: 1,
    stderr:
      "A Unity Editor is holding this project (Unity allows one process per project). Quit the Editor and retry — or use the in-Editor tools (`unity_verify`) instead.\n",
  };
}
