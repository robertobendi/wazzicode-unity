import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectUnityProject, scanProject, generateBrain, readBrain } from "@uvibe/project-brain";

const FIXTURE = path.resolve("tests/fixtures/sample-unity-project");
let workDir: string;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "uvibe-brain-test-"));
  await copyDir(FIXTURE, workDir);
});

afterAll(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

describe("project-brain/detect", () => {
  it("recognizes a Unity project", async () => {
    const r = await detectUnityProject(FIXTURE);
    expect(r.isUnityProject).toBe(true);
    expect(r.unityVersion).toBe("2022.3.42f1");
    expect(r.productName).toBe("SampleGame");
    expect(r.companyName).toBe("SampleStudio");
    expect(r.renderPipeline).toBe("URP");
    expect(r.inputSystem).toBe("InputSystem");
    expect(r.packages?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns isUnityProject=false for empty dirs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "uvibe-brain-empty-"));
    try {
      const r = await detectUnityProject(tmp);
      expect(r.isUnityProject).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("project-brain/scan", () => {
  it("finds scenes, scripts, and skips meta files", async () => {
    const r = await scanProject(FIXTURE);
    expect(r.scenes).toContain("Assets/Scenes/Sample.unity");
    expect(r.scripts.some((s) => s.endsWith("PlayerController.cs"))).toBe(true);
    expect(r.scripts.some((s) => s.endsWith("WeaponData.cs"))).toBe(true);
    expect(r.scripts.some((s) => s.endsWith("AudioManager.cs"))).toBe(true);
  });
});

describe("project-brain/generate", () => {
  it("writes the five brain files into .unity-vibe/", async () => {
    const r = await generateBrain({ projectPath: workDir, write: true });
    expect(r.brain.identity.isUnityProject).toBe(true);
    expect(r.brain.engine.unityVersion).toBe("2022.3.42f1");
    expect(r.brain.architecture.scriptableObjectTypes).toContain("WeaponData");
    expect(r.brain.architecture.hasAudioManager).toBe(true);

    const brainDir = path.join(workDir, ".unity-vibe");
    for (const name of ["project_brain.md", "project_brain.json", "claude_context.md", "conventions.md", "config.json"]) {
      await fs.access(path.join(brainDir, name));
    }

    const reread = await readBrain(workDir);
    expect(reread).not.toBeNull();
    expect(reread?.engine.unityVersion).toBe("2022.3.42f1");
  });

  it("does not overwrite existing conventions.md", async () => {
    const conv = path.join(workDir, ".unity-vibe", "conventions.md");
    const tag = "## CUSTOM_TAG_PRESERVED";
    await fs.appendFile(conv, "\n" + tag + "\n");
    await generateBrain({ projectPath: workDir, write: true });
    const after = await fs.readFile(conv, "utf8");
    expect(after).toContain(tag);
  });
});

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}
