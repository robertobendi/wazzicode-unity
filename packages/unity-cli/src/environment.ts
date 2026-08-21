import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readBridgeDiscovery } from "@uvibe/bridge-client";
import type { BridgeDiscovery } from "@uvibe/core";
import { cliIdentity, licenseStatus, listInstalledEditors, type CliIdentity, type InstalledEditor } from "./commands.js";
import type { RunOptions } from "./exec.js";

/**
 * The machine-side facts a Unity session depends on and that the bridge itself cannot answer:
 * which Editor versions exist, whether *this* project's version is one of them, whether an Editor
 * currently holds the project, and whether the CLI that could fix any of it is installed.
 *
 * Everything degrades: with no Unity CLI the report still carries the project's required version
 * and the running-Editor state, both of which are read straight from disk.
 */

export interface ProjectVersionInfo {
  /** e.g. "6000.3.8f1" */
  editorVersion?: string;
  /** Revision hash from m_EditorVersionWithRevision — needed to install an archived version. */
  changeset?: string;
}

/**
 * Unity processes holding this project, found by scanning the process table.
 *
 * Everything else here reads files Unity writes *after* it has initialised — the bridge discovery
 * file, `Temp/UnityLockfile`. An Editor that is still booting (or that started and wedged) has
 * written none of them, so it is invisible to those checks: launch again and you get a second
 * Editor, and again, and again. This is the only signal that catches it.
 */
export function processScanSupported(): boolean {
  // No cheap argv scan on Windows, so there the on-disk signals stay authoritative.
  return process.platform !== "win32";
}

export async function findEditorProcesses(projectPath: string): Promise<number[]> {
  if (!processScanSupported()) return [];
  const normalized = path.resolve(projectPath).toLowerCase();
  const listing = await new Promise<string>((resolve) => {
    execFile("ps", ["-axo", "pid=,args="], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? "" : stdout)
    );
  });
  const pids: number[] = [];
  for (const line of listing.split("\n")) {
    const lower = line.toLowerCase();
    // The Editor binary, opened on this project — not the Hub, not our own CLI invocation.
    if (!lower.includes("unity.app/contents/macos/unity") && !/\bunity(\.x86_64)?\b/.test(lower)) continue;
    if (!lower.includes("-projectpath")) continue;
    if (!lower.includes(normalized)) continue;
    const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

export interface EditorRunningState {
  /** The UnityVibeOS bridge answered — an Editor is open on this project with our package. */
  bridgeConnected: boolean;
  /** Discovery file written by the bridge, if any. */
  discovery: BridgeDiscovery | null;
  /** The PID from the discovery file is still alive. */
  editorProcessAlive: boolean;
  /**
   * Unity writes Temp/UnityLockfile while it holds a project. It answers "is a batch-mode build
   * going to fail?" even when our package isn't installed. It survives a crash or a kill -9, so
   * it is evidence, never proof — see `stale` below.
   */
  lockfilePresent: boolean;
  lockfileAgeMs?: number;
  /** PIDs of Editor processes opened on this project, including ones that never finished booting. */
  editorProcesses: number[];
  /** False on platforms where we cannot list processes (Windows); the files stay authoritative there. */
  processScanSupported: boolean;
  /**
   * The on-disk signals claim an Editor is here, but nothing is: no live process, no answering
   * bridge. Unity leaves `Temp/UnityLockfile` behind on a crash or a force-quit, and our own
   * `bridge.json` outlives the process that wrote it. Believing those files is how a launcher ends
   * up waiting out its whole timeout for an Editor that exited half an hour ago.
   */
  stale: boolean;
}

export interface EditorMatch {
  installed: boolean;
  exact?: InstalledEditor;
  /** Same major.minor, different patch — usually openable, always a project-version upgrade prompt. */
  nearby: InstalledEditor[];
}

export interface EditorEnvironment {
  cli: CliIdentity;
  project: {
    path: string;
    isUnityProject: boolean;
    required: ProjectVersionInfo;
  };
  editors: InstalledEditor[];
  editorsError?: string;
  match: EditorMatch;
  running: EditorRunningState;
  license?: { available: boolean; state?: string; detail?: Record<string, unknown>; error?: string };
  /** Human-actionable, ordered most-blocking first. Empty means "nothing stands in the way". */
  suggestions: string[];
}

export interface EnvironmentOptions extends RunOptions {
  /** License lookup is the slowest and least reliable call; off unless asked for. */
  includeLicense?: boolean;
  force?: boolean;
  /** Injectable for tests: reports whether the bridge answers for this project. */
  probeBridge?: (projectPath: string) => Promise<boolean>;
  /** Injectable for tests: PIDs of Editor processes open on this project. */
  listEditorProcesses?: (projectPath: string) => Promise<number[]>;
}

export async function readProjectVersion(projectPath: string): Promise<ProjectVersionInfo> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "ProjectSettings", "ProjectVersion.txt"), "utf8");
    const version = /m_EditorVersion:\s*(\S+)/.exec(raw)?.[1];
    const changeset = /m_EditorVersionWithRevision:\s*\S+\s*\(([^)]+)\)/.exec(raw)?.[1];
    return { ...(version ? { editorVersion: version } : {}), ...(changeset ? { changeset } : {}) };
  } catch {
    return {};
  }
}

