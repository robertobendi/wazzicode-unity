import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allTools, buildContext, createServer } from "@uvibe/mcp-server";
import type { BridgeClient } from "@uvibe/mcp-server";
import type { BridgeMethod, BridgeResponse } from "@uvibe/core";

/**
 * These exercise the MCP features Claude Code reads off the wire — tool `_meta`, tools/list
 * ordering, progress notifications, and elicitation — through a real client/server pair, because
 * none of them are observable from a tool's return envelope alone.
 */

interface ConnectOptions {
  elicitation?: boolean;
  onElicit?: (message: string) => { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };
  bridgeOverride?: BridgeClient;
  projectPath?: string;
}

async function connect(opts: ConnectOptions = {}) {
  const ctx = buildContext({
    mock: opts.bridgeOverride === undefined,
    projectPath: opts.projectPath ?? process.cwd(),
    ...(opts.bridgeOverride ? { bridgeOverride: opts.bridgeOverride } : {}),
  });
  const server = createServer(ctx);
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    opts.elicitation ? { capabilities: { elicitation: {} } } : {}
  );
  const elicited: string[] = [];
  if (opts.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicited.push(request.params.message);
      return opts.onElicit?.(request.params.message) ?? { action: "decline" as const };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server, elicited, close: () => Promise.all([client.close(), server.close()]) };
}

/** Bridge double whose responses are driven per method by the test. */
function scriptedBridge(handlers: Record<string, (params: Record<string, unknown>) => unknown>, calls: Array<{ method: string; params: Record<string, unknown> }>): BridgeClient {
  return {
    source: "unity_bridge",
    async call<T>(method: BridgeMethod, params: Record<string, unknown> = {}): Promise<BridgeResponse<T>> {
      calls.push({ method, params });
      const handler = handlers[method];
      const result = handler?.(params);
      if (result === undefined) {
        return {
          id: "t",
          ok: false,
          result: null,
          error: { code: "INVALID_ARGUMENT", message: `Unhandled ${method}` },
          meta: {},
        };
      }
      if (result instanceof Error) {
        return {
          id: "t",
          ok: false,
          result: null,
          error: { code: result.name, message: result.message, details: { dirtyScenes: ["Assets/Scenes/Sample.unity"] } },
          meta: {},
        };
      }
      return {
        id: "t",
        ok: true,
        result: result as T,
        error: null,
        meta: { unityVersion: "6000.0.0f1", projectPath: "/p", durationMs: 1 },
      };
    },
    async isConnected() {
      return true;
    },
  };
}

