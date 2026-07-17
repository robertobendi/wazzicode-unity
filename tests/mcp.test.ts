import { describe, it, expect, vi } from "vitest";
import { allTools, buildContext, createMockBridgeClient, createHttpBridgeClient, ToolGroupController, defaultActiveGroups, groupOf, toolAnnotations, UNITY_PROMPTS, createServer, readSceneHierarchyResource, readConsoleResource, readActionLogResource, SERVER_INSTRUCTIONS } from "@uvibe/mcp-server";
import type { BridgeMethod, BridgeResponse } from "@uvibe/core";
import type { BridgeClient } from "@uvibe/mcp-server";
import { isEditorWindowCaptureSupported, unityCaptureEditorWindow } from "../packages/mcp-server/src/tools/unityCaptureEditorWindow.js";

describe("mcp-server/registry", () => {
  it("registers all tools with unique names and real descriptions", () => {
    const names = allTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "unity_add_component",
      "unity_animator_edit_transition",
      "unity_apply_prefab_instance",
      "unity_apply_text_edits",
      "unity_assign_reference",
      "unity_batch",
      "unity_capture_editor_window",
      "unity_capture_game_view",
      "unity_capture_scene_view",
      "unity_capture_selected",
      "unity_check_git_status",
      "unity_clear_console",
      "unity_create_gameobject",
      "unity_create_material",
      "unity_create_prefab_variant",
      "unity_create_script",
      "unity_create_scriptable_object",
      "unity_delete_asset",
      "unity_delete_gameobject",
      "unity_docs",
      "unity_enter_play_mode",
      "unity_execute_code",
      "unity_execute_menu_item",
      "unity_exit_play_mode",
      "unity_find_dependencies",
      "unity_find_in_file",
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
      "unity_get_script_sha",
      "unity_import_asset",
      "unity_inspect_runtime_object",
      "unity_inspect_selected",
      "unity_instantiate_prefab",
      "unity_load_scene_additive",
      "unity_manage_tools",
      "unity_open_prefab",
      "unity_open_scene",
      "unity_orient",
      "unity_paint_tilemap",
      "unity_project_summary",
      "unity_read_script",
      "unity_reflect",
      "unity_remove_component",
      "unity_reparent",
      "unity_run_tests",
      "unity_save_prefab",
      "unity_save_scene",
      "unity_script_edit",
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
      "unity_apply_text_edits",
      "unity_assign_reference",
      "unity_clear_console",
      "unity_create_gameobject",
      "unity_create_material",
      "unity_create_prefab_variant",
      "unity_create_script",
      "unity_create_scriptable_object",
      "unity_delete_asset",
      "unity_delete_gameobject",
      "unity_execute_code",
      "unity_execute_menu_item",
      "unity_import_asset",
      "unity_instantiate_prefab",
      "unity_paint_tilemap",
      "unity_remove_component",
      "unity_reparent",
      "unity_save_prefab",
      "unity_save_scene",
      "unity_script_edit",
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

describe("mcp-server/tool annotations", () => {
  it("marks every non-write tool readOnly and every write tool not-readOnly", () => {
    for (const tool of allTools) {
      const a = toolAnnotations(tool);
      if (tool.write) {
        expect(a.readOnlyHint, tool.name).toBe(false);
      }
    }
    // A pure read tool is read-only; a Unity write is not.
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_get_scene_hierarchy")!).readOnlyHint).toBe(true);
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_set_serialized_field")!).readOnlyHint).toBe(false);
  });

  it("flags hard-to-undo writes destructive and additive scene edits non-destructive", () => {
    const destructive = toolAnnotations(allTools.find((t) => t.name === "unity_script_edit")!);
    expect(destructive.destructiveHint).toBe(true);
    const additive = toolAnnotations(allTools.find((t) => t.name === "unity_create_gameobject")!);
    expect(additive.destructiveHint).toBe(false);
    // execute_code is destructive; docs touches the network.
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_execute_code")!).destructiveHint).toBe(true);
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_docs")!).openWorldHint).toBe(true);
  });

  it("treats batch and play-mode tools as mutating (not read-only)", () => {
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_batch")!).readOnlyHint).toBe(false);
    expect(toolAnnotations(allTools.find((t) => t.name === "unity_enter_play_mode")!).readOnlyHint).toBe(false);
  });
});

describe("mcp-server/instructions", () => {
  it("ships a server-instructions primer that names the core workflow tools", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(400);
    for (const t of ["unity_orient", "unity_reflect", "unity_verify", "unity_manage_tools"]) {
      expect(SERVER_INSTRUCTIONS, t).toContain(t);
    }
  });

  it("every tool named in the instructions actually exists", () => {
    const names = new Set(allTools.map((t) => t.name));
    const referenced = SERVER_INSTRUCTIONS.match(/unity_[a-z_]+/g) ?? [];
    for (const name of referenced) {
      // Strip trailing underscores from prose, then check membership.
      const clean = name.replace(/_+$/, "");
      expect(names.has(clean), `instructions reference unknown tool ${clean}`).toBe(true);
    }
  });

  it("blocks unsafe whole-editor capture on macOS without calling Unity", async () => {
    expect(isEditorWindowCaptureSupported("darwin")).toBe(false);
    expect(isEditorWindowCaptureSupported("linux")).toBe(true);
    expect(isEditorWindowCaptureSupported("win32")).toBe(true);
    expect(SERVER_INSTRUCTIONS).toContain("never call unity_capture_editor_window");

    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const bridge = createMockBridgeClient();
    const call = vi.spyOn(bridge, "call");
    try {
      const result = await unityCaptureEditorWindow.run(
        { save: false },
        { bridge, projectPath: process.cwd(), configMockMode: false }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FEATURE_UNAVAILABLE");
        expect(result.error.recoverable).toBe(false);
      }
      expect(call).not.toHaveBeenCalled();
    } finally {
      platform.mockRestore();
    }
  });
});

describe("mcp-server/prompts", () => {
  it("every prompt builds non-empty guidance text", () => {
    for (const p of UNITY_PROMPTS) {
      const text = p.build({});
      expect(typeof text, p.name).toBe("string");
      expect(text.length, p.name).toBeGreaterThan(40);
      expect(p.config.title.length).toBeGreaterThan(0);
    }
  });

  it("new_script interpolates its arguments", () => {
    const p = UNITY_PROMPTS.find((x) => x.name === "new_script")!;
    const text = p.build({ name: "EnemyAI", description: "chase the player" });
    expect(text).toContain("EnemyAI");
    expect(text).toContain("chase the player");
  });

  it("createServer registers prompts without throwing", () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    expect(() => createServer(ctx)).not.toThrow();
  });
});

describe("mcp-server/resources", () => {
  it("scene-hierarchy and console resources return live JSON via the bridge", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const hier = await readSceneHierarchyResource(ctx);
    expect(hier.contents[0].uri).toBe("unity://scene-hierarchy");
    expect(hier.contents[0].mimeType).toBe("application/json");
    expect(hier.contents[0].text).toContain("roots");

    const console = await readConsoleResource(ctx);
    expect(console.contents[0].text).toContain("logs");
  });

  it("action-log resource is safe when nothing has been logged", async () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    const log = await readActionLogResource(ctx);
    expect(log.contents[0].uri).toBe("unity://action-log");
    expect(typeof log.contents[0].text).toBe("string");
  });

  it("createServer registers resources without throwing", () => {
    const ctx = buildContext({ mock: true, projectPath: process.cwd() });
    expect(() => createServer(ctx)).not.toThrow();
  });
});

