import { cached } from "./cache.js";
import {
  runUnityCli,
  runUnityCliRaw,
  launchUnityCli,
  launchViaLaunchServices,
  resolveCli,
  type RunOptions,
  type UnityCliResult,
} from "./exec.js";

/**
 * Typed wrappers over the Unity CLI subcommands we use. Each one owns its timeout, because the
 * spread is enormous: `unity editors -i` answers in ~15ms, `unity doctor` takes ~13s, and
 * `unity install` legitimately runs for an hour.
 */

export interface InstalledEditor {
  version: string;
  alias?: string;
  architecture?: string;
  location?: string;
  modules?: string;
  default?: boolean;
}

export interface HubProject {
  title: string;
  path: string;
  version?: string;
  architecture?: string;
  renderPipeline?: string;
  lastModified?: number;
  isFavorite?: boolean;
  vcsProvider?: string;
  repositoryName?: string;
  organizationName?: string;
}

export interface CliIdentity {
  available: boolean;
  path?: string;
  source?: string;
  version?: string;
  error?: string;
}

const TIMEOUTS = {
  version: 10_000,
  editors: 15_000,
  projects: 15_000,
  /** `unity license status` has been seen to hang; a short leash turns that into "unknown". */
  license: 12_000,
  doctor: 45_000,
  clean: 300_000,
  install: 7_200_000,
  build: 2_700_000,
  test: 1_800_000,
} as const;

/** Cache entries are per-binary: a different `unity` install answers differently. */
function cacheKey(name: string, cliPath?: string): string {
  return `${name}:${resolveCli(cliPath)?.path ?? "none"}`;
}

const TTL = {
  identity: 60_000,
  editors: 30_000,
  projects: 15_000,
  license: 600_000,
  doctor: 3_600_000,
} as const;

/** Is the CLI present, and what version? Cached — this is on the hot path of every doctor/orient. */
export async function cliIdentity(opts: RunOptions & { force?: boolean } = {}): Promise<CliIdentity> {
  const located = resolveCli(opts.cliPath);
  if (!located) {
    return {
      available: false,
      error: "The Unity CLI (`unity`) is not installed on this machine.",
    };
  }
  const { value } = await cached<CliIdentity>(
    { key: `identity:${located.path}`, ttlMs: TTL.identity, force: opts.force },
    async () => {
      const res = await runUnityCliRaw(["--version"], { ...opts, timeoutMs: TIMEOUTS.version });
      const version = res.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
      if (res.ok && version) {
        return { available: true, path: located.path, source: located.source, version };
      }
      // A binary that exists but won't answer `--version` is broken, not merely slow.
      return { available: false, path: located.path, source: located.source, error: res.message ?? "`unity --version` produced no output." };
    },
    (identity) => identity.available
  );
  return value;
}

export async function listInstalledEditors(
  opts: RunOptions & { force?: boolean } = {}
): Promise<UnityCliResult<InstalledEditor[]>> {
  const { value } = await cached<UnityCliResult<InstalledEditor[]>>(
    { key: cacheKey("editors:installed", opts.cliPath), ttlMs: TTL.editors, force: opts.force },
    () => runUnityCli<InstalledEditor[]>(["editors", "--installed"], { ...opts, timeoutMs: TIMEOUTS.editors }),
    (result) => result.ok
  );
  return value;
}

export async function listHubProjects(
  opts: RunOptions & { force?: boolean } = {}
): Promise<UnityCliResult<HubProject[]>> {
  const { value } = await cached<UnityCliResult<HubProject[]>>(
    { key: cacheKey("projects:list", opts.cliPath), ttlMs: TTL.projects, force: opts.force },
    () => runUnityCli<HubProject[]>(["projects", "list", "--all"], { ...opts, timeoutMs: TIMEOUTS.projects }),
    (result) => result.ok
  );
  return value;
}

