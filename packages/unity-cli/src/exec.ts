import { spawn } from "node:child_process";
import { locateUnityCli, type CliLocation } from "./locate.js";

/**
 * Process-level wrapper around the Unity CLI.
 *
 * Three hard rules, learned from the CLI's actual behaviour:
 *  1. **Always non-interactive.** A fresh install prompts for analytics consent on first run; an
 *     inherited stdin would hang forever inside an MCP call. We force the flag *and* the env var
 *     and give the child a closed stdin.
 *  2. **Always time-bounded.** `unity license status` has been observed to hang indefinitely.
 *     Every call carries a deadline and a timeout is a normal, reportable result.
 *  3. **Never throw.** The CLI is optional; a missing binary, a beta-shaped payload change, or a
 *     non-zero exit must degrade to a typed failure the caller can ignore.
 */

export type UnityCliFailureCode =
  | "CLI_NOT_FOUND"
  | "CLI_TIMEOUT"
  | "CLI_FAILED"
  | "CLI_MALFORMED_OUTPUT"
  | "CLI_SPAWN_ERROR";

export interface UnityCliOk<T> {
  ok: true;
  data: T;
  warnings: string[];
  durationMs: number;
  binary: string;
}

export interface UnityCliErr {
  ok: false;
  code: UnityCliFailureCode;
  message: string;
  durationMs: number;
  /** Non-JSON output kept for diagnostics; truncated so it can be logged safely. */
  output?: string;
  exitCode?: number | null;
  binary?: string;
}

export type UnityCliResult<T> = UnityCliOk<T> | UnityCliErr;

