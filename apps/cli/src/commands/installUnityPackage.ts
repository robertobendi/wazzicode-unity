import { promises as fs, existsSync as fsExistsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";

const PACKAGE_NAME = "com.uvibe.os";

export async function runInstallUnityPackage(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const mode = (typeof parsed.flags.mode === "string" ? parsed.flags.mode : "manifest") as
    | "manifest"
    | "symlink"
    | "copy";

  const sourcePkg = await locateUnityPackageSource();
  if (!sourcePkg) {
    return {
      exitCode: 1,
      stderr:
        "Could not locate unity/UnityVibeOS in this monorepo. Run from a checkout of the wazzicode-unity repo, or pass --source=<path>.\n",
    };
  }

  const sourceArg = typeof parsed.flags.source === "string" ? parsed.flags.source : sourcePkg;

  if (!(await dirExists(g.project))) {
    return { exitCode: 1, stderr: `project path does not exist: ${g.project}\n` };
  }
  const projectPackages = path.join(g.project, "Packages");
  if (!(await dirExists(projectPackages))) {
    return {
      exitCode: 1,
      stderr: `Not a Unity project (no Packages/ at ${g.project}). Pass --project=<unity-dir>.\n`,
    };
  }

  const lines: string[] = [];
  lines.push(`Source:  ${sourceArg}`);
  lines.push(`Target:  ${g.project}`);
  lines.push(`Mode:    ${mode}`);
  lines.push("");

  if (mode === "manifest") {
    const manifestPath = path.join(projectPackages, "manifest.json");
    if (!(await fileExists(manifestPath))) {
      return { exitCode: 1, stderr: `Packages/manifest.json missing at ${manifestPath}\n` };
    }
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { dependencies?: Record<string, string> };
    manifest.dependencies = manifest.dependencies ?? {};
    const rel = pathToFileUrl(sourceArg);
    manifest.dependencies[PACKAGE_NAME] = rel;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    lines.push(`Wrote ${manifestPath}`);
    lines.push(`  "${PACKAGE_NAME}": "${rel}"`);
  } else if (mode === "symlink") {
    const dest = path.join(projectPackages, PACKAGE_NAME);
    if (await pathExists(dest)) {
      return {
        exitCode: 1,
        stderr: `${dest} already exists. Remove it first or use --mode=manifest.\n`,
      };
    }
    await fs.symlink(sourceArg, dest, "dir");
    lines.push(`symlinked ${dest} → ${sourceArg}`);
  } else if (mode === "copy") {
    const dest = path.join(projectPackages, PACKAGE_NAME);
    if (await pathExists(dest)) {
      return {
        exitCode: 1,
        stderr: `${dest} already exists. Remove it first or use --mode=manifest.\n`,
      };
    }
    await copyDir(sourceArg, dest);
    lines.push(`copied ${sourceArg} → ${dest}`);
  } else {
    return { exitCode: 2, stderr: `unknown --mode=${mode}. Use manifest|symlink|copy.\n` };
  }

  lines.push("");
  lines.push("Next: open the Unity project. The bridge auto-starts at 127.0.0.1:38578.");
  lines.push("Verify with: uvibe doctor --project=" + g.project);

  if (g.json) {
    return { exitCode: 0, stdout: JSON.stringify({ source: sourceArg, target: g.project, mode }, null, 2) + "\n" };
  }
  return { exitCode: 0, stdout: lines.join("\n") + "\n" };
}

async function locateUnityPackageSource(): Promise<string | null> {
  const here = fileURLToPath(import.meta.url);
  let dir = path.dirname(here);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "unity", "UnityVibeOS");
    if (fsExistsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
    const s = await fs.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
    else if (e.isSymbolicLink()) {
      const target = await fs.readlink(s);
      await fs.symlink(target, d);
    }
  }
}

function pathToFileUrl(absPath: string): string {
  // Unity Packages/manifest.json supports `file:<path>` (relative to manifest.json).
  // Use the platform-appropriate format. We always emit absolute file: URLs for clarity.
  return "file:" + absPath;
}