export async function licenseStatus(
  opts: RunOptions & { force?: boolean } = {}
): Promise<UnityCliResult<Record<string, unknown>>> {
  const { value } = await cached<UnityCliResult<Record<string, unknown>>>(
    { key: cacheKey("license:status", opts.cliPath), ttlMs: TTL.license, force: opts.force },
    () => runUnityCli<Record<string, unknown>>(["license", "status"], { ...opts, timeoutMs: TIMEOUTS.license }),
    (result) => result.ok
  );
  return value;
}

export async function cliDoctor(
  opts: RunOptions & { force?: boolean } = {}
): Promise<UnityCliResult<Record<string, unknown>>> {
  const { value } = await cached<UnityCliResult<Record<string, unknown>>>(
    { key: cacheKey("cli:doctor", opts.cliPath), ttlMs: TTL.doctor, force: opts.force },
    () => runUnityCli<Record<string, unknown>>(["doctor"], { ...opts, timeoutMs: TIMEOUTS.doctor }),
    (result) => result.ok
  );
  return value;
}

export interface OpenProjectOptions extends RunOptions {
  editorVersion?: string;
  editorPath?: string;
  /** macOS: the resolved `Unity.app` bundle, so the launch can go through LaunchServices. */
  editorAppPath?: string;
  buildTarget?: string;
  /** Extra arguments forwarded to the Editor itself. */
  extraArgs?: string;
}

/**
 * Launch the Editor for a project. Returns as soon as the launch is underway — see launchUnityCli.
 *
 * On macOS, when we know the Editor's app bundle, this goes through LaunchServices (`open -a`)
 * rather than `unity open`. Both end up running the same binary, but only LaunchServices performs
 * the launch handshake AppKit expects: an Editor started outside it sits forever inside
 * `AEProcessAppleEvent` waiting for a launch Apple Event that never arrives — alive, registered as
 * a background-only app, burning no CPU, never writing Temp/UnityLockfile or its log. Verified
 * with a sampled stack on a wedged 6000.3.8f1.
 */
export function openProject(projectPath: string, opts: OpenProjectOptions = {}) {
  if (process.platform === "darwin" && opts.editorAppPath) {
    const macArgs = ["-na", opts.editorAppPath, "--args", "-projectPath", projectPath];
    if (opts.buildTarget) macArgs.push("-buildTarget", opts.buildTarget);
    return launchViaLaunchServices(macArgs, opts);
  }
  const args = ["open", projectPath];
  if (opts.editorVersion) args.push("--editor-version", opts.editorVersion);
  if (opts.editorPath) args.push("--editor-path", opts.editorPath);
  if (opts.buildTarget) args.push("--build-target", opts.buildTarget);
  if (opts.extraArgs) args.push("--args", opts.extraArgs);
  return launchUnityCli(args, opts);
}

export interface InstallEditorOptions extends RunOptions {
  modules?: string[];
  changeset?: string;
  architecture?: string;
  /** Install every child module of the requested modules (Android SDK/NDK, etc.). */
  childModules?: boolean;
  dryRun?: boolean;
}

/** Install a Unity Editor version. Long-running; stream progress with `onLine`. */
export function installEditor(version: string, opts: InstallEditorOptions = {}) {
  const args = ["install", version, "--yes", "--accept-eula"];
  for (const module of opts.modules ?? []) args.push("--module", module);
  if (opts.changeset) args.push("--changeset", opts.changeset);
  if (opts.architecture) args.push("--architecture", opts.architecture);
  if (opts.childModules) args.push("--childModules");
  if (opts.dryRun) args.push("--dry-run");
  return runUnityCli<Record<string, unknown>>(args, { ...opts, timeoutMs: opts.timeoutMs ?? TIMEOUTS.install });
}

export interface InstallModulesOptions extends RunOptions {
  editorVersion: string;
  modules: string[];
  architecture?: string;
  childModules?: boolean;
}