export interface RunOptions {
  /** Hard deadline. The child is SIGTERM'd, then SIGKILL'd 2s later. */
  timeoutMs?: number;
  cwd?: string;
  /** Explicit binary path (config/setting), before env + PATH discovery. */
  cliPath?: string;
  /** Streams stdout/stderr lines as they arrive — used for install/build progress. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

/** Raw shape of the CLI's `--json` envelope (v1.0.0-beta.5). */
interface CliEnvelope<T> {
  success?: boolean;
  command?: string;
  data?: T;
  errors?: Array<{ code?: string; message?: string } | string>;
  warnings?: Array<{ message?: string } | string>;
}

const MAX_KEPT_OUTPUT = 4_000;
/**
 * Flags appended to every call. `--no-pager` is deliberately absent: the beta CLI advertises it as
 * a global option but its subcommands reject it (`unity editors --no-pager` exits 2), so paging is
 * suppressed through UNITY_NO_PAGER in the environment instead.
 */
const GLOBAL_FLAGS = ["--json", "--non-interactive", "--no-banner"];

const FORCED_ENV = {
  UNITY_FORMAT: "json",
  UNITY_NON_INTERACTIVE: "1",
  UNITY_NO_BANNER: "1",
  UNITY_NO_PAGER: "1",
  // The CLI colours human output; JSON mode shouldn't carry escape codes if it ever regresses.
  NO_COLOR: "1",
};

export function resolveCli(cliPath?: string): CliLocation | null {
  return locateUnityCli(cliPath);
}

/**
 * Run a Unity CLI subcommand and parse its JSON envelope.
 *
 * `args` is the subcommand plus its own flags; the global JSON/non-interactive flags are added
 * here so no caller can forget them.
 */
export async function runUnityCli<T = unknown>(
  args: string[],
  opts: RunOptions = {}
): Promise<UnityCliResult<T>> {
  const started = Date.now();
  const located = resolveCli(opts.cliPath);
  if (!located) {
    return {
      ok: false,
      code: "CLI_NOT_FOUND",
      message:
        "The Unity CLI (`unity`) was not found. Install it from Unity, or set unityCliPath in .unity-vibe/config.json.",
      durationMs: Date.now() - started,
    };
  }

  const collected = await spawnCollect(located.path, [...args, ...GLOBAL_FLAGS], {
    ...opts,
    timeoutMs: opts.timeoutMs ?? 30_000,
  });
  const durationMs = Date.now() - started;

  if (collected.spawnError) {
    return {
      ok: false,
      code: "CLI_SPAWN_ERROR",
      message: `Could not run ${located.path}: ${collected.spawnError}`,
      durationMs,
      binary: located.path,
    };
  }

  const envelope = parseEnvelope<T>(collected.stdout) ?? parseEnvelope<T>(collected.stderr);

  if (collected.timedOut) {
    return {
      ok: false,
      code: "CLI_TIMEOUT",
      message: `\`unity ${args[0] ?? ""}\` did not finish within ${opts.timeoutMs ?? 30_000}ms and was terminated.`,
      durationMs,
      output: truncate(collected.stdout || collected.stderr),
      binary: located.path,
    };
  }

  if (!envelope) {
    return {
      ok: false,
      code: collected.exitCode === 0 ? "CLI_MALFORMED_OUTPUT" : "CLI_FAILED",
      message:
        collected.exitCode === 0
          ? `\`unity ${args[0] ?? ""}\` returned output that is not the expected JSON envelope.`
          : `\`unity ${args[0] ?? ""}\` exited with code ${collected.exitCode}.`,
      durationMs,
      output: truncate(collected.stderr || collected.stdout),
      exitCode: collected.exitCode,
      binary: located.path,
    };
  }

  const warnings = normalizeMessages(envelope.warnings);
  if (envelope.success === false || (collected.exitCode !== 0 && envelope.data === undefined)) {
    const errors = normalizeMessages(envelope.errors);
    return {
      ok: false,
      code: "CLI_FAILED",
      message: errors[0] ?? `\`unity ${args[0] ?? ""}\` failed.`,
      durationMs,
      output: truncate(errors.join("; ")),
      exitCode: collected.exitCode,
      binary: located.path,
    };
  }

  return {
    ok: true,
    data: (envelope.data ?? ({} as T)) as T,
    warnings,
    durationMs,
    binary: located.path,
  };
}

/**
 * Run the CLI with no global flags and return its plain stdout. Only `--version` needs this:
 * it prints a bare version string rather than the JSON envelope, and it is the cheapest possible
 * liveness probe (~10ms) — unlike `unity doctor`, which verifies the account over the network.
 */
export async function runUnityCliRaw(
  args: string[],
  opts: RunOptions = {}
): Promise<{ ok: boolean; stdout: string; message?: string; binary?: string }> {
  const located = resolveCli(opts.cliPath);
  if (!located) return { ok: false, stdout: "", message: "The Unity CLI (`unity`) was not found." };
  const collected = await spawnCollect(located.path, args, { ...opts, timeoutMs: opts.timeoutMs ?? 10_000 });
  if (collected.spawnError) return { ok: false, stdout: "", message: collected.spawnError, binary: located.path };
  if (collected.timedOut) return { ok: false, stdout: collected.stdout, message: "timed out", binary: located.path };
  return {
    ok: collected.exitCode === 0,
    stdout: collected.stdout.trim(),
    message: collected.exitCode === 0 ? undefined : truncate(collected.stderr || collected.stdout),
    binary: located.path,
  };
}

/**
 * Start a Unity CLI subcommand and stop *waiting* after `settleMs` without killing it.
 *
 * `unity open` hands the project to a freshly spawned Editor; whether the CLI process outlives
 * that launch is an implementation detail we must not depend on — and killing it could take the
 * Editor with it. So: detach, watch briefly for an early failure, then let it go and let the
 * caller confirm success by polling the bridge instead.
 */
export async function launchUnityCli(
  args: string[],
  opts: RunOptions & { settleMs?: number } = {}
): Promise<{ started: boolean; exitedEarly: boolean; message?: string; binary?: string }> {
  const located = resolveCli(opts.cliPath);
  if (!located) {
    return {
      started: false,
      exitedEarly: false,
      message: "The Unity CLI (`unity`) was not found on this machine.",
    };
  }
  const settleMs = opts.settleMs ?? 8_000;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(located.path, [...args, ...GLOBAL_FLAGS], {
      cwd: opts.cwd,
      env: { ...process.env, ...FORCED_ENV },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const finish = (result: { started: boolean; exitedEarly: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, binary: located.path });
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => finish({ started: false, exitedEarly: true, message: error.message }));
    child.on("exit", (code) => {
      if (code === 0) return finish({ started: true, exitedEarly: true });
      const envelope = parseEnvelope<unknown>(stdout) ?? parseEnvelope<unknown>(stderr);
      const errors = normalizeMessages(envelope?.errors);
      finish({
        started: false,
        exitedEarly: true,
        message:
          errors[0] ??
          (truncate(stderr || stdout) || `\`unity ${args[0] ?? ""}\` exited with code ${code}.`),
      });
    });
    const timer = setTimeout(() => {
      // Still running past the settle window: the launch is underway. Release our handles so the
      // MCP server / CLI process can exit without waiting on Unity's lifetime.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish({ started: true, exitedEarly: false });
    }, settleMs);
    timer.unref?.();
  });
}

