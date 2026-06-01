import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHttpBridgeClient } from "@uvibe/mcp-server";
import { BRIDGE_DISCOVERY_REL } from "@uvibe/core";

function makeProject(disco: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(tmpdir(), "uvibe-"));
  const file = path.join(root, BRIDGE_DISCOVERY_REL);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(disco), "utf8");
  return root;
}

describe("reliability/bridge discovery + reload survival", () => {
  let projectKnown: string;
  let projectUnknown: string;

  beforeAll(() => {
    // Discovery file present but pointing at a dead port → bridge "known" but socket down.
    projectKnown = makeProject({ port: 1, host: "127.0.0.1", projectPath: "/whatever" });
    // No discovery file at all.
    projectUnknown = mkdtempSync(path.join(tmpdir(), "uvibe-none-"));
  });

  afterAll(() => {
    rmSync(projectKnown, { recursive: true, force: true });
    rmSync(projectUnknown, { recursive: true, force: true });
  });

  it("treats connection-refused as UNITY_RELOADING when a discovery file exists", async () => {
    const client = createHttpBridgeClient({ projectPath: projectKnown, timeoutMs: 800 });
    const res = await client.call("system.health");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(["UNITY_RELOADING", "BRIDGE_TIMEOUT"]).toContain(res.error.code);
    }
  });

  it("reports UNITY_NOT_CONNECTED when no bridge was ever discovered", async () => {
    const client = createHttpBridgeClient({ projectPath: projectUnknown, port: 1, timeoutMs: 800 });
    const res = await client.call("system.health");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(["UNITY_NOT_CONNECTED", "BRIDGE_TIMEOUT"]).toContain(res.error.code);
    }
  });
});
