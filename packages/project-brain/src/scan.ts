import { promises as fs } from "node:fs";
import path from "node:path";

export interface ProjectScan {
  scenes: string[];
  prefabs: string[];
  scripts: string[];
  scriptableObjectAssets: string[];
  materials: string[];
  textures: string[];
  audio: string[];
  totalAssets: number;
  scannedRoots: string[];
}

const SCENE_EXT = ".unity";
const PREFAB_EXT = ".prefab";
const SCRIPT_EXT = ".cs";
const SO_LIKELY_EXT = ".asset";
const MATERIAL_EXT = ".mat";
const TEXTURE_EXTS = new Set([".png", ".jpg", ".jpeg", ".tga", ".psd", ".tif", ".tiff", ".exr", ".hdr"]);
const AUDIO_EXTS = new Set([".wav", ".ogg", ".mp3", ".aif", ".aiff", ".flac"]);

const SKIP_DIR_NAMES = new Set([
  "Library",
  "Temp",
  "Logs",
  "obj",
  "Build",
  "Builds",
  ".git",
  "node_modules",
  ".unity-vibe",
  ".vs",
  ".idea",
  ".vscode",
]);

export async function scanProject(projectPath: string, opts: { maxFiles?: number } = {}): Promise<ProjectScan> {
  const maxFiles = opts.maxFiles ?? 25_000;
  const scan: ProjectScan = {
    scenes: [],
    prefabs: [],
    scripts: [],
    scriptableObjectAssets: [],
    materials: [],
    textures: [],
    audio: [],
    totalAssets: 0,
    scannedRoots: [],
  };

  const roots = ["Assets", "Packages"];
  for (const root of roots) {
    const abs = path.join(projectPath, root);
    if (!(await exists(abs))) continue;
    scan.scannedRoots.push(root);
    await walk(abs, scan, projectPath, maxFiles);
  }

  scan.scenes.sort();
  scan.prefabs.sort();
  scan.scripts.sort();
  scan.scriptableObjectAssets.sort();
  scan.materials.sort();
  return scan;
}

async function walk(absDir: string, scan: ProjectScan, projectRoot: string, maxFiles: number): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (scan.totalAssets >= maxFiles) return;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      // Skip Unity special dirs marked with ~
      if (entry.name.endsWith("~")) continue;
      await walk(abs, scan, projectRoot, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === ".meta") continue;
    scan.totalAssets++;
    if (ext === SCENE_EXT) scan.scenes.push(rel);
    else if (ext === PREFAB_EXT) scan.prefabs.push(rel);
    else if (ext === SCRIPT_EXT) scan.scripts.push(rel);
    else if (ext === SO_LIKELY_EXT) scan.scriptableObjectAssets.push(rel);
    else if (ext === MATERIAL_EXT) scan.materials.push(rel);
    else if (TEXTURE_EXTS.has(ext)) scan.textures.push(rel);
    else if (AUDIO_EXTS.has(ext)) scan.audio.push(rel);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
