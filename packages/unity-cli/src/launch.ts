import { createHttpBridgeClient } from "@uvibe/bridge-client";
import { installEditor, openProject } from "./commands.js";
import {
  describeEditorEnvironment,
  isUnityProject,
  type EditorEnvironment,
  type EnvironmentOptions,
} from "./environment.js";

/**
 * "Make sure a Unity Editor is actually running for this project" — the single most expensive
 * dead-end in the product, turned into an operation.
 *
 * Before the Unity CLI existed, every tool call that hit UNITY_NOT_CONNECTED ended the task: the
 * agent had to stop and ask a human to open Unity. With the CLI present we can resolve the
 * project's Editor version, launch it, and wait for the bridge to come up — and when we can't,
 * we say precisely which of those steps failed.
 */

export type LaunchOutcome =
  | "already_running"
  | "became_ready"
  | "launched"
  | "editor_running_without_bridge"
  | "editor_not_installed"
  | "cli_unavailable"
  | "launch_failed"
  | "launch_timeout"
  | "not_a_project";

export interface EnsureEditorResult {
  outcome: LaunchOutcome;
  /** True when the bridge answered by the time we returned. */
  ready: boolean;
  waitedMs: number;
  message: string;
  nextAction: string;
  environment: EditorEnvironment;
  /** Set when we installed an Editor version as part of this call. */
  installedEditorVersion?: string;
}

export interface EnsureEditorOptions extends EnvironmentOptions {
  /** Total budget for launch + bridge handshake. Unity's first import of a large project is slow. */
  timeoutMs?: number;
  pollMs?: number;
  /** Download and install the project's Editor version when it is missing (multi-GB, opt-in). */
  installMissingEditor?: boolean;
  /** Return as soon as the launch is underway instead of waiting for the bridge. */
  waitForBridge?: boolean;
  onProgress?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_MS = 2_000;

/** Does the UnityVibeOS bridge answer for this project right now? */
export async function defaultBridgeProbe(projectPath: string): Promise<boolean> {
  const client = createHttpBridgeClient({ projectPath, timeoutMs: 1_500 });
  // GET /health is served off Unity's main thread, so a compiling/reloading Editor still answers.
  const health = await client.health?.().catch(() => null);
  if (health) return true;
  const rpc = await client.call("system.health").catch(() => null);
  return rpc?.ok === true;
}

export async function ensureEditorRunning(
  projectPath: string,
  opts: EnsureEditorOptions = {}
): Promise<EnsureEditorResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const probe = opts.probeBridge ?? defaultBridgeProbe;
  const waitForBridge = opts.waitForBridge ?? true;
  const progress = (message: string) => opts.onProgress?.(message);
  const envOpts: EnvironmentOptions = { ...opts, probeBridge: probe };

  if (!(await isUnityProject(projectPath))) {
    const environment = await describeEditorEnvironment(projectPath, envOpts);
    return {
      outcome: "not_a_project",
      ready: false,
      waitedMs: Date.now() - startedAt,
      message: `${projectPath} is not a Unity project (no ProjectSettings/ProjectVersion.txt).`,
      nextAction: "Point the session at the Unity project root — the folder containing Assets/, Packages/ and ProjectSettings/.",
      environment,
    };
  }

  let environment = await describeEditorEnvironment(projectPath, envOpts);

  if (environment.running.bridgeConnected) {
    return {
      outcome: "already_running",
      ready: true,
      waitedMs: Date.now() - startedAt,
      message: "A Unity Editor is already open for this project and the bridge is answering.",
      nextAction: "Nothing to do — continue with the unity_* tools.",
      environment,
    };
  }

  // An Editor already holds the project (booting, importing, mid-compile, or running without our
  // package). Launching a second one would fail on Unity's project lock, so we wait instead.
  if (environment.running.editorProcessAlive || environment.running.lockfilePresent) {
    progress("a Unity Editor already holds this project — waiting for its bridge…");
    // With waitForBridge:false the caller wants an immediate answer, so this collapses to a single
    // probe rather than sitting on the full budget for an Editor someone else already started.
    const settled = await waitForBridgeReady(
      projectPath,
      probe,
      startedAt,
      waitForBridge ? timeoutMs : 0,
      pollMs,
      progress
    );
    environment = await describeEditorEnvironment(projectPath, envOpts);
    if (settled) {
      return {
        outcome: "became_ready",
        ready: true,
        waitedMs: Date.now() - startedAt,
        message: "The Unity Editor that was already open finished starting up; the bridge is answering.",
        nextAction: "Nothing to do — continue with the unity_* tools.",
        environment,
      };
    }
    return {
      outcome: "editor_running_without_bridge",
      ready: false,
      waitedMs: Date.now() - startedAt,
      message: waitForBridge
        ? "A Unity Editor holds this project but its UnityVibeOS bridge never answered. It is usually a missing/outdated package, or an Editor still importing a large project."
        : "A Unity Editor already holds this project; its bridge has not answered yet.",
      nextAction:
        "Check that the UnityVibeOS package is installed in the open project (`uvibe install-unity-package`), then let Unity finish importing.",
      environment,
    };
  }