/**
 * Ask macOS to launch an app bundle (`/usr/bin/open`). Separate from launchUnityCli because it is
 * not the Unity CLI at all: `open` returns immediately once LaunchServices has accepted the
 * request, and a non-zero exit is the only failure worth reporting.
 */
export function launchViaLaunchServices(
  args: string[],
  opts: RunOptions = {}
): Promise<{ started: boolean; exitedEarly: boolean; message?: string; binary?: string }> {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/open", args, {
      cwd: opts.cwd,
      env: { ...process.env, ...FORCED_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) =>
      resolve({ started: false, exitedEarly: true, message: error.message, binary: "/usr/bin/open" })
    );
    child.on("exit", (code) =>
      resolve({
        started: code === 0,
        exitedEarly: true,
        ...(code === 0 ? {} : { message: truncate(stderr) ?? `open exited with code ${code}` }),
        binary: "/usr/bin/open",
      })
    );
  });
}

interface Collected {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
}

function spawnCollect(binary: string, args: string[], opts: RunOptions): Promise<Collected> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const child = spawn(binary, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...FORCED_ENV },
      // Closed stdin: an interactive prompt that slipped past --non-interactive gets EOF, not a hang.
      stdio: ["ignore", "pipe", "pipe"],
    });

    const lineBuffers = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", chunk: string) => {
      if (!opts.onLine) return;
      lineBuffers[stream] += chunk;
      const parts = lineBuffers[stream].split(/\r?\n/);
      lineBuffers[stream] = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) opts.onLine(line, stream);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      feed("stdout", text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      feed("stderr", text);
    });

    const settle = (result: Collected) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      resolve(result);
    };

    let hardKillTimer: NodeJS.Timeout | undefined;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      hardKillTimer.unref?.();
    }, opts.timeoutMs ?? 30_000);
    killTimer.unref?.();

    child.on("error", (error: Error) =>
      settle({ stdout, stderr, exitCode: null, timedOut, spawnError: error.message })
    );
    child.on("close", (code) => settle({ stdout, stderr, exitCode: code, timedOut }));
  });
}

/**
 * Pull the JSON envelope out of possibly-noisy output (a banner, a progress line, an update
 * notice). Tries the whole string first, then the widest brace-delimited span.
 */
export function parseEnvelope<T>(raw: string): CliEnvelope<T> | null {
  const text = raw.trim();
  if (!text) return null;
  const direct = tryParse<T>(text);
  if (direct) return direct;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const span = tryParse<T>(text.slice(first, last + 1));
    if (span) return span;
  }
  // ndjson-ish fallback: the last line that parses on its own.
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const parsed = tryParse<T>(line.trim());
    if (parsed) return parsed;
  }
  return null;
}

function tryParse<T>(text: string): CliEnvelope<T> | null {
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const envelope = value as CliEnvelope<T>;
    // Distinguish the CLI envelope from any other JSON that happens to be on stdout.
    if ("success" in envelope || "data" in envelope || "command" in envelope) return envelope;
    return null;
  } catch {
    return null;
  }
}

function normalizeMessages(items: Array<{ message?: string; code?: string } | string> | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const code = "code" in item && item.code ? `${item.code}: ` : "";
        return item.message ? `${code}${item.message}` : code.replace(/: $/, "");
      }
      return "";
    })
    .filter((message) => message.length > 0);
}

function truncate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_KEPT_OUTPUT ? `${trimmed.slice(0, MAX_KEPT_OUTPUT)}…` : trimmed;
}
