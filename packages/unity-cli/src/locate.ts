import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the official Unity CLI (`unity`, v1.0.0-beta and newer) lives on this machine.
 *
 * The CLI is an *optional accelerator*: it is user-installed, still in beta, and absent on most
 * machines. Every caller must degrade to the previous behaviour when it isn't found, so location
 * failure is a value here, never an exception.
 */
export interface CliLocation {
  path: string;
  /** How we found it — surfaced in doctor so a wrong binary is obvious. */
  source: "explicit" | "env" | "path" | "well-known";
}

const BINARY_NAMES = process.platform === "win32" ? ["unity.exe", "unity.cmd", "unity.bat"] : ["unity"];

/** Fixed install locations, in the order the Unity installer actually uses them. */
function wellKnownCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    return [
      path.join(home, ".unity", "bin", "unity.exe"),
      path.join(localAppData, "Programs", "Unity CLI", "unity.exe"),
      path.join(localAppData, "UnityHub", "unity.exe"),
      path.join(programFiles, "Unity", "CLI", "unity.exe"),
    ];
  }
  return [
    path.join(home, ".unity", "bin", "unity"),
    "/usr/local/bin/unity",
    "/opt/homebrew/bin/unity",
    "/usr/bin/unity",
  ];
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH lookup without spawning `which` — this runs on every MCP server start. */
function fromPath(): string | null {
  const raw = process.env.PATH;
  if (!raw) return null;
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of BINARY_NAMES) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve the Unity CLI binary. `explicit` comes from `.unity-vibe/config.json`'s `unityCliPath`
 * (or a Tauri setting); `UVIBE_UNITY_CLI` overrides discovery for CI and tests.
 */
export function locateUnityCli(explicit?: string): CliLocation | null {
  if (explicit && isExecutableFile(explicit)) return { path: explicit, source: "explicit" };
  const fromEnv = process.env.UVIBE_UNITY_CLI;
  if (fromEnv && isExecutableFile(fromEnv)) return { path: fromEnv, source: "env" };
  const onPath = fromPath();
  if (onPath) return { path: onPath, source: "path" };
  for (const candidate of wellKnownCandidates()) {
    if (isExecutableFile(candidate)) return { path: candidate, source: "well-known" };
  }
  return null;
}