export function installModules(opts: InstallModulesOptions) {
  const args = ["install-modules", "--editor-version", opts.editorVersion, "--yes", "--accept-eula"];
  for (const module of opts.modules) args.push("--module", module);
  if (opts.architecture) args.push("--architecture", opts.architecture);
  if (opts.childModules) args.push("--childModules");
  return runUnityCli<Record<string, unknown>>(args, { ...opts, timeoutMs: opts.timeoutMs ?? TIMEOUTS.install });
}

export interface BuildOptions extends RunOptions {
  projectPath: string;
  target?: string;
  profile?: string;
  executeMethod?: string;
  outputPath?: string;
  buildTargetGroup?: string;
  logFile?: string;
  editorVersion?: string;
  allowInstall?: boolean;
  extraArgs?: string;
}

/**
 * Build a player through a batch-mode Editor. The caller is responsible for making sure no Editor
 * currently holds this project's lock — Unity refuses to open one project twice.
 */
export function buildPlayer(opts: BuildOptions) {
  const args = ["build", opts.projectPath];
  if (opts.target) args.push("--target", opts.target);
  if (opts.profile) args.push("--profile", opts.profile);
  if (opts.executeMethod) args.push("--execute-method", opts.executeMethod);
  if (opts.outputPath) args.push("--output-path", opts.outputPath);
  if (opts.buildTargetGroup) args.push("--build-target-group", opts.buildTargetGroup);
  if (opts.logFile) args.push("--log-file", opts.logFile);
  if (opts.editorVersion) args.push("--editor-version", opts.editorVersion);
  if (opts.allowInstall) args.push("--allow-install");
  if (opts.extraArgs) args.push("--args", opts.extraArgs);
  // The log still streams to stdout by default; with --json that is noise we read from the file instead.
  args.push("--no-tail");
  return runUnityCli<Record<string, unknown>>(args, { ...opts, timeoutMs: opts.timeoutMs ?? TIMEOUTS.build });
}

export interface BatchTestOptions extends RunOptions {
  projectPath: string;
  mode?: "EditMode" | "PlayMode";
  filter?: string;
  output: string;
  coverage?: boolean;
  coverageOutput?: string;
  editorVersion?: string;
  /** Seconds — the CLI's own kill switch, distinct from our process timeout. */
  editorTimeoutSeconds?: number;
}

/** Run the Test Framework in a headless batch-mode Editor and write an NUnit report. */
export function runTestsBatch(opts: BatchTestOptions) {
  const args = ["test", opts.projectPath, "--output", opts.output];
  if (opts.mode) args.push("--mode", opts.mode);
  if (opts.filter) args.push("--filter", opts.filter);
  if (opts.coverage) args.push("--coverage");
  if (opts.coverageOutput) args.push("--coverage-output", opts.coverageOutput);
  if (opts.editorVersion) args.push("--editor-version", opts.editorVersion);
  if (opts.editorTimeoutSeconds) args.push("--timeout", String(opts.editorTimeoutSeconds));
  return runUnityCli<Record<string, unknown>>(args, { ...opts, timeoutMs: opts.timeoutMs ?? TIMEOUTS.test });
}

export interface CleanOptions extends RunOptions {
  dryRun?: boolean;
}

/** Delete a project's regenerable caches (Library, Temp, Logs…). Requires the Editor to be closed. */
export function cleanProject(projectPath: string, opts: CleanOptions = {}) {
  const args = ["projects", "clean", projectPath];
  if (opts.dryRun) args.push("--dry-run");
  else args.push("--yes");
  return runUnityCli<Record<string, unknown>>(args, { ...opts, timeoutMs: opts.timeoutMs ?? TIMEOUTS.clean });
}

/** Register a project folder with the Hub so it shows up in `unity projects list` (and the Hub UI). */
export function registerProject(projectPath: string, opts: RunOptions = {}) {
  return runUnityCli<Record<string, unknown>>(["projects", "add", projectPath], {
    ...opts,
    timeoutMs: opts.timeoutMs ?? TIMEOUTS.projects,
  });
}

export { TIMEOUTS as UNITY_CLI_TIMEOUTS };
