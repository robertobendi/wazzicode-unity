import { z } from "zod";
import { loadConfig } from "@uvibe/safety";
import {
  ensureEditorRunning,
  installEditor,
  listInstalledEditors,
  readProjectVersion,
  type EnsureEditorResult,
} from "@uvibe/unity-cli";
import { ToolDef } from "../registry.js";
import { err, ok } from "./_helpers.js";
import { reportProgress } from "../interaction.js";

/**
 * Editor lifecycle, driven by Unity's own `unity` CLI.
 *
 * These are the tools that remove the product's oldest hard stop: "no Unity Editor is running, ask
 * the user to open one, and end the task". With the CLI installed the agent can resolve the
 * project's Editor version, install it when missing, start it, and wait for the bridge — all
 * without a human. Without the CLI they return UNITY_CLI_UNAVAILABLE, which carries the manual
 * instructions instead.
 */

const LaunchInput = {
  wait: z
    .boolean()
    .optional()
    .describe("Wait until the UnityVibeOS bridge answers (default true). False returns as soon as the Editor is starting."),
  timeoutMs: z
    .number()
    .int()
    .min(5_000)
    .max(1_800_000)
    .optional()
    .describe("Budget for launch + bridge handshake (default 5 min). A first import of a big project can exceed it."),
  installMissingEditor: z
    .boolean()
    .optional()
    .describe("Download the project's Editor version if it isn't installed. Multi-GB; defaults to the autoInstallEditor config flag (off)."),
};

export const unityLaunchEditor: ToolDef<typeof LaunchInput, EnsureEditorResult> = {
  name: "unity_launch_editor",
  description:
    "Makes sure a Unity Editor is actually running for this project and its bridge is answering — starting it through Unity's CLI when it isn't. Call this instead of asking the user to open Unity after UNITY_NOT_CONNECTED. Reports precisely which step blocked (CLI missing, Editor version not installed, Editor already holding the project without the package, launch timeout) and what to do about it.",
  requires: ["unity_cli", "filesystem"],
  inputShape: LaunchInput,
  async run(args, ctx) {
    if (ctx.configMockMode) {
      return err("MOCK_MODE_ACTIVE", "Editor launch is not simulated in mock mode.", { source: "mock" });
    }
    const config = await loadConfig(ctx.projectPath);
    let step = 0;
    const started = Date.now();
    const result = await ensureEditorRunning(ctx.projectPath, {
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      waitForBridge: args.wait ?? true,
      installMissingEditor: args.installMissingEditor ?? config.autoInstallEditor,
      ...(config.unityCliPath ? { cliPath: config.unityCliPath } : {}),
      onProgress: (message) => reportProgress(ctx, ++step, undefined, message),
    });

    if (result.outcome === "cli_unavailable") {
      return err("UNITY_CLI_UNAVAILABLE", result.message, { source: "unity_cli", durationMs: Date.now() - started }, {
        nextAction: result.nextAction,
      });
    }
    if (result.outcome === "not_a_project") {
      return err("PROJECT_NOT_FOUND", result.message, { source: "filesystem", durationMs: Date.now() - started });
    }

    return ok(
      result,
      { source: "unity_cli", durationMs: Date.now() - started, projectPath: ctx.projectPath },
      result.ready ? [] : [`${result.message} ${result.nextAction}`]
    );
  },
};

const InstallInput = {
  version: z
    .string()
    .optional()
    .describe("Editor version to install (e.g. 6000.0.30f1). Defaults to the version in ProjectSettings/ProjectVersion.txt."),
  modules: z
    .array(z.string())
    .optional()
    .describe("Optional module IDs to install with it (e.g. ios, android, webgl, mac-il2cpp)."),
  childModules: z.boolean().optional().describe("Also install each module's child modules (Android SDK/NDK, etc.)."),
  dryRun: z.boolean().optional().describe("Report what would be downloaded without installing anything."),
  timeoutMs: z.number().int().min(60_000).max(14_400_000).optional().describe("Install budget (default 2h)."),
};

interface InstallEditorResult {
  requestedVersion: string;
  dryRun: boolean;
  alreadyInstalled: boolean;
  installed: boolean;
  detail?: Record<string, unknown>;
  installedEditors: string[];
}

export const unityInstallEditor: ToolDef<typeof InstallInput, InstallEditorResult> = {
  name: "unity_install_editor",
  description:
    "Installs a Unity Editor version (and optional platform modules) through Unity's CLI, so a project whose Editor version is missing can be opened without the user going to the Hub. Downloads several GB and can run for a long time — use dryRun:true first when you just want the plan. Defaults to the version this project requires.",
  requires: ["unity_cli"],
  write: true,
  writeTarget: "build",
  inputShape: InstallInput,
  async run(args, ctx) {
    if (ctx.configMockMode) {
      return err("MOCK_MODE_ACTIVE", "Editor installs are not simulated in mock mode.", { source: "mock" });
    }
    const started = Date.now();
    const config = await loadConfig(ctx.projectPath);
    const cliOpts = config.unityCliPath ? { cliPath: config.unityCliPath } : {};
    const required = await readProjectVersion(ctx.projectPath);
    const version = args.version ?? required.editorVersion;
    if (!version) {
      return err(
        "INVALID_ARGUMENT",
        "No version given and this project has no readable ProjectSettings/ProjectVersion.txt.",
        { source: "filesystem" }
      );
    }

    const before = await listInstalledEditors({ ...cliOpts, force: true });
    if (!before.ok && before.code === "CLI_NOT_FOUND") {
      return err("UNITY_CLI_UNAVAILABLE", before.message, { source: "unity_cli", durationMs: Date.now() - started });
    }
    const installedBefore = before.ok ? before.data.map((editor) => editor.version) : [];
    if (installedBefore.includes(version) && !args.dryRun) {
      return ok(
        {
          requestedVersion: version,
          dryRun: false,
          alreadyInstalled: true,
          installed: true,
          installedEditors: installedBefore,
        },
        { source: "unity_cli", durationMs: Date.now() - started }
      );
    }

    let step = 0;
    const install = await installEditor(version, {
      ...cliOpts,
      ...(args.modules ? { modules: args.modules } : {}),
      ...(args.childModules !== undefined ? { childModules: args.childModules } : {}),
      ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      // The version's changeset is required for archived releases the Hub no longer lists.
      ...(!args.version && required.changeset ? { changeset: required.changeset } : {}),
      onLine: (line) => reportProgress(ctx, ++step, undefined, line.slice(0, 160)),
    });
    if (!install.ok) {
      return err(
        install.code === "CLI_NOT_FOUND" ? "UNITY_CLI_UNAVAILABLE" : "UNITY_CLI_FAILED",
        install.message,
        { source: "unity_cli", durationMs: Date.now() - started },
        { version, ...(install.output ? { output: install.output } : {}) }
      );
    }

    const after = await listInstalledEditors({ ...cliOpts, force: true });
    const installedAfter = after.ok ? after.data.map((editor) => editor.version) : installedBefore;
    return ok(
      {
        requestedVersion: version,
        dryRun: args.dryRun === true,
        alreadyInstalled: installedBefore.includes(version),
        installed: installedAfter.includes(version),
        detail: install.data,
        installedEditors: installedAfter,
      },
      { source: "unity_cli", durationMs: Date.now() - started },
      install.warnings
    );
  },
};
