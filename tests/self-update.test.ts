import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRODUCT_VERSION } from "@uvibe/core";
import {
  ensureEditorPackageCurrent,
  installUnityPackage,
  readEditorPackageStatus,
} from "@uvibe/unity-package";
import { ensureUnityPackageCurrent, syncEditorPackage } from "@uvibe/mcp-server";
import { refreshAgentInstructions } from "@uvibe/project-brain";
import { writeConfig, DEFAULT_CONFIG } from "@uvibe/safety";
import { runUpdate } from "@uvibe/cli";
import { mcpEntryIsStale } from "../apps/cli/src/commands/mcpConfig.js";

/**
 * The Editor package and the MCP server ship as one product and must not drift. These cover the
 * self-healing path end to end: detect the drift, refresh only what is safe to refresh, and never
 * touch an install that resolves to the live source tree.
 */

let workDir: string;
let project: string;
let source: string;

const STALE = "0.0.1-stale";

async function writePackage(dir: string, version: string): Promise<void> {
  await fs.mkdir(path.join(dir, "Editor"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "com.uvibe.os", version, displayName: "Unity Vibe OS" }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(dir, "Editor", "Bridge.cs"), `// ${version}\n`, "utf8");
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "uvibe-selfupdate-"));
  project = path.join(workDir, "Project");
  await fs.mkdir(path.join(project, "ProjectSettings"), { recursive: true });
  await fs.mkdir(path.join(project, "Packages"), { recursive: true });
  await fs.mkdir(path.join(project, "Assets"), { recursive: true });
  await fs.writeFile(
    path.join(project, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 6000.0.30f1\n",
    "utf8"
  );
  await fs.writeFile(path.join(project, "Packages", "manifest.json"), '{\n  "dependencies": {}\n}\n', "utf8");

  // Stand-in for unity/UnityVibeOS, always at the current product version.
  source = path.join(workDir, "source");
  await writePackage(source, PRODUCT_VERSION);
  process.env.UVIBE_UNITY_PACKAGE_SOURCE = source;
});

afterEach(async () => {
  delete process.env.UVIBE_UNITY_PACKAGE_SOURCE;
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

describe("unity-package/status", () => {
  it("reports an absent package without inventing one", async () => {
    const status = await readEditorPackageStatus(project);
    expect(status.detected).toBe(false);
    expect(status.needsUpdate).toBe(false);
  });

  it("flags a stale embedded copy as updatable", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const status = await readEditorPackageStatus(project);
    expect(status.detected).toBe(true);
    expect(status.installMode).toBe("embedded");
    expect(status.version).toBe(STALE);
    expect(status.current).toBe(false);
    expect(status.needsUpdate).toBe(true);
  });

  it("leaves a symlinked install alone — it already resolves to the source tree", async () => {
    await fs.symlink(source, path.join(project, "Packages", "com.uvibe.os"), "dir");
    const status = await readEditorPackageStatus(project);
    expect(status.installMode).toBe("symlink");
    expect(status.needsUpdate).toBe(false);
  });

  it("resolves a `file:` manifest reference and never rewrites it", async () => {
    const external = path.join(workDir, "external");
    await writePackage(external, STALE);
    await fs.writeFile(
      path.join(project, "Packages", "manifest.json"),
      JSON.stringify({ dependencies: { "com.uvibe.os": `file:${path.relative(path.join(project, "Packages"), external)}` } }, null, 2),
      "utf8"
    );
    const status = await readEditorPackageStatus(project);
    expect(status.installMode).toBe("manifest");
    expect(status.version).toBe(STALE);
    // Stale, but the source itself is what's old — copying over it would be wrong.
    expect(status.needsUpdate).toBe(false);
  });
});

describe("unity-package/ensureEditorPackageCurrent", () => {
  it("replaces a stale embedded copy with the current one", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const result = await ensureEditorPackageCurrent(project, { enabled: true });
    expect(result.updated).toBe(true);
    expect(result.previousVersion).toBe(STALE);
    expect(result.status.version).toBe(PRODUCT_VERSION);
    const status = await readEditorPackageStatus(project);
    expect(status.current).toBe(true);
    expect(status.needsUpdate).toBe(false);
  });

  it("does nothing when the copy already matches", async () => {
    await installUnityPackage(project, { mode: "copy" });
    const result = await ensureEditorPackageCurrent(project, { enabled: true });
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe("current");
  });

  it("does nothing when the project has no package at all", async () => {
    const result = await ensureEditorPackageCurrent(project, { enabled: true });
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe("not-installed");
  });

  it("honours enabled:false", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const result = await ensureEditorPackageCurrent(project, { enabled: false });
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe("disabled");
    expect((await readEditorPackageStatus(project)).version).toBe(STALE);
  });

  it("strips a stale absolute manifest entry while embedding", async () => {
    await fs.writeFile(
      path.join(project, "Packages", "manifest.json"),
      JSON.stringify({ dependencies: { "com.uvibe.os": "file:/gone/from/this/machine" } }, null, 2),
      "utf8"
    );
    const result = await installUnityPackage(project, { mode: "copy" });
    expect(result.removedManifestEntry).toBe("file:/gone/from/this/machine");
    const manifest = JSON.parse(await fs.readFile(path.join(project, "Packages", "manifest.json"), "utf8"));
    expect(manifest.dependencies["com.uvibe.os"]).toBeUndefined();
  });
});

