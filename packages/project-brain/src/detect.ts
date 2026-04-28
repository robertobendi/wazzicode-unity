import { promises as fs } from "node:fs";
import path from "node:path";

export interface UnityProjectDetection {
  isUnityProject: boolean;
  projectPath: string;
  unityVersion?: string;
  unityRevision?: string;
  productName?: string;
  companyName?: string;
  bundleIdentifier?: string;
  defaultBuildTarget?: string;
  packages?: Array<{ name: string; version: string }>;
  renderPipeline?: string;
  inputSystem?: string;
  scriptingBackend?: string;
}

export async function detectUnityProject(projectPath: string): Promise<UnityProjectDetection> {
  const result: UnityProjectDetection = {
    isUnityProject: false,
    projectPath,
  };

  const assetsExists = await pathExists(path.join(projectPath, "Assets"));
  const settingsExists = await pathExists(path.join(projectPath, "ProjectSettings"));
  const packagesExists = await pathExists(path.join(projectPath, "Packages"));
  if (!(assetsExists && settingsExists && packagesExists)) {
    return result;
  }

  result.isUnityProject = true;

  const versionTxt = await readFileOrNull(path.join(projectPath, "ProjectSettings", "ProjectVersion.txt"));
  if (versionTxt) {
    const v = /m_EditorVersion:\s*(\S+)/.exec(versionTxt);
    if (v) result.unityVersion = v[1];
    const r = /m_EditorVersionWithRevision:\s*([^\n\r]+)/.exec(versionTxt);
    if (r) result.unityRevision = r[1].trim();
  }

  const projectSettings = await readFileOrNull(path.join(projectPath, "ProjectSettings", "ProjectSettings.asset"));
  if (projectSettings) {
    const product = /productName:\s*(.+)/.exec(projectSettings);
    if (product) result.productName = product[1].trim();
    const company = /companyName:\s*(.+)/.exec(projectSettings);
    if (company) result.companyName = company[1].trim();
    const bundle = /bundleVersion:\s*(.+)/.exec(projectSettings); // version, not bundleId
    if (bundle) {
      // continue; bundleIdentifier comes below
    }
    const bid = /applicationIdentifier:\s*\n?\s+\S+:\s*([\w.\-]+)/.exec(projectSettings);
    if (bid) result.bundleIdentifier = bid[1];
    const sb = /scriptingBackend:\s*\n?\s+\S+:\s*(\d+)/.exec(projectSettings);
    if (sb) result.scriptingBackend = sb[1] === "1" ? "IL2CPP" : "Mono";
    const at = /activeBuildTarget:\s*(\d+)/.exec(projectSettings);
    if (at) result.defaultBuildTarget = mapBuildTarget(Number(at[1]));
  }

  const manifestRaw = await readFileOrNull(path.join(projectPath, "Packages", "manifest.json"));
  if (manifestRaw) {
    try {
      const json = JSON.parse(manifestRaw) as { dependencies?: Record<string, string> };
      const deps = json.dependencies ?? {};
      result.packages = Object.entries(deps).map(([name, version]) => ({ name, version }));
      result.renderPipeline = inferRenderPipeline(result.packages);
      result.inputSystem = inferInputSystem(result.packages);
    } catch {
      /* ignore */
    }
  }

  return result;
}

function inferRenderPipeline(pkgs: Array<{ name: string; version: string }>): string {
  const names = pkgs.map((p) => p.name);
  if (names.includes("com.unity.render-pipelines.high-definition")) return "HDRP";
  if (names.includes("com.unity.render-pipelines.universal")) return "URP";
  return "Built-in";
}

function inferInputSystem(pkgs: Array<{ name: string; version: string }>): string {
  return pkgs.some((p) => p.name === "com.unity.inputsystem") ? "InputSystem" : "Legacy InputManager";
}

function mapBuildTarget(id: number): string {
  switch (id) {
    case 5: return "PCStandalone";
    case 9: return "iOS";
    case 13: return "Android";
    case 19: return "WebGL";
    case 24: return "StandaloneLinux64";
    case 25: return "StandaloneOSX";
    case 27: return "StandaloneWindows64";
    default: return `Unknown(${id})`;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readFileOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