describe("mcp-server/tool groups", () => {
  function fakeHandle() {
    const state = { enabled: true };
    return { state, enable: () => (state.enabled = true), disable: () => (state.enabled = false) };
  }

  it("disables non-active groups (codegen) at registration and keeps core always on", () => {
    const controller = new ToolGroupController(defaultActiveGroups());
    const handles = new Map<string, ReturnType<typeof fakeHandle>>();
    for (const tool of allTools) {
      const h = fakeHandle();
      handles.set(tool.name, h);
      controller.register(tool.name, h);
    }
    // execute_code is in the codegen group, off by default → disabled.
    expect(groupOf("unity_execute_code")).toBe("codegen");
    expect(handles.get("unity_execute_code")!.state.enabled).toBe(false);
    // A core tool stays enabled.
    expect(handles.get("unity_orient")!.state.enabled).toBe(true);
    // A default-on group (scripting) stays enabled.
    expect(handles.get("unity_create_script")!.state.enabled).toBe(true);
  });

  it("activate/deactivate flips the group's tool handles and never touches core", () => {
    const controller = new ToolGroupController(defaultActiveGroups());
    const handles = new Map<string, ReturnType<typeof fakeHandle>>();
    for (const tool of allTools) {
      const h = fakeHandle();
      handles.set(tool.name, h);
      controller.register(tool.name, h);
    }
    const activated = controller.setActive("codegen", true);
    expect(activated.changed).toBe(true);
    expect(handles.get("unity_execute_code")!.state.enabled).toBe(true);

    const deactivated = controller.setActive("runtime", false);
    expect(deactivated.changed).toBe(true);
    expect(handles.get("unity_enter_play_mode")!.state.enabled).toBe(false);

    // core can't be toggled.
    expect(controller.setActive("core", false).changed).toBe(false);
    expect(handles.get("unity_orient")!.state.enabled).toBe(true);
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
      "screenshot.editorWindow",
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
      "edit.deleteGameObject",
      "edit.removeComponent",
      "edit.deleteAsset",
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
      "script.read",
      "script.getSha",
      "script.findInFile",
      "script.create",
      "script.applyEdits",
      "script.applyStructuredEdits",
      "code.execute",
      "reflect.query",
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

describe("mcp-server/long-poll awaits + legacy fallback", () => {
  /** Minimal scriptable bridge: records the methods called, answers from `handlers`,
   *  and reports "Unknown method" (like an older Unity package) for anything else. */
  function fakeBridge(
    handlers: Record<string, (params: Record<string, unknown>) => unknown>,
    calls: string[]
  ): BridgeClient {
    return {
      source: "unity_bridge",
      async call<T>(method: BridgeMethod, params: Record<string, unknown> = {}): Promise<BridgeResponse<T>> {
        calls.push(method);
        const h = handlers[method];
        if (!h) {
          return {
            id: "t",
            ok: false,
            result: null,
            error: { code: "INVALID_ARGUMENT", message: `Unknown method: ${method}` },
            meta: {},
          };
        }
        return {
          id: "t",
          ok: true,
          result: h(params) as T,
          error: null,
          meta: { unityVersion: "6000.0.0f1", projectPath: "/p", durationMs: 1 },
        };
      },
      async isConnected() {
        return true;
      },
    };
  }

  function ctxWith(bridge: BridgeClient) {
    return { bridge, projectPath: process.cwd(), configMockMode: false };
  }

  it("unity_wait_for_compile settles in ONE compile.await round trip on new bridges", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "compile.await": () => ({ isCompiling: false, hasErrors: false, errorCount: 0, warningCount: 0, errors: [], settled: true }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_wait_for_compile")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    expect(calls).toEqual(["compile.await"]);
  });

  it("unity_wait_for_compile falls back to compile.status polling against older packages", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "compile.status": () => ({ isCompiling: false, hasErrors: false, errorCount: 0, warningCount: 0, errors: [] }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_wait_for_compile")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    expect(calls).toEqual(["compile.await", "compile.status"]);
  });

  it("unity_wait_for_compile re-issues compile.await while unsettled (still compiling)", async () => {
    const calls: string[] = [];
    let round = 0;
    const bridge = fakeBridge(
      {
        "compile.await": () => {
          round++;
          return round < 2
            ? { isCompiling: true, hasErrors: false, errorCount: 0, warningCount: 0, errors: [], settled: false }
            : { isCompiling: false, hasErrors: false, errorCount: 0, warningCount: 0, errors: [], settled: true };
        },
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_wait_for_compile")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect((env.data as { isCompiling: boolean }).isCompiling).toBe(false);
    expect(calls).toEqual(["compile.await", "compile.await"]);
  });

  it("unity_wait_for_compile fails hard with UNITY_EDITOR_STALLED instead of soft-timing-out against a frozen editor", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        // Never settles: the editor loop is frozen so the compile makes no progress.
        "compile.await": () => ({ isCompiling: true, hasErrors: false, errorCount: 0, warningCount: 0, errors: [], settled: false }),
      },
      calls
    );
    bridge.health = async () => ({
      status: "ok",
      editorTickAgeMs: 30_000,
      keepAwakeEnabled: false,
      wasFocused: false,
    });
    const tool = allTools.find((t) => t.name === "unity_wait_for_compile")!;
    const env = await tool.run({ timeoutMs: 600 }, ctxWith(bridge));
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("UNITY_EDITOR_STALLED");
      expect(env.error.message).toContain("focus Unity");
    }
  });

  it("unity_wait_for_compile keeps the soft timeout warning when the editor is alive (genuinely slow compile)", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "compile.await": () => ({ isCompiling: true, hasErrors: false, errorCount: 0, warningCount: 0, errors: [], settled: false }),
      },
      calls
    );
    bridge.health = async () => ({
      status: "ok",
      editorTickAgeMs: 16,
      keepAwakeEnabled: true,
      wasFocused: true,
    });
    const tool = allTools.find((t) => t.name === "unity_wait_for_compile")!;
    const env = await tool.run({ timeoutMs: 600 }, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.warnings.some((w) => w.includes("Timed out"))).toBe(true);
  });

  it("unity_orient warns when 'Keep Unity awake' is off", async () => {
    const bridge = fakeBridge({}, []);
    bridge.health = async () => ({ status: "ok", editorTickAgeMs: 16, keepAwakeEnabled: false, wasFocused: true });
    const tool = allTools.find((t) => t.name === "unity_orient")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.warnings.some((w) => w.includes("Keep Unity awake"))).toBe(true);
  });

  it("unity_orient warns when the Unity package predates the keep-awake driver", async () => {
    const bridge = fakeBridge({}, []);
    bridge.health = async () => ({ status: "ok" });
    const tool = allTools.find((t) => t.name === "unity_orient")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.warnings.some((w) => w.includes("keep-awake"))).toBe(true);
  });

  it("unity_step_frame steps N frames in ONE call on new bridges", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "playmode.step": (p) => ({
          isPlaying: true,
          isPaused: true,
          frameCount: 100 + Number(p.frames ?? 1),
          framesStepped: Number(p.frames ?? 1),
          stepping: false,
          settled: true,
        }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_step_frame")!;
    const env = await tool.run({ frames: 10 }, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect((env.data as { framesStepped?: number }).framesStepped).toBe(10);
    expect(calls).toEqual(["playmode.step"]);
  });

  it("unity_step_frame falls back to one-call-per-frame against older packages", async () => {
    const calls: string[] = [];
    let frame = 0;
    const bridge = fakeBridge(
      {
        // Old bridge: no framesStepped key, steps exactly one frame per call.
        "playmode.step": () => ({ isPlaying: true, isPaused: true, frameCount: ++frame }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_step_frame")!;
    const env = await tool.run({ frames: 3 }, ctxWith(bridge));
    expect(env.ok).toBe(true);
    expect(calls).toEqual(["playmode.step", "playmode.step", "playmode.step"]);
  });

  it("unity_enter_play_mode waits via playmode.await on new bridges", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "playmode.enter": () => ({ isPlaying: false, isPaused: false, isTransitioning: true }),
        "playmode.await": (p) => {
          expect(p.until).toBe("playing");
          return { isPlaying: true, isPaused: false, isTransitioning: false, frameCount: 1, settled: true };
        },
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_enter_play_mode")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect((env.data as { isPlaying: boolean }).isPlaying).toBe(true);
    expect(calls).toEqual(["playmode.enter", "playmode.await"]);
  });

  it("unity_enter_play_mode falls back to status polling against older packages", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "playmode.enter": () => ({ isPlaying: false, isPaused: false, isTransitioning: true }),
        "playmode.status": () => ({ isPlaying: true, isPaused: false, isTransitioning: false, frameCount: 1 }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_enter_play_mode")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    expect(calls).toEqual(["playmode.enter", "playmode.await", "playmode.status"]);
  });

  it("unity_run_tests waits via test.await on new bridges (no test.status polling)", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "test.run": () => ({ runId: "r1", state: "running", mode: "EditMode" }),
        "test.await": () => ({ runId: "r1", state: "completed", total: 1, passed: 1, failed: 0, skipped: 0, results: [], settled: true }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_run_tests")!;
    const env = await tool.run({}, ctxWith(bridge));
    expect(env.ok).toBe(true);
    if (env.ok) expect((env.data as { state: string }).state).toBe("completed");
    expect(calls).toEqual(["test.run", "test.await"]);
  });

  it("unity_run_tests falls back to test.status polling against older packages", async () => {
    const calls: string[] = [];
    const bridge = fakeBridge(
      {
        "test.run": () => ({ runId: "r1", state: "running", mode: "EditMode" }),
        "test.status": () => ({ runId: "r1", state: "completed", total: 1, passed: 1, failed: 0, skipped: 0, results: [] }),
      },
      calls
    );
    const tool = allTools.find((t) => t.name === "unity_run_tests")!;
    const env = await tool.run({ pollMs: 200 }, ctxWith(bridge));
    expect(env.ok).toBe(true);
    expect(calls).toEqual(["test.run", "test.await", "test.status"]);
  });
});
