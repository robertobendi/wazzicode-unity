import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, readEditorPackageStatus, type EditorPackageStatus } from "./status.js";

/**
 * Installing the `com.uvibe.os` Editor package into a Unity project.
 *
 * Extracted from the `uvibe install-unity-package` command so the MCP server can run the same
 * code path when it finds a project carrying a stale copy — one implementation, one set of
 * edge cases (manifest formatting, stale absolute `file:` entries, symlink handling).
 */

export type InstallModeRequest = "copy" | "manifest" | "symlink";

export interface InstallResult {
  source: string;
  target: string;
  mode: InstallModeRequest;
  /** Manifest mode: the reference written into Packages/manifest.json. */
  manifestRef?: string;
  /** Manifest mode: true when the reference had to be absolute (machine-specific). */
  absoluteRef?: boolean;
  /** Copy/symlink mode: a stale manifest entry we removed while embedding. */
  removedManifestEntry?: string;
}

export class UnityPackageInstallError extends Error {}

/**
 * Locate the `unity/UnityVibeOS` source tree.
 *
 * Order matters: an explicit path wins (the desktop app ships its own bundled copy outside the
 * monorepo), then the env override, then a walk up from this module — which works from `dist/`
 * in a checkout and from the bundled `uvibe.cjs` alike.
 */
export function resolvePackageSource(explicit?: string | null): string | null {
  if (explicit && existsSync(path.join(explicit, "package.json"))) return explicit;
  const fromEnv = process.env.UVIBE_UNITY_PACKAGE_SOURCE;
  if (fromEnv && existsSync(path.join(fromEnv, "package.json"))) return fromEnv;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "unity", "UnityVibeOS");
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function installUnityPackage(
  projectPath: string,
  opts: { mode?: InstallModeRequest; source?: string | null } = {}
): Promise<InstallResult> {
  const mode = opts.mode ?? "copy";
  const source = resolvePackageSource(opts.source);
  if (!source) {
    throw new UnityPackageInstallError(
      "Could not locate unity/UnityVibeOS. Run from a checkout of the wazzicode-unity repo, pass an explicit source, or set UVIBE_UNITY_PACKAGE_SOURCE."
    );
  }
  if (!(await dirExists(projectPath))) {
    throw new UnityPackageInstallError(`project path does not exist: ${projectPath}`);
  }
  const projectPackages = path.join(projectPath, "Packages");
  if (!(await dirExists(projectPackages))) {
    throw new UnityPackageInstallError(`Not a Unity project (no Packages/ at ${projectPath}).`);
  }
  const manifestPath = path.join(projectPackages, "manifest.json");

  if (mode === "manifest") {
    if (!(await fileExists(manifestPath))) {
      throw new UnityPackageInstallError(`Packages/manifest.json missing at ${manifestPath}`);
    }
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { dependencies?: Record<string, string>; testables?: string[] };
    manifest.dependencies = manifest.dependencies ?? {};
    // Prefer a path RELATIVE to Packages/ so the entry resolves on any clone; fall back to an
    // absolute path only when the source lives on a different drive (then it is machine-specific).
    const [canonicalPackages, canonicalSource] = await Promise.all([
      fs.realpath(projectPackages),
      fs.realpath(source),
    ]);
    const rel = relativeFileUrl(canonicalPackages, canonicalSource);
    const ref = rel ?? pathToFileUrl(canonicalSource);
    manifest.dependencies[PACKAGE_NAME] = ref;
    manifest.testables = manifest.testables ?? [];
    if (!manifest.testables.includes(PACKAGE_NAME)) manifest.testables.push(PACKAGE_NAME);
    await fs.writeFile(manifestPath, formatJsonLike(raw, manifest), "utf8");
    return { source, target: projectPath, mode, manifestRef: ref, absoluteRef: rel === null };
  }

  // Place the package under Packages/<name>, where Unity auto-discovers it as an embedded
  // package — no manifest entry, no absolute paths. Also strip any stale com.uvibe.os entry
  // (e.g. a prior absolute `file:` install) that would fail to resolve on a teammate's machine.
  const dest = path.join(projectPackages, PACKAGE_NAME);
  const removed = await removeManifestEntry(manifestPath, PACKAGE_NAME);
  if (await pathExists(dest)) await fs.rm(dest, { recursive: true, force: true });

  if (mode === "symlink") {
    await fs.symlink(source, dest, "dir");
  } else {
    await copyDir(source, dest);
  }
  return {
    source,
    target: projectPath,
    mode,
    ...(removed ? { removedManifestEntry: removed } : {}),
  };
}