  if (!environment.cli.available) {
    return {
      outcome: "cli_unavailable",
      ready: false,
      waitedMs: Date.now() - startedAt,
      message: `No Editor is running for this project and the Unity CLI is unavailable (${environment.cli.error ?? "not installed"}).`,
      nextAction: "Ask the user to open the project in Unity, or install the Unity CLI so this can be done automatically.",
      environment,
    };
  }

  const required = environment.project.required.editorVersion;
  if (required && !environment.match.installed) {
    if (!opts.installMissingEditor) {
      return {
        outcome: "editor_not_installed",
        ready: false,
        waitedMs: Date.now() - startedAt,
        message: `This project needs Unity ${required}, which is not installed on this machine.`,
        nextAction:
          environment.match.nearby.length > 0
            ? `Install Unity ${required} (unity_install_editor), or open the project with a nearby installed version (${environment.match.nearby
                .map((editor) => editor.version)
                .join(", ")}) knowing Unity will upgrade the project files.`
            : `Install Unity ${required} with unity_install_editor, or \`uvibe launch --install\`.`,
        environment,
      };
    }
    progress(`installing Unity ${required} (this downloads several GB)…`);
    const installed = await installEditor(required, {
      ...opts,
      ...(environment.project.required.changeset ? { changeset: environment.project.required.changeset } : {}),
      onLine: (line) => progress(line.slice(0, 160)),
    });
    if (!installed.ok) {
      environment = await describeEditorEnvironment(projectPath, { ...envOpts, force: true });
      return {
        outcome: "editor_not_installed",
        ready: false,
        waitedMs: Date.now() - startedAt,
        message: `Installing Unity ${required} failed: ${installed.message}`,
        nextAction: "Install the version from the Unity Hub, then retry.",
        environment,
      };
    }
    environment = await describeEditorEnvironment(projectPath, { ...envOpts, force: true });
    progress(`Unity ${required} installed.`);
  }

  progress("launching the Unity Editor…");
  const launch = await openProject(projectPath, {
    ...opts,
    ...(required ? { editorVersion: required } : {}),
  });
  if (!launch.started) {
    return {
      outcome: "launch_failed",
      ready: false,
      waitedMs: Date.now() - startedAt,
      message: `\`unity open\` could not start the Editor: ${launch.message ?? "unknown error"}`,
      nextAction: "Open the project from the Unity Hub and check for a licensing or install problem.",
      environment,
      ...(required && opts.installMissingEditor ? { installedEditorVersion: required } : {}),
    };
  }

  if (!waitForBridge) {
    return {
      outcome: "launched",
      ready: false,
      waitedMs: Date.now() - startedAt,
      message: "The Unity Editor is starting.",
      nextAction: "Retry the tool call in a few seconds; the bridge comes up once the Editor finishes loading.",
      environment,
      ...(required && opts.installMissingEditor ? { installedEditorVersion: required } : {}),
    };
  }

  progress("waiting for the Unity bridge…");
  const ready = await waitForBridgeReady(projectPath, probe, startedAt, timeoutMs, pollMs, progress);
  environment = await describeEditorEnvironment(projectPath, { ...envOpts, force: true });
  const waitedMs = Date.now() - startedAt;
  if (ready) {
    return {
      outcome: "launched",
      ready: true,
      waitedMs,
      message: `Launched the Unity Editor and the bridge answered after ${Math.round(waitedMs / 1000)}s.`,
      nextAction: "Nothing to do — continue with the unity_* tools.",
      environment,
      ...(required && opts.installMissingEditor ? { installedEditorVersion: required } : {}),
    };
  }
  return {
    outcome: "launch_timeout",
    ready: false,
    waitedMs,
    message: `The Editor was launched but the bridge did not answer within ${Math.round(timeoutMs / 1000)}s.`,
    nextAction:
      "A first import of a large project can exceed this budget — retry shortly. If the Editor is open and idle, the UnityVibeOS package is probably missing (`uvibe install-unity-package`). If the Unity process is alive but never shows a window, it was started without a desktop session (a headless/agent shell, ssh, or a CI runner): on macOS it registers as a background-only app and never boots the editor loop — start it from Terminal or the Unity Hub instead.",
    environment,
    ...(required && opts.installMissingEditor ? { installedEditorVersion: required } : {}),
  };
}

async function waitForBridgeReady(
  projectPath: string,
  probe: (projectPath: string) => Promise<boolean>,
  startedAt: number,
  timeoutMs: number,
  pollMs: number,
  progress: (message: string) => void
): Promise<boolean> {
  let announced = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (await probe(projectPath)) return true;
    const elapsed = Date.now() - startedAt;
    if (elapsed - announced > 15_000) {
      announced = elapsed;
      progress(`still waiting for Unity (${Math.round(elapsed / 1000)}s)…`);
    }
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }
  return probe(projectPath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