export async function isUnityProject(projectPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectPath, "ProjectSettings", "ProjectVersion.txt"));
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Is an Editor holding this project right now? Cheap, and it never spawns anything. */
export async function readEditorRunningState(
  projectPath: string,
  probeBridge?: (projectPath: string) => Promise<boolean>,
  listEditorProcesses: (projectPath: string) => Promise<number[]> = findEditorProcesses
): Promise<EditorRunningState> {
  const discovery = readBridgeDiscovery(projectPath);
  let lockfilePresent = false;
  let lockfileAgeMs: number | undefined;
  try {
    const stat = await fs.stat(path.join(projectPath, "Temp", "UnityLockfile"));
    lockfilePresent = true;
    lockfileAgeMs = Math.max(0, Date.now() - stat.mtimeMs);
  } catch {
    // No lockfile: no Editor has this project open (or it exited cleanly).
  }
  const [bridgeConnected, editorProcesses] = await Promise.all([
    probeBridge ? probeBridge(projectPath) : Promise.resolve(false),
    listEditorProcesses(projectPath),
  ]);
  const alive = pidAlive(discovery?.pid) || editorProcesses.length > 0;
  const scannable = processScanSupported();
  return {
    bridgeConnected,
    discovery,
    editorProcessAlive: alive,
    lockfilePresent,
    ...(lockfileAgeMs !== undefined ? { lockfileAgeMs } : {}),
    editorProcesses,
    processScanSupported: scannable,
    stale: scannable && !alive && !bridgeConnected && (lockfilePresent || discovery !== null),
  };
}

/**
 * True when the project is locked by an Editor, so batch-mode build/test/clean would fail.
 *
 * A lockfile with no process behind it does NOT count: it is debris from a crash or a kill, and
 * treating it as a live Editor blocks both batch-mode work and launching.
 */
export function editorHoldsProject(running: EditorRunningState): boolean {
  if (running.bridgeConnected) return true;
  if (running.editorProcessAlive || running.editorProcesses.length > 0) return true;
  // Where we cannot see processes, the lockfile is the only signal there is — trusting debris
  // costs a wait, but ignoring a real lock lets Unity fail deep inside a batch-mode run.
  if (!running.processScanSupported && running.lockfilePresent) return true;
  return false;
}

function matchEditors(required: string | undefined, editors: InstalledEditor[]): EditorMatch {
  if (!required) return { installed: editors.length > 0, nearby: [] };
  const exact = editors.find((editor) => editor.version === required);
  if (exact) return { installed: true, exact, nearby: [] };
  const minor = required.split(".").slice(0, 2).join(".");
  return {
    installed: false,
    nearby: editors.filter((editor) => editor.version.startsWith(`${minor}.`)),
  };
}

export async function describeEditorEnvironment(
  projectPath: string,
  opts: EnvironmentOptions = {}
): Promise<EditorEnvironment> {
  const [cli, projectIsUnity, required, running] = await Promise.all([
    cliIdentity(opts),
    isUnityProject(projectPath),
    readProjectVersion(projectPath),
    readEditorRunningState(projectPath, opts.probeBridge, opts.listEditorProcesses),
  ]);

  let editors: InstalledEditor[] = [];
  let editorsError: string | undefined;
  if (cli.available) {
    const listed = await listInstalledEditors(opts);
    if (listed.ok) editors = listed.data;
    else editorsError = listed.message;
  }

  let license: EditorEnvironment["license"];
  if (opts.includeLicense && cli.available) {
    const status = await licenseStatus(opts);
    license = status.ok
      ? {
          available: true,
          state: pickLicenseState(status.data),
          detail: status.data,
        }
      : { available: false, error: status.message };
  }

  const match = matchEditors(required.editorVersion, editors);
  const suggestions: string[] = [];

  if (!projectIsUnity) {
    suggestions.push(
      `${projectPath} does not look like a Unity project (no ProjectSettings/ProjectVersion.txt).`
    );
  }
  if (!cli.available) {
    suggestions.push(
      "Install the Unity CLI (`unity`) to let the agent open the Editor, install missing versions, and build without you. Everything else keeps working without it."
    );
  } else if (projectIsUnity && required.editorVersion && !match.installed) {
    suggestions.push(
      match.nearby.length
        ? `Unity ${required.editorVersion} is not installed (nearby: ${match.nearby.map((e) => e.version).join(", ")}). Install it with unity_install_editor or \`uvibe launch --install\`.`
        : `Unity ${required.editorVersion} is not installed. Install it with unity_install_editor or \`uvibe launch --install\`.`
    );
  }
  if (projectIsUnity && cli.available && match.installed && !running.bridgeConnected && !running.editorProcessAlive) {
    suggestions.push("No Editor is open for this project — `uvibe launch` (or unity_launch_editor) can start it.");
  }
  if (license && license.available === false) {
    suggestions.push(`Unity license state is unknown (${license.error}). Sign in with \`unity auth login\` if builds fail.`);
  }

  return {
    cli,
    project: { path: projectPath, isUnityProject: projectIsUnity, required },
    editors,
    ...(editorsError ? { editorsError } : {}),
    match,
    running,
    ...(license ? { license } : {}),
    suggestions,
  };
}

/** The beta CLI's license payload shape isn't stable; pull a state-ish field without assuming one. */
function pickLicenseState(data: Record<string, unknown>): string | undefined {
  for (const key of ["state", "status", "licenseState", "type"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