describe("mcp-server/self update", () => {
  it("updates a stale package on server start", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const messages: string[] = [];
    const result = await ensureUnityPackageCurrent(project, { log: (m) => messages.push(m) });
    expect(result?.updated).toBe(true);
    expect(messages.join(" ")).toContain(PRODUCT_VERSION);
    expect((await readEditorPackageStatus(project)).version).toBe(PRODUCT_VERSION);
  });

  it("respects autoUpdateUnityPackage:false in the project config", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    await writeConfig(project, { ...DEFAULT_CONFIG, autoUpdateUnityPackage: false });
    const result = await ensureUnityPackageCurrent(project, {});
    expect(result?.updated).toBe(false);
    expect((await readEditorPackageStatus(project)).version).toBe(STALE);
  });

  it("never rewrites package files under a running Editor — it reports instead", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const warning = await syncEditorPackage(project, { unityRunning: true });
    expect(warning).toContain(PRODUCT_VERSION);
    // The point: an import + domain reload mid-task would restart the bridge under the caller.
    expect((await readEditorPackageStatus(project)).version).toBe(STALE);
  });

  it("fixes it silently when the Editor is closed", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const warning = await syncEditorPackage(project, { unityRunning: false });
    expect(warning).toContain("Updated");
    expect((await readEditorPackageStatus(project)).version).toBe(PRODUCT_VERSION);
  });

  it("says nothing when there is nothing to do", async () => {
    await installUnityPackage(project, { mode: "copy" });
    expect(await syncEditorPackage(project, { unityRunning: true })).toBeNull();
  });
});

describe("cli/update", () => {
  it("reports a stale project without touching it in --dry-run", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const result = await runUpdate(
      { project, mock: true, json: true },
      { command: "update", positional: [], flags: { "dry-run": true } }
    );
    const payload = JSON.parse(result.stdout!);
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0].package.action).toBe("updated");
    expect(payload.projects[0].package.from).toBe(STALE);
    expect((await readEditorPackageStatus(project)).version).toBe(STALE);
  });

  it("applies the update when run for real", async () => {
    await writePackage(path.join(project, "Packages", "com.uvibe.os"), STALE);
    const result = await runUpdate(
      { project, mock: true, json: true },
      { command: "update", positional: [], flags: {} }
    );
    const payload = JSON.parse(result.stdout!);
    expect(payload.projects[0].package.action).toBe("updated");
    expect((await readEditorPackageStatus(project)).version).toBe(PRODUCT_VERSION);
  });
});

