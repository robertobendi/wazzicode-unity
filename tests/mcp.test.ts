import { describe, it, expect } from "vitest";
import { allTools, buildContext, createMockBridgeClient, createHttpBridgeClient } from "@uvibe/mcp-server";
import type { BridgeMethod, BridgeResponse } from "@uvibe/core";
import type { BridgeClient } from "@uvibe/mcp-server";

describe("mcp-server/registry", () => {
  it("registers all tools with unique names and real descriptions", () => {
    const names = allTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "unity_add_component",
      "unity_animator_edit_transition",
      "unity_apply_prefab_instance",
      "unity_assign_reference",
      "unity_batch",
      "unity_capture_game_view",
      "unity_capture_scene_view",
      "unity_capture_selected",
      "unity_check_git_status",
      "unity_clear_console",
      "unity_create_gameobject",
      "unity_create_material",
      "unity_create_prefab_variant",
      "unity_create_scriptable_object",
      "unity_enter_play_mode",
      "unity_execute_menu_item",
      "unity_exit_play_mode",
      "unity_find_dependencies",
      "unity_find_missing_references",
      "unity_find_missing_scripts",
      "unity_find_references",
      "unity_find_runtime_objects",
      "unity_generate_project_brain",
      "unity_get_animator_state",
      "unity_get_console_logs",
      "unity_get_open_scenes",
      "unity_get_performance_stats",
      "unity_get_play_mode_status",
      "unity_get_scene_hierarchy",
      "unity_import_asset",
      "unity_inspect_runtime_object",
      "unity_inspect_selected",
      "unity_instantiate_prefab",
      "unity_load_scene_additive",
      "unity_open_prefab",
      "unity_open_scene",
      "unity_orient",
      "unity_paint_tilemap",
      "unity_project_summary",
      "unity_reparent",
      "unity_run_tests",
      "unity_save_prefab",
      "unity_save_scene",
      "unity_set_animator_parameter",
      "unity_set_serialized_field",
      "unity_set_transform",
      "unity_simulate_input",
      "unity_slice_sprite",
      "unity_step_frame",
      "unity_verify",
      "unity_wait_for_compile",
      "unity_wire_ui_button",
    ]);
    for (const t of allTools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks exactly the mutating tools as write tools with a target", () => {
    const writes = allTools.filter((t) => t.write).map((t) => t.name).sort();
    expect(writes).toEqual([
      "unity_add_component",
      "unity_animator_edit_transition",
      "unity_apply_prefab_instance",
      "unity_assign_reference",
      "unity_clear_console",
      "unity_create_gameobject",
      "unity_create_material",
      "unity_create_prefab_variant",
      "unity_create_scriptable_object",
      "unity_execute_menu_item",
      "unity_import_asset",
      "unity_instantiate_prefab",
      "unity_paint_tilemap",
      "unity_reparent",
      "unity_save_prefab",
      "unity_save_scene",
      "unity_set_serialized_field",
      "unity_set_transform",
      "unity_slice_sprite",
      "unity_wire_ui_button",
    ]);
    for (const t of allTools) {
      if (t.write) expect(t.writeTarget).toBeDefined();
    }
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
      "perf.sample",
      "test.run",
      "test.status",
      "test.cancel",
      "playmode.enter",
      "playmode.exit",
      "playmode.step",
      "playmode.status",
      "runtime.findObjects",
      "runtime.inspect",
      "asset.findMissingScripts",
      "asset.findMissingReferences",
      "asset.findReferences",
      "asset.findDependencies",
      "edit.setSerializedField",
      "edit.addComponent",
      "edit.createGameObject",
      "edit.saveScene",
      "edit.assignReference",
      "edit.wireUiButton",
      "edit.instantiatePrefab",
      "edit.createScriptableObject",
      "edit.createMaterial",
      "edit.createPrefabVariant",
      "console.clear",
      "scene.open",
      "scene.loadAdditive",
      "prefab.open",
      "prefab.save",
      "prefab.applyInstance",
      "input.simulate",
      "animator.getState",
      "animator.setParameter",
      "animator.editTransition",
      "editor.executeMenuItem",
      "asset.import",
      "asset.sliceSprite",
      "edit.setTransform",
      "edit.reparent",
      "edit.paintTilemap",
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

describe("mcp-server/composition tools", () => {
  it("unity_orient aggregates summary/scenes/selection/compile/git in one call", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const tool = allTools.find((t) => t.name === "unity_orient")!;
    const env = await tool.run({}, ctx);
    expect(env.ok).toBe(true);
    if (env.ok) {
      const d = env.data as Record<string, any>;
      expect(d.bridgeReachable).toBe(true);
      expect(d.summary?.unityVersion).toBeDefined();
      expect(Array.isArray(d.openScenes?.scenes)).toBe(true);
      expect("compile" in d).toBe(true);
      expect("git" in d).toBe(true);
    }
  });

  it("unity_verify returns a single pass/compiled verdict", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const tool = allTools.find((t) => t.name === "unity_verify")!;
    const env = await tool.run({}, ctx);
    expect(env.ok).toBe(true);
    if (env.ok) {
      const d = env.data as Record<string, any>;
      expect(typeof d.compiled).toBe("boolean");
      expect("pass" in d).toBe(true);
      expect(Array.isArray(d.problems)).toBe(true);
    }
  });

  it("unity_batch runs ordered ops, reports per-op results, and refuses nesting", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const tool = allTools.find((t) => t.name === "unity_batch")!;
    const env = await tool.run(
      {
        operations: [
          { tool: "unity_get_open_scenes", args: {} },
          { tool: "unity_set_transform", args: { path: "/Gameplay/Player", position: { x: 1, y: 2, z: 3 } } },
          { tool: "unity_batch", args: {} }, // nesting → rejected, but stopOnError=false to see it
        ],
        stopOnError: false,
      },
      ctx
    );
    expect(env.ok).toBe(true);
    if (env.ok) {
      const d = env.data as { allOk: boolean; results: Array<{ ok: boolean; tool: string; error?: { code: string } }> };
      expect(d.results).toHaveLength(3);
      expect(d.results[0].ok).toBe(true);
      expect(d.results[1].ok).toBe(true);
      expect(d.results[2].ok).toBe(false);
      expect(d.results[2].error?.code).toBe("INVALID_ARGUMENT");
      expect(d.allOk).toBe(false);
    }
  });

  it("unity_batch tolerates being called with no operations (well-formed envelope)", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const tool = allTools.find((t) => t.name === "unity_batch")!;
    const env = await tool.run({}, ctx);
    expect(env.ok).toBe(true);
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
