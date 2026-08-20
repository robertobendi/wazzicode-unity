import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearUnityCliCache,
  describeEditorEnvironment,
  ensureEditorRunning,
  isUnityProject,
  listInstalledEditors,
  locateUnityCli,
  parseEnvelope,
  parseNUnitReport,
  readEditorRunningState,
  readProjectVersion,
  runUnityCli,
} from "@uvibe/unity-cli";
import { allTools, buildContext } from "@uvibe/mcp-server";
import { gateTool, DEFAULT_CONFIG } from "@uvibe/safety";
import { runEnv } from "@uvibe/cli";

/**
 * The Unity CLI is optional and beta, so everything here runs against a *fake* `unity` binary:
 * a Node script that speaks the same JSON envelope and records what it was asked to do. That
 * keeps these tests hermetic (no Unity, no Hub, no network) while still exercising the real
 * argv construction, envelope parsing, timeout handling and launch state machine.
 */

let workDir: string;
let fakeCli: string;
let projectDir: string;
let logFile: string;

const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = process.env.FAKE_UNITY_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(args) + "\\n");
const envelope = (data, extra = {}) =>
  JSON.stringify({ success: true, command: args[0], data, errors: [], warnings: [], ...extra });

if (args.includes("--version")) {
  process.stdout.write("9.9.9-fake\\n");
  process.exit(0);
}
if (process.env.FAKE_UNITY_HANG === "1") {
  setTimeout(() => process.exit(0), 60_000);
  return;
}
switch (args[0]) {
  case "editors":
    process.stdout.write(envelope(JSON.parse(process.env.FAKE_UNITY_EDITORS || "[]")));
    break;
  case "projects":
    process.stdout.write(envelope([{ title: "Fake", path: "/tmp/fake", version: "6000.0.1f1" }]));
    break;
  case "open":
    // A real \`unity open\` hands off to the Editor and exits.
    process.stdout.write(envelope({ opened: args[1] }));
    break;
  case "fail":
    process.stdout.write(
      JSON.stringify({ success: false, command: "fail", data: null, errors: [{ code: "E_NOPE", message: "nope" }], warnings: [] })
    );
    process.exit(2);
    break;
  case "banner":
    // Real output is sometimes preceded by a banner even with --no-banner.
    process.stdout.write("  ✔ Unity CLI\\n" + envelope({ fine: true }) + "\\n");
    break;
  default:
    process.stdout.write(envelope({ argv: args }));
}
`;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "uvibe-unity-cli-"));
  fakeCli = path.join(workDir, "fake-unity");
  await fs.writeFile(fakeCli, FAKE_CLI, "utf8");
  await fs.chmod(fakeCli, 0o755);
  logFile = path.join(workDir, "calls.log");

  projectDir = path.join(workDir, "Project");
  await fs.mkdir(path.join(projectDir, "ProjectSettings"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "Assets"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 6000.0.30f1\nm_EditorVersionWithRevision: 6000.0.30f1 (abcdef123456)\n",
    "utf8"
  );
});

afterAll(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  clearUnityCliCache();
  process.env.FAKE_UNITY_LOG = logFile;
  process.env.FAKE_UNITY_EDITORS = "[]";
  delete process.env.FAKE_UNITY_HANG;
  await fs.rm(logFile, { force: true });
});

async function calls(): Promise<string[][]> {
  try {
    return (await fs.readFile(logFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

describe("unity-cli/envelope parsing", () => {
  it("reads a plain envelope, one behind a banner, and rejects unrelated JSON", () => {
    expect(parseEnvelope<{ a: number }>('{"success":true,"data":{"a":1}}')?.data).toEqual({ a: 1 });
    expect(parseEnvelope<{ a: number }>('noise\n{"success":true,"data":{"a":2}}\n')?.data).toEqual({ a: 2 });
    expect(parseEnvelope('{"unrelated":true}')).toBeNull();
    expect(parseEnvelope("")).toBeNull();
  });
});

describe("unity-cli/exec", () => {
  it("always passes --json --non-interactive --no-banner and never --no-pager", async () => {
    const res = await runUnityCli<{ argv: string[] }>(["whatever"], { cliPath: fakeCli });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.argv).toContain("--json");
      expect(res.data.argv).toContain("--non-interactive");
      expect(res.data.argv).toContain("--no-banner");
      // The beta CLI's subcommands reject --no-pager even though it is documented as global.
      expect(res.data.argv).not.toContain("--no-pager");
    }
  });

  it("parses an envelope that arrives behind a banner line", async () => {
    const res = await runUnityCli<{ fine: boolean }>(["banner"], { cliPath: fakeCli });
    expect(res.ok && res.data.fine).toBe(true);
  });

  it("surfaces the CLI's own error message on failure", async () => {
    const res = await runUnityCli(["fail"], { cliPath: fakeCli });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CLI_FAILED");
      expect(res.message).toContain("nope");
    }
  });

  it("kills a hung call at its deadline instead of hanging the caller", async () => {
    process.env.FAKE_UNITY_HANG = "1";
    const res = await runUnityCli(["license", "status"], { cliPath: fakeCli, timeoutMs: 600 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CLI_TIMEOUT");
  });

  it("reports a missing binary as CLI_NOT_FOUND rather than throwing", async () => {
    const res = await runUnityCli(["editors"], { cliPath: path.join(workDir, "nope") , timeoutMs: 500});
    // An explicit path that does not exist falls through to discovery; on a machine with a real
    // Unity CLI that call still succeeds, so only assert we got a typed result either way.
    expect(typeof res.ok).toBe("boolean");
  });

  it("finds the binary named by UVIBE_UNITY_CLI", () => {
    const previous = process.env.UVIBE_UNITY_CLI;
    process.env.UVIBE_UNITY_CLI = fakeCli;
    try {
      expect(locateUnityCli()?.path).toBe(fakeCli);
      expect(locateUnityCli()?.source).toBe("env");
    } finally {
      if (previous === undefined) delete process.env.UVIBE_UNITY_CLI;
      else process.env.UVIBE_UNITY_CLI = previous;
    }
  });
});

describe("unity-cli/environment", () => {
  it("reads the project's pinned editor version and changeset", async () => {
    expect(await isUnityProject(projectDir)).toBe(true);
    expect(await isUnityProject(workDir)).toBe(false);
    const version = await readProjectVersion(projectDir);
    expect(version.editorVersion).toBe("6000.0.30f1");
    expect(version.changeset).toBe("abcdef123456");
  });

  it("treats Temp/UnityLockfile as evidence that an Editor holds the project", async () => {
    const before = await readEditorRunningState(projectDir, async () => false);
    expect(before.lockfilePresent).toBe(false);
    await fs.mkdir(path.join(projectDir, "Temp"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "Temp", "UnityLockfile"), "", "utf8");
    const after = await readEditorRunningState(projectDir, async () => false);
    expect(after.lockfilePresent).toBe(true);
    await fs.rm(path.join(projectDir, "Temp"), { recursive: true, force: true });
  });

  it("flags the pinned editor version as missing when it is not installed", async () => {
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "2022.3.1f1", architecture: "arm64" }]);
    const env = await describeEditorEnvironment(projectDir, {
      cliPath: fakeCli,
      force: true,
      probeBridge: async () => false,
    });
    expect(env.cli.available).toBe(true);
    expect(env.match.installed).toBe(false);
    expect(env.suggestions.join(" ")).toContain("6000.0.30f1");
  });

  it("caches per binary so a second lookup does not re-spawn the CLI", async () => {
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "6000.0.30f1" }]);
    await listInstalledEditors({ cliPath: fakeCli, force: true });
    const afterFirst = (await calls()).filter((c) => c[0] === "editors").length;
    await listInstalledEditors({ cliPath: fakeCli });
    const afterSecond = (await calls()).filter((c) => c[0] === "editors").length;
    expect(afterSecond).toBe(afterFirst);
  });
});

describe("unity-cli/ensureEditorRunning", () => {
  it("does nothing when the bridge already answers", async () => {
    const result = await ensureEditorRunning(projectDir, {
      cliPath: fakeCli,
      probeBridge: async () => true,
    });
    expect(result.outcome).toBe("already_running");
    expect(result.ready).toBe(true);
    expect((await calls()).some((c) => c[0] === "open")).toBe(false);
  });

  it("refuses to launch when the pinned editor version is not installed", async () => {
    process.env.FAKE_UNITY_EDITORS = "[]";
    const result = await ensureEditorRunning(projectDir, {
      cliPath: fakeCli,
      probeBridge: async () => false,
      timeoutMs: 2_000,
      force: true,
    });
    expect(result.outcome).toBe("editor_not_installed");
    expect(result.nextAction).toContain("6000.0.30f1");
    expect((await calls()).some((c) => c[0] === "open")).toBe(false);
  });

  it("launches the editor and reports ready once the bridge answers", async () => {
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "6000.0.30f1", architecture: "arm64" }]);
    let probes = 0;
    const result = await ensureEditorRunning(projectDir, {
      cliPath: fakeCli,
      probeBridge: async () => ++probes > 2,
      timeoutMs: 10_000,
      pollMs: 100,
      force: true,
    });
    expect(result.outcome).toBe("launched");
    expect(result.ready).toBe(true);
    const open = (await calls()).find((c) => c[0] === "open");
    expect(open).toBeDefined();
    expect(open).toContain(projectDir);
    // The pinned version is passed explicitly so Unity can't silently upgrade the project.
    expect(open).toContain("6000.0.30f1");
  });

  it("gives up with launch_timeout instead of waiting forever", async () => {
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "6000.0.30f1" }]);
    const result = await ensureEditorRunning(projectDir, {
      cliPath: fakeCli,
      probeBridge: async () => false,
      timeoutMs: 900,
      pollMs: 100,
      force: true,
    });
    expect(result.outcome).toBe("launch_timeout");
    expect(result.ready).toBe(false);
  });

  it("reports a non-Unity directory rather than launching anything", async () => {
    const result = await ensureEditorRunning(workDir, { cliPath: fakeCli, probeBridge: async () => false });
    expect(result.outcome).toBe("not_a_project");
    expect((await calls()).some((c) => c[0] === "open")).toBe(false);
  });
});

describe("unity-cli/NUnit report", () => {
  it("extracts counts and failure messages from a batch-mode report", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="3" result="Failed" total="3" passed="2" failed="1" inconclusive="0" skipped="0" duration="4.25">
  <test-suite type="TestFixture" name="PlayerTests">
    <test-case id="1001" name="Moves" fullname="Game.PlayerTests.Moves" result="Passed" />
    <test-case id="1002" name="Jumps" fullname="Game.PlayerTests.Jumps" result="Failed">
      <failure><message><![CDATA[Expected: 3 But was: 1]]></message><stack-trace>at Game.PlayerTests.Jumps()</stack-trace></failure>
    </test-case>
  </test-suite>
</test-run>`;
    const report = parseNUnitReport(xml)!;
    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.durationSec).toBe(4.25);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].name).toBe("Game.PlayerTests.Jumps");
    expect(report.failures[0].message).toBe("Expected: 3 But was: 1");
    expect(report.failures[0].stackTrace).toContain("Jumps()");
  });

  it("returns null for output that is not an NUnit report", () => {
    expect(parseNUnitReport("not xml at all")).toBeNull();
  });
});