describe("cli/mcp config staleness", () => {
  it("spots an entry whose server script no longer exists", () => {
    const stale = JSON.stringify({
      mcpServers: {
        "unity-vibe-os": {
          command: process.execPath,
          args: ["/nonexistent/checkout/apps/cli/bin/uvibe", "serve"],
          env: {},
        },
      },
    });
    expect(mcpEntryIsStale(stale)).toContain("server script not found");
  });

  it("accepts an entry that still resolves, and ignores foreign files", () => {
    const good = JSON.stringify({
      mcpServers: {
        "unity-vibe-os": {
          command: process.execPath,
          args: [path.resolve("apps/cli/bin/uvibe"), "serve"],
          env: {},
        },
      },
    });
    expect(mcpEntryIsStale(good)).toBeNull();
    expect(mcpEntryIsStale('{"mcpServers":{"other":{"command":"x"}}}')).toBeNull();
    expect(mcpEntryIsStale("not json")).toBeNull();
  });
});

describe("agent instructions", () => {
  /** What a project set up before the Editor could be launched automatically still carries. */
  const OLD_BLOCK = [
    "# CLAUDE.md — cosyrange",
    "",
    "My own notes about this game. Do not delete.",
    "",
    "<!-- BEGIN unity-vibe-os -->",
    "## Unity Vibe OS",
    "",
    "### Bridge",
    "",
    "If a `unity_*` tool returns `UNITY_NOT_CONNECTED`, ask the user to open Unity.",
    "<!-- END unity-vibe-os -->",
    "",
    "More of my notes.",
    "",
  ].join("\n");

  it("replaces a stale block and keeps everything outside the markers", async () => {
    await fs.writeFile(path.join(project, "CLAUDE.md"), OLD_BLOCK, "utf8");
    const outcome = await refreshAgentInstructions(project);
    expect(outcome.claudeMd).toBe("updated");
    const updated = await fs.readFile(path.join(project, "CLAUDE.md"), "utf8");
    expect(updated).toContain("My own notes about this game. Do not delete.");
    expect(updated).toContain("More of my notes.");
    expect(updated).toContain("unity_launch_editor");
    expect(updated).not.toContain("ask the user to open Unity");
  });

  it("is idempotent — a second pass reports nothing to do", async () => {
    await fs.writeFile(path.join(project, "CLAUDE.md"), OLD_BLOCK, "utf8");
    await refreshAgentInstructions(project);
    const second = await refreshAgentInstructions(project);
    expect(second.claudeMd).toBe("current");
    expect(second.agentsMd).toBe("current");
  });

  it("creates the files when a project has none", async () => {
    const outcome = await refreshAgentInstructions(project);
    expect(outcome.claudeMd).toBe("created");
    expect(outcome.agentsMd).toBe("created");
    expect(await fs.readFile(path.join(project, "AGENTS.md"), "utf8")).toContain("unity_orient");
  });

  it("is refreshed by the server's start-up self-update", async () => {
    await fs.writeFile(path.join(project, "CLAUDE.md"), OLD_BLOCK, "utf8");
    const messages: string[] = [];
    await ensureUnityPackageCurrent(project, { log: (m) => messages.push(m) });
    expect(messages.join(" ")).toContain("agent instructions");
    expect(await fs.readFile(path.join(project, "CLAUDE.md"), "utf8")).toContain("unity_launch_editor");
  });

  it("honours autoUpdateAgentInstructions:false", async () => {
    await fs.writeFile(path.join(project, "CLAUDE.md"), OLD_BLOCK, "utf8");
    await writeConfig(project, { ...DEFAULT_CONFIG, autoUpdateAgentInstructions: false });
    await ensureUnityPackageCurrent(project, {});
    expect(await fs.readFile(path.join(project, "CLAUDE.md"), "utf8")).toContain("ask the user to open Unity");
  });

  it("is part of the `uvibe update` sweep", async () => {
    await fs.writeFile(path.join(project, "CLAUDE.md"), OLD_BLOCK, "utf8");
    const result = await runUpdate(
      { project, mock: true, json: true },
      { command: "update", positional: [], flags: {} }
    );
    const payload = JSON.parse(result.stdout!);
    expect(payload.projects[0].instructions.action).toBe("updated");
    expect(await fs.readFile(path.join(project, "CLAUDE.md"), "utf8")).toContain("unity_launch_editor");
  });
});
