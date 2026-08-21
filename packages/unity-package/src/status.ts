import { promises as fs } from "node:fs";
import path from "node:path";
import { PRODUCT_VERSION } from "@uvibe/core";

/**
 * Where a project's `com.uvibe.os` Editor package lives, and whether it still matches the MCP
 * server driving it.
 *
 * The two halves ship together and speak one protocol version, so a project carrying an older
 * embedded copy than the server is a real defect: methods the server calls may not exist in the
 * Editor yet. Detection has to cover every install mode the CLI can produce, because they
 * behave differently when they go stale — see `staleness` below.
 */

export const PACKAGE_NAME = "com.uvibe.os";

export type InstallMode =
  /** A portable copy under `Packages/com.uvibe.os` — the default, and the only one we can refresh. */
  | "embedded"
  /** `Packages/manifest.json` holds a `file:` reference to the source tree. */
  | "manifest"
  /** `Packages/com.uvibe.os` is a symlink to the source tree. */
  | "symlink"
  /** An older layout (`Assets/UnityVibeOS`, `unity/UnityVibeOS` inside the project). */
  | "legacy";

export interface EditorPackageStatus {
  detected: boolean;
  path?: string;
  version?: string;
  manifestRef?: string;
  installMode?: InstallMode;
  /** Undefined when the installed version can't be read. */
  current?: boolean;
  /**
   * True only when we both know it is stale *and* can fix it by re-copying. A symlink or a
   * `file:` manifest reference resolves to the source tree itself: if that reads as stale, the
   * source is what's old, and overwriting it would be wrong.
   */
  needsUpdate: boolean;
  serverVersion: string;
}

export async function readEditorPackageStatus(projectPath: string): Promise<EditorPackageStatus> {
  const packagesDir = path.join(projectPath, "Packages");
  const manifestPath = path.join(packagesDir, "manifest.json");
  let manifestRef: string | undefined;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    const value = manifest.dependencies?.[PACKAGE_NAME];
    if (typeof value === "string") manifestRef = value;
  } catch {
    // A missing/malformed manifest is itself represented by the package not being found.
  }

  const embedded = path.join(packagesDir, PACKAGE_NAME);
  const candidates: Array<{ dir: string; mode: InstallMode }> = [
    { dir: embedded, mode: "embedded" },
    { dir: path.join(projectPath, "Assets", "UnityVibeOS"), mode: "legacy" },
    { dir: path.join(projectPath, "unity", "UnityVibeOS"), mode: "legacy" },
  ];
  if (manifestRef?.startsWith("file:")) {
    try {
      const raw = decodeURIComponent(manifestRef.slice("file:".length));
      candidates.unshift({
        dir: path.isAbsolute(raw) ? raw : path.resolve(packagesDir, raw),
        mode: "manifest",
      });
    } catch {
      // Leave an invalid file reference visible in manifestRef without resolving it.
    }
  }

  for (const candidate of candidates) {
    let version: string | undefined;
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(candidate.dir, "package.json"), "utf8")
      ) as { name?: unknown; version?: unknown };
      if (manifest.name !== PACKAGE_NAME) continue;
      version = typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
      continue; // Try the next supported install location.
    }
    // A symlinked "embedded" install points at the live source: refreshing it would copy the
    // source over itself. Distinguish it here so `needsUpdate` stays honest.
    let mode = candidate.mode;
    if (mode === "embedded") {
      try {
        if ((await fs.lstat(candidate.dir)).isSymbolicLink()) mode = "symlink";
      } catch {
        // Unreadable link metadata — treat it as a normal directory.
      }
    }
    const current = version === undefined ? undefined : version === PRODUCT_VERSION;
    return {
      detected: true,
      path: candidate.dir,
      ...(version !== undefined ? { version } : {}),
      ...(manifestRef !== undefined ? { manifestRef } : {}),
      installMode: mode,
      ...(current !== undefined ? { current } : {}),
      needsUpdate: mode === "embedded" && current === false,
      serverVersion: PRODUCT_VERSION,
    };
  }

  return {
    detected: Boolean(manifestRef),
    ...(manifestRef !== undefined ? { manifestRef } : {}),
    needsUpdate: false,
    serverVersion: PRODUCT_VERSION,
  };
}
