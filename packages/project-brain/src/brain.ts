import { promises as fs } from "node:fs";
import path from "node:path";
import { writeConfigIfMissing } from "@uvibe/safety";
import { detectUnityProject, UnityProjectDetection } from "./detect.js";
import { scanProject, ProjectScan } from "./scan.js";
import { analyzeScripts, ScriptHeuristics } from "./heuristics.js";
import {
  renderBrainMarkdown,
  renderClaudeContextMarkdown,
  DEFAULT_CONVENTIONS_MD,
} from "./templates.js";

export interface Brain {
  generatedAt: number;
  identity: {
    projectPath: string;
    isUnityProject: boolean;
    productName?: string;
    companyName?: string;
    bundleIdentifier?: string;
  };
  engine: {
    unityVersion?: string;
    unityRevision?: string;
    renderPipeline?: string;
    inputSystem?: string;
    scriptingBackend?: string;
    defaultBuildTarget?: string;
    packages?: Array<{ name: string; version: string }>;
  };
  assets: ProjectScan;
  architecture: ScriptHeuristics;
}

export interface BrainGenerationOptions {
  projectPath: string;
  write?: boolean;
}

export interface BrainGenerationResult {
  brain: Brain;
  written: string[];
}

export async function buildBrain(projectPath: string): Promise<Brain> {
  const detection: UnityProjectDetection = await detectUnityProject(projectPath);
  const scan = await scanProject(projectPath);
  const arch = await analyzeScripts(projectPath, scan.scripts);
  return {
    generatedAt: Date.now(),
    identity: {
      projectPath,
      isUnityProject: detection.isUnityProject,
      productName: detection.productName,
      companyName: detection.companyName,
      bundleIdentifier: detection.bundleIdentifier,
    },
    engine: {
      unityVersion: detection.unityVersion,
      unityRevision: detection.unityRevision,
      renderPipeline: detection.renderPipeline,
      inputSystem: detection.inputSystem,
      scriptingBackend: detection.scriptingBackend,
      defaultBuildTarget: detection.defaultBuildTarget,
      packages: detection.packages,
    },
    assets: scan,
    architecture: arch,
  };
}

export async function generateBrain(opts: BrainGenerationOptions): Promise<BrainGenerationResult> {
  const brain = await buildBrain(opts.projectPath);
  const write = opts.write ?? true;
  const written: string[] = [];
  if (write) {
    const dir = path.join(opts.projectPath, ".unity-vibe");
    await fs.mkdir(dir, { recursive: true });

    const jsonPath = path.join(dir, "project_brain.json");
    await fs.writeFile(jsonPath, JSON.stringify(brain, null, 2) + "\n", "utf8");
    written.push(jsonPath);

    const mdPath = path.join(dir, "project_brain.md");
    await fs.writeFile(mdPath, renderBrainMarkdown(brain), "utf8");
    written.push(mdPath);

    const claudeCtxPath = path.join(dir, "claude_context.md");
    await fs.writeFile(claudeCtxPath, renderClaudeContextMarkdown(brain), "utf8");
    written.push(claudeCtxPath);

    const conventionsPath = path.join(dir, "conventions.md");
    if (!(await fileExists(conventionsPath))) {
      await fs.writeFile(conventionsPath, DEFAULT_CONVENTIONS_MD, "utf8");
      written.push(conventionsPath);
    }

    const cfg = await writeConfigIfMissing(opts.projectPath);
    if (cfg.written) written.push(cfg.path);
  }
  return { brain, written };
}

export async function readBrain(projectPath: string): Promise<Brain | null> {
  const file = path.join(projectPath, ".unity-vibe", "project_brain.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as Brain;
  } catch {
    return null;
  }
}

export async function brainAgeMs(projectPath: string): Promise<number | null> {
  const brain = await readBrain(projectPath);
  if (!brain) return null;
  return Date.now() - brain.generatedAt;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
