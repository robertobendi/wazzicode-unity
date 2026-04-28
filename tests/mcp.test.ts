import { describe, it, expect } from "vitest";
import { allTools, buildContext, createMockBridgeClient, createHttpBridgeClient } from "@uvibe/mcp-server";
import type { BridgeMethod, BridgeResponse } from "@uvibe/core";
import type { BridgeClient } from "@uvibe/mcp-server";

describe("mcp-server/registry", () => {
  it("registers all 11 MVP tools with unique names", () => {
    const names = allTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "unity_capture_game_view",
      "unity_capture_scene_view",
      "unity_capture_selected",
      "unity_check_git_status",
      "unity_generate_project_brain",
      "unity_get_console_logs",
      "unity_get_open_scenes",
      "unity_get_scene_hierarchy",
      "unity_inspect_selected",
      "unity_project_summary",
      "unity_wait_for_compile",
    ]);
    for (const t of allTools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("mcp-server/mockBridge", () => {
  it("returns ok for every MVP method", async () => {
    const bridge = createMockBridgeClient();
    const methods: BridgeMethod[] = [
      "system.health",
      "system.summary",
      "scene.getOpenScenes",
      "scene.getHierarchy",
      "selection.inspect",
      "console.getLogs",
      "compile.status",
      "screenshot.gameView",
      "screenshot.sceneView",
      "screenshot.selected",
    ];
    for (const m of methods) {
      const r = await bridge.call(m);
      expect(r.ok, `mock missing responder for ${m}`).toBe(true);
    }
  });

  it("mock screenshots return a parseable PNG", async () => {
    const bridge = createMockBridgeClient();
    const r = await bridge.call<{ pngBase64: string; width: number; height: number }>("screenshot.gameView");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Base64 of valid PNG starts with iVBORw0KGgo
      expect(r.result.pngBase64.startsWith("iVBORw0KGgo")).toBe(true);
      expect(r.result.width).toBeGreaterThan(0);
      expect(r.result.height).toBeGreaterThan(0);
    }
  });
});

describe("mcp-server/tools (mock context)", () => {
  it("each tool returns a well-formed envelope against the mock bridge", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    for (const tool of allTools) {
      // wait_for_compile loops; mock returns isCompiling=false on first call so this is fast.
      const env = await tool.run({} as never, ctx);
      // Envelope shape
      expect(typeof env.ok).toBe("boolean");
      expect(env.meta).toBeDefined();
      if (env.ok) {
        expect(env.warnings).toBeInstanceOf(Array);
        expect(env.meta.source === "mock" || env.meta.source === "git" || env.meta.source === "project_brain").toBe(true);
      }
    }
  });
});

describe("mcp-server/bridgeClient (real HTTP, against unbound port)", () => {
  it("returns UNITY_NOT_CONNECTED when nothing is listening", async () => {
    // Use a port unlikely to be bound.
    const client: BridgeClient = createHttpBridgeClient({ port: 1, timeoutMs: 500 });
    const res: BridgeResponse = await client.call("system.health");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(["UNITY_NOT_CONNECTED", "BRIDGE_TIMEOUT"]).toContain(res.error.code);
    }
  });
});
