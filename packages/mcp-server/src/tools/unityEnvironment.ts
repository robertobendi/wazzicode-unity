import { z } from "zod";
import { loadConfig } from "@uvibe/safety";
import {
  describeEditorEnvironment,
  listHubProjects,
  defaultBridgeProbe,
  type EditorEnvironment,
  type HubProject,
} from "@uvibe/unity-cli";
import { ToolDef } from "../registry.js";
import { ok } from "./_helpers.js";

/**
 * The machine-level facts the bridge cannot report — because answering them requires *not* being
 * inside Unity: which Editor versions are installed, whether this project's version is one of
 * them, whether an Editor is holding the project right now, whether Unity's CLI is available to
 * fix any of it, and (on request) the licence state.
 *
 * This is what the agent should read when a Unity session won't start, before it starts guessing.
 */

const InputShape = {
  includeLicense: z
    .boolean()
    .optional()
    .describe("Also query the Unity licence state. Slower and occasionally unavailable; off by default."),
  includeHubProjects: z
    .boolean()
    .optional()
    .describe("Also list the Unity projects registered in the Hub (path, Editor version, render pipeline)."),
  refresh: z.boolean().optional().describe("Bypass the short-lived cache and re-query the CLI."),
};

interface EnvironmentResult extends EditorEnvironment {
  hubProjects?: HubProject[];
  hubProjectsError?: string;
  /** Whether this project itself is known to the Hub — an unregistered project is invisible to `unity open <name>`. */
  registeredWithHub?: boolean;
}

export const unityEnvironment: ToolDef<typeof InputShape, EnvironmentResult> = {
  name: "unity_environment",
  description:
    "Reports the machine-side Unity environment that the bridge cannot see: installed Editor versions, the version THIS project requires and whether it is installed, whether an Editor currently holds the project (bridge, live PID, Unity's project lockfile), Unity CLI availability, optional licence state and Hub project registry — plus ordered suggestions. Read-only. Use it when Unity won't start, a build fails to launch, or before installing/launching an Editor.",
  requires: ["unity_cli", "filesystem"],
  inputShape: InputShape,
  async run(args, ctx) {
    const started = Date.now();
    const config = await loadConfig(ctx.projectPath);
    const cliOpts = config.unityCliPath ? { cliPath: config.unityCliPath } : {};

    const environment = await describeEditorEnvironment(ctx.projectPath, {
      ...cliOpts,
      ...(args.includeLicense !== undefined ? { includeLicense: args.includeLicense } : {}),
      ...(args.refresh !== undefined ? { force: args.refresh } : {}),
      // In mock mode nothing should touch a real Editor socket.
      probeBridge: ctx.configMockMode ? async () => false : defaultBridgeProbe,
    });

    const result: EnvironmentResult = { ...environment };
    if (args.includeHubProjects && environment.cli.available) {
      const projects = await listHubProjects({ ...cliOpts, ...(args.refresh ? { force: true } : {}) });
      if (projects.ok) {
        result.hubProjects = projects.data;
        result.registeredWithHub = projects.data.some((project) => samePath(project.path, ctx.projectPath));
      } else {
        result.hubProjectsError = projects.message;
      }
    }

    return ok(
      result,
      {
        source: environment.cli.available ? "unity_cli" : "filesystem",
        durationMs: Date.now() - started,
        projectPath: ctx.projectPath,
        ...(environment.project.required.editorVersion
          ? { unityVersion: environment.project.required.editorVersion }
          : {}),
      },
      environment.suggestions
    );
  },
};

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
