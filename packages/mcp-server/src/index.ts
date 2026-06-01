import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import { PRODUCT_VERSION, ToolEnvelope, err } from "@uvibe/core";
import { appendAction, createSnapshot, gateTool, loadConfig } from "@uvibe/safety";
import { BridgeClient, createHttpBridgeClient, HttpBridgeOptions } from "./bridgeClient.js";
import { createMockBridgeClient } from "./mockBridge.js";
import { allTools } from "./tools/index.js";
import { AnyToolDef, ToolContext } from "./registry.js";

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * If the envelope carries a base64 PNG (screenshot tools), surface it as a multimodal
 * `image` content block so Claude can SEE it. The text envelope replaces the bulky base64
 * with a placeholder so the JSON view stays readable.
 */
function shapeContent(env: ToolEnvelope<unknown>): McpContent[] {
  const content: McpContent[] = [];
  let textEnv: unknown = env;
  if (env.ok && typeof env.data === "object" && env.data !== null) {
    const data = env.data as { pngBase64?: unknown; mimeType?: unknown };
    if (typeof data.pngBase64 === "string" && data.pngBase64.length > 0) {
      const mime = typeof data.mimeType === "string" ? data.mimeType : "image/png";
      content.push({ type: "image", data: data.pngBase64, mimeType: mime });
      const placeholder = `<base64 ${mime}, ${data.pngBase64.length} chars>`;
      textEnv = {
        ...env,
        data: { ...(data as object), pngBase64: placeholder },
      };
    }
  }
  content.push({ type: "text", text: JSON.stringify(textEnv, null, 2) });
  return content;
}

export interface ServeOptions {
  mock?: boolean;
  projectPath?: string;
  bridge?: HttpBridgeOptions;
  /** If provided, the server uses this bridge instead of creating one. */
  bridgeOverride?: BridgeClient;
}

export function buildContext(opts: ServeOptions = {}): ToolContext {
  const projectPath = opts.projectPath ?? process.env.UVIBE_PROJECT ?? process.cwd();
  const bridge =
    opts.bridgeOverride ??
    (opts.mock || process.env.UVIBE_MOCK === "1"
      ? createMockBridgeClient()
      : createHttpBridgeClient({ projectPath, ...(opts.bridge ?? {}) }));
  return {
    bridge,
    projectPath,
    configMockMode: opts.mock === true || process.env.UVIBE_MOCK === "1",
  };
}

/**
 * Run a write tool through the safety gate: check safetyMode/per-target flags, optionally
 * snapshot the affected file, execute, and record the outcome to the action log. Returns the
 * tool envelope (a SAFETY_MODE_BLOCKED error when the gate denies it).
 */
async function runGatedWrite(
  tool: AnyToolDef,
  parsed: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEnvelope<unknown>> {
  const config = await loadConfig(ctx.projectPath);
  const decision = gateTool(config, tool.name, tool.writeTarget);
  if (!decision.allowed) {
    const blocked = err(decision.errorCode ?? "SAFETY_MODE_BLOCKED", decision.reason, {
      source: ctx.bridge.source,
    });
    await safeAppend(ctx.projectPath, {
      timestamp: Date.now(),
      tool: tool.name,
      args: parsed,
      result: "blocked",
      errorCode: blocked.error.code,
    });
    return blocked;
  }

  // Best-effort snapshot of the scene file before a save, when autoSnapshot is on.
  let snapshotId: string | undefined;
  if (config.autoSnapshot && tool.name === "unity_save_scene" && typeof parsed.scenePath === "string") {
    try {
      const snap = await createSnapshot(ctx.projectPath, [parsed.scenePath]);
      snapshotId = snap.id;
    } catch {
      // Snapshot is best-effort; Unity's Undo system remains the primary safety net.
    }
  }

  const env = await tool.run(parsed as never, ctx);
  await safeAppend(ctx.projectPath, {
    timestamp: Date.now(),
    tool: tool.name,
    args: parsed,
    result: env.ok ? "ok" : "error",
    errorCode: env.ok ? undefined : env.error.code,
    snapshotId,
    notes: env.ok && typeof (env.data as { summary?: unknown })?.summary === "string"
      ? ((env.data as { summary: string }).summary)
      : undefined,
  });
  return env;
}

async function safeAppend(projectPath: string, entry: Parameters<typeof appendAction>[1]): Promise<void> {
  try {
    await appendAction(projectPath, entry);
  } catch {
    // Never let action-logging failure break a tool call.
  }
}

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: "unity-vibe-os",
    version: PRODUCT_VERSION,
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape as ZodRawShape,
      },
      async (rawArgs: unknown) => {
        try {
          const parsed = z.object(tool.inputShape as ZodRawShape).parse(rawArgs ?? {});
          if ((tool as AnyToolDef).write && !ctx.configMockMode) {
            const gated = await runGatedWrite(tool as AnyToolDef, parsed, ctx);
            return { content: shapeContent(gated), isError: gated.ok ? false : true };
          }
          const env = await tool.run(parsed as never, ctx);
          return {
            content: shapeContent(env),
            isError: env.ok ? false : true,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const env = err("INVALID_ARGUMENT", `Tool ${tool.name} input invalid or threw: ${msg}`, {
            source: ctx.bridge.source,
          });
          return {
            content: shapeContent(env),
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

export async function startMcpServer(opts: ServeOptions = {}): Promise<void> {
  const ctx = buildContext(opts);
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export {
  createHttpBridgeClient,
  createMockBridgeClient,
  type BridgeClient,
  type HttpBridgeOptions,
};
export { allTools } from "./tools/index.js";
export type { ToolContext, ToolDef } from "./registry.js";