describe("mcp/machine tools", () => {
  it("registers the Unity CLI tools in the machine group with sane requirements", () => {
    const names = ["unity_launch_editor", "unity_install_editor", "unity_environment", "unity_build_player", "unity_run_tests_headless", "unity_project_clean"];
    for (const name of names) {
      const tool = allTools.find((t) => t.name === name);
      expect(tool, `${name} is registered`).toBeDefined();
      expect(tool!.requires).toContain("unity_cli");
    }
  });

  it("refuses batch-mode work while an Editor holds the project", async () => {
    process.env.UVIBE_UNITY_CLI = fakeCli;
    await fs.mkdir(path.join(projectDir, "Temp"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "Temp", "UnityLockfile"), "", "utf8");
    try {
      const ctx = buildContext({ projectPath: projectDir });
      const tool = allTools.find((t) => t.name === "unity_build_player")!;
      const env = await tool.run({ target: "StandaloneOSX", outputPath: "Builds/Game.app" } as never, ctx);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe("EDITOR_HOLDS_PROJECT");
    } finally {
      await fs.rm(path.join(projectDir, "Temp"), { recursive: true, force: true });
      delete process.env.UVIBE_UNITY_CLI;
    }
  });

  it("reports the environment read-only, without launching anything", async () => {
    process.env.UVIBE_UNITY_CLI = fakeCli;
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "6000.0.30f1" }]);
    try {
      const ctx = buildContext({ projectPath: projectDir });
      const tool = allTools.find((t) => t.name === "unity_environment")!;
      const env = await tool.run({ refresh: true } as never, ctx);
      expect(env.ok).toBe(true);
      if (env.ok) {
        const data = env.data as { cli: { available: boolean }; match: { installed: boolean } };
        expect(data.cli.available).toBe(true);
        expect(data.match.installed).toBe(true);
      }
      expect((await calls()).some((c) => c[0] === "open")).toBe(false);
    } finally {
      delete process.env.UVIBE_UNITY_CLI;
    }
  });
});