export interface EnsureCurrentResult {
  status: EditorPackageStatus;
  updated: boolean;
  /** The version that was replaced, when we updated. */
  previousVersion?: string;
  /** Why nothing happened, when `updated` is false. */
  skipped?: "current" | "not-installed" | "not-embedded" | "no-source" | "disabled" | "failed";
  error?: string;
}

/**
 * Bring a project's embedded Editor package back in line with this build — the self-healing half
 * of the version check. Safe to call on every server start: it re-reads the status afterwards, is
 * a no-op when the copy already matches, and never touches symlink / `file:`-manifest installs,
 * which resolve to the source tree itself.
 */
export async function ensureEditorPackageCurrent(
  projectPath: string,
  opts: { enabled?: boolean; source?: string | null } = {}
): Promise<EnsureCurrentResult> {
  const status = await readEditorPackageStatus(projectPath);
  if (opts.enabled === false) return { status, updated: false, skipped: "disabled" };
  if (!status.detected) return { status, updated: false, skipped: "not-installed" };
  if (!status.needsUpdate) {
    return {
      status,
      updated: false,
      skipped: status.current === false ? "not-embedded" : "current",
    };
  }
  if (!resolvePackageSource(opts.source)) {
    return { status, updated: false, skipped: "no-source" };
  }
  try {
    await installUnityPackage(projectPath, { mode: "copy", source: opts.source ?? null });
  } catch (error) {
    return {
      status,
      updated: false,
      skipped: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    status: await readEditorPackageStatus(projectPath),
    updated: true,
    ...(status.version ? { previousVersion: status.version } : {}),
  };
}

/** Preserve the manifest's existing indentation and line endings — it is a file users read. */
function formatJsonLike(raw: string, value: unknown): string {
  const body = raw.replace(/\r?\n$/, "");
  const indent = raw.match(/\r?\n([ \t]+)"/)?.[1] ?? (body.includes("\n") ? 2 : undefined);
  const trailingNewline = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
  const formatted = JSON.stringify(value, null, indent);
  return (raw.includes("\r\n") ? formatted.replace(/\n/g, "\r\n") : formatted) + trailingNewline;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
    else if (entry.isSymbolicLink()) await fs.symlink(await fs.readlink(from), to);
  }
}

function pathToFileUrl(absPath: string): string {
  // Absolute `file:` URL. Machine-specific — only used as a last resort (cross-drive); prefer
  // relativeFileUrl, or the default copy/embed which needs no path at all.
  return "file:" + absPath.split(path.sep).join("/");
}

/**
 * A `file:` URL relative to the project's Packages/ folder (how Unity resolves manifest file:
 * paths). Portable across clones. Returns null when no relative path exists (different drive).
 */
function relativeFileUrl(packagesDir: string, sourceAbs: string): string | null {
  const rel = path.relative(packagesDir, sourceAbs);
  if (!rel || path.isAbsolute(rel)) return null;
  return "file:" + rel.split(path.sep).join("/");
}

/**
 * Remove a dependency from Packages/manifest.json if present. Returns the old value (so the
 * caller can report it) or null. Used to clear a stale absolute-path entry before embedding.
 */
async function removeManifestEntry(manifestPath: string, name: string): Promise<string | null> {
  if (!(await fileExists(manifestPath))) return null;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { dependencies?: Record<string, string> };
    if (manifest.dependencies && Object.prototype.hasOwnProperty.call(manifest.dependencies, name)) {
      const old = manifest.dependencies[name];
      delete manifest.dependencies[name];
      await fs.writeFile(manifestPath, formatJsonLike(raw, manifest), "utf8");
      return old;
    }
  } catch {
    // Leave a malformed manifest untouched; the embed still works (auto-discovery).
  }
  return null;
}