describe("mcp-server/tools-list metadata", () => {
  it("advertises a result-size cap on the tools whose output the project sizes", async () => {
    const { client, close } = await connect();
    try {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((t) => [t.name, t]));
      for (const name of [
        "unity_get_scene_hierarchy",
        "unity_reflect",
        "unity_query_project_brain",
        "unity_get_console_logs",
      ]) {
        const cap = byName.get(name)?._meta?.["anthropic/maxResultSizeChars"];
        expect(cap, name).toBe(200_000);
        expect(cap as number).toBeLessThanOrEqual(500_000);
      }
      // A bounded read tool carries no cap at all.
      expect(byName.get("unity_get_open_scenes")?._meta?.["anthropic/maxResultSizeChars"]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("marks exactly the arbitrary-execution tools as requiring user interaction", async () => {
    const { client, close } = await connect();
    try {
      const listed = await client.listTools();
      const flagged = listed.tools
        .filter((t) => t._meta?.["anthropic/requiresUserInteraction"] === true)
        .map((t) => t.name)
        .sort();
      expect(flagged).toEqual(["unity_execute_code", "unity_execute_menu_item"]);
    } finally {
      await close();
    }
  });

  it("lists tools in a stable order across servers and across group toggles", async () => {
    const first = await connect();
    const second = await connect();
    try {
      const a = (await first.client.listTools()).tools.map((t) => t.name);
      const b = (await second.client.listTools()).tools.map((t) => t.name);
      expect(a).toEqual(b);
      expect(a).toEqual(allTools.map((t) => t.name));

      // Disabling and re-enabling a group must not reshuffle the list.
      await first.client.callTool({
        name: "unity_manage_tools",
        arguments: { action: "deactivate", group: "codegen" },
      });
      const trimmed = (await first.client.listTools()).tools.map((t) => t.name);
      expect(trimmed).toEqual(a.filter((n) => n !== "unity_execute_code"));
      await first.client.callTool({
        name: "unity_manage_tools",
        arguments: { action: "activate", group: "codegen" },
      });
      expect((await first.client.listTools()).tools.map((t) => t.name)).toEqual(a);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

describe("mcp-server/progress notifications", () => {
  it("streams phase progress when the client sends a progressToken", async () => {
    const { client, close } = await connect();
    try {
      const updates: Array<{ progress: number; message?: string }> = [];
      const result = await client.callTool(
        { name: "unity_verify", arguments: {} },
        undefined,
        { onprogress: (p) => updates.push({ progress: p.progress, message: p.message }) }
      );
      expect(result.isError).toBeFalsy();
      expect(updates.length).toBeGreaterThan(1);
      expect(updates.map((u) => u.message).join(" | ")).toContain("refreshing assets");
      // Progress must strictly increase, including across the nested compile/test phases.
      for (let i = 1; i < updates.length; i++) {
        expect(updates[i].progress, JSON.stringify(updates)).toBeGreaterThan(updates[i - 1].progress);
      }
    } finally {
      await close();
    }
  });

  it("sends nothing when the client did not ask for progress", async () => {
    const { client, server, close } = await connect();
    try {
      const seen: unknown[] = [];
      const original = server.server.notification.bind(server.server);
      server.server.notification = async (notification, options) => {
        seen.push(notification);
        return original(notification, options);
      };
      const result = await client.callTool({ name: "unity_verify", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(seen.filter((n) => (n as { method: string }).method === "notifications/progress")).toEqual([]);
    } finally {
      await close();
    }
  });

  it("reports capture progress for unity_capture_frames", async () => {
    const { client, close } = await connect();
    try {
      const messages: string[] = [];
      await client.callTool(
        { name: "unity_capture_frames", arguments: { frames: 3, save: false } },
        undefined,
        { onprogress: (p) => messages.push(p.message ?? "") }
      );
      expect(messages.some((m) => m.includes("frames"))).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("mcp-server/elicitation", () => {
  const unsavedBridge = (calls: Array<{ method: string; params: Record<string, unknown> }>) =>
    scriptedBridge(
      {
        "scene.open": (params) => {
          if (params.discardUnsavedChanges === true) {
            return { opened: params.scenePath, scenes: [], activeScene: params.scenePath };
          }
          return Object.assign(new Error("Opening a scene would discard unsaved changes."), {
            name: "UNSAVED_CHANGES",
          });
        },
      },
      calls
    );

  it("asks before discarding unsaved scene changes, then opens the scene", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const { client, elicited, close } = await connect({
      elicitation: true,
      onElicit: () => ({ action: "accept", content: { discard: true } }),
      bridgeOverride: unsavedBridge(calls),
    });
    try {
      const result = await client.callTool({
        name: "unity_open_scene",
        arguments: { scenePath: "Assets/Scenes/Level1.unity" },
      });
      expect(result.isError).toBeFalsy();
      expect(elicited).toHaveLength(1);
      expect(elicited[0]).toContain("Assets/Scenes/Sample.unity");
      expect(calls.map((c) => c.params.discardUnsavedChanges)).toEqual([false, true]);
    } finally {
      await close();
    }
  });

  it("leaves the UNSAVED_CHANGES envelope untouched when the user declines", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const { client, close } = await connect({
      elicitation: true,
      onElicit: () => ({ action: "decline" }),
      bridgeOverride: unsavedBridge(calls),
    });
    try {
      const result = await client.callTool({
        name: "unity_open_scene",
        arguments: { scenePath: "Assets/Scenes/Level1.unity" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("UNSAVED_CHANGES");
      expect(calls).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("returns the same error without asking when the client cannot elicit", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const { client, close } = await connect({ bridgeOverride: unsavedBridge(calls) });
    try {
      const result = await client.callTool({
        name: "unity_open_scene",
        arguments: { scenePath: "Assets/Scenes/Level1.unity" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("UNSAVED_CHANGES");
      expect(calls).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("asks once for a menu item outside the allowlist without widening the config", async () => {
    const projectPath = await fsp.mkdtemp(path.join(os.tmpdir(), "uvibe-menu-"));
    const configPath = path.join(projectPath, ".unity-vibe", "config.json");
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, JSON.stringify({ allowMenuItems: true, allowedMenuItems: ["Assets/Refresh"] }));
    const tool = allTools.find((t) => t.name === "unity_execute_menu_item")!;
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = scriptedBridge(
      { "editor.executeMenuItem": (p) => ({ applied: true, executed: true, menuItem: p.menuItem }) },
      calls
    );

    try {
      const asked: string[] = [];
      const accepted = await tool.run(
        { menuItem: "GameObject/Align With View" },
        {
          bridge,
          projectPath,
          configMockMode: false,
          confirmWithUser: async (request) => {
            asked.push(request.message);
            return "accept";
          },
        }
      );
      expect(accepted.ok).toBe(true);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain("GameObject/Align With View");
      // The grant is for this call only — the on-disk allowlist is unchanged.
      expect(JSON.parse(await fsp.readFile(configPath, "utf8")).allowedMenuItems).toEqual(["Assets/Refresh"]);

      const declined = await tool.run(
        { menuItem: "GameObject/Align With View" },
        { bridge, projectPath, configMockMode: false, confirmWithUser: async () => "decline" }
      );
      expect(declined.ok).toBe(false);
      if (!declined.ok) expect(declined.error.code).toBe("MENU_ITEM_NOT_ALLOWED");

      // No elicitation channel (e.g. Codex CLI): the existing error envelope stands.
      const unsupported = await tool.run(
        { menuItem: "GameObject/Align With View" },
        { bridge, projectPath, configMockMode: false }
      );
      expect(unsupported.ok).toBe(false);
      if (!unsupported.ok) expect(unsupported.error.code).toBe("MENU_ITEM_NOT_ALLOWED");
      expect(calls).toHaveLength(1);
    } finally {
      await fsp.rm(projectPath, { recursive: true, force: true });
    }
  });
});