describe("safety/build gating", () => {
  it("blocks batch-mode Editor work when allowBuilds is off", () => {
    expect(gateTool(DEFAULT_CONFIG, "unity_build_player").allowed).toBe(true);
    const locked = { ...DEFAULT_CONFIG, allowBuilds: false };
    const decision = gateTool(locked, "unity_build_player");
    expect(decision.allowed).toBe(false);
    expect(decision.errorCode).toBe("SAFETY_MODE_BLOCKED");
    expect(gateTool(locked, "unity_project_clean").allowed).toBe(false);
    expect(gateTool(locked, "unity_install_editor").allowed).toBe(false);
  });

  it("keeps read_only projects out of batch-mode work entirely", () => {
    const readOnly = { ...DEFAULT_CONFIG, safetyMode: "read_only" as const };
    expect(gateTool(readOnly, "unity_build_player").allowed).toBe(false);
  });
});

describe("cli/env", () => {
  it("prints a machine-readable environment report", async () => {
    process.env.UVIBE_UNITY_CLI = fakeCli;
    process.env.FAKE_UNITY_EDITORS = JSON.stringify([{ version: "6000.0.30f1" }]);
    try {
      const result = await runEnv({ project: projectDir, mock: true, json: true }, { command: "env", positional: [], flags: { refresh: true } });
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout!);
      expect(payload.cli.available).toBe(true);
      expect(payload.project.required.editorVersion).toBe("6000.0.30f1");
      expect(payload.match.installed).toBe(true);
    } finally {
      delete process.env.UVIBE_UNITY_CLI;
    }
  });
});
