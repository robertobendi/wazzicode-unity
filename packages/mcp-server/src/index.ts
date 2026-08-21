import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";
import { PRODUCT_VERSION, ToolEnvelope, err } from "@uvibe/core";
import { BridgeClient, createHttpBridgeClient, HttpBridgeOptions, timeoutForMethod } from "@uvibe/bridge-client";
import { ensureBrainCurrent, readKnowledgeBase, type KnowledgeBase } from "@uvibe/project-brain";
import { createMockBridgeClient } from "./mockBridge.js";
import { allTools } from "./tools/index.js";
import { AnyToolDef, ToolContext } from "./registry.js";
import { ensureUnityPackageCurrent } from "./selfUpdate.js";
import { executeTool } from "./execute.js";
import { ToolGroupController, defaultActiveGroups } from "./groups.js";
import { toolAnnotations, toolMeta } from "./annotations.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { composeInstructions } from "./instructions.js";
import type { ConfirmElicitor, ProgressReporter } from "./interaction.js";

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

interface FrameLike {
  index?: unknown;
  tMs?: unknown;
  imageBase64?: unknown;
}

/**
 * If the envelope carries base64 image bytes, surface them as multimodal `image` content blocks
 * so Claude can SEE them: one image for a screenshot tool, or a labelled sequence for a frame
 * capture. The text envelope replaces the bulky base64 with a placeholder so the JSON view stays
 * readable.
 */
function shapeContent(env: ToolEnvelope<unknown>): McpContent[] {
  const content: McpContent[] = [];
  let textEnv: unknown = env;
  if (env.ok && typeof env.data === "object" && env.data !== null) {
    const data = env.data as { pngBase64?: unknown; mimeType?: unknown; frames?: unknown };
    const mime = typeof data.mimeType === "string" ? data.mimeType : "image/png";
    if (typeof data.pngBase64 === "string" && data.pngBase64.length > 0) {
      content.push({ type: "image", data: data.pngBase64, mimeType: mime });
      textEnv = {
        ...env,
        data: { ...(data as object), pngBase64: placeholderFor(data.pngBase64, mime) },
      };
    } else if (Array.isArray(data.frames)) {
      const frames = data.frames as FrameLike[];
      const shown = frames.filter((f) => typeof f.imageBase64 === "string" && f.imageBase64.length > 0);
      for (const [i, frame] of shown.entries()) {
        const t = typeof frame.tMs === "number" ? Math.round(frame.tMs) : 0;
        content.push({ type: "text", text: `Frame ${i + 1}/${shown.length} — t=+${t}ms` });
        content.push({ type: "image", data: frame.imageBase64 as string, mimeType: mime });
      }
      if (shown.length > 0) {
        textEnv = {
          ...env,
          data: {
            ...(data as object),
            frames: frames.map((f) =>
              typeof f.imageBase64 === "string" && f.imageBase64.length > 0
                ? { ...f, imageBase64: placeholderFor(f.imageBase64, mime) }
                : f
            ),
          },
        };
      }
    }
  }
  content.push({ type: "text", text: JSON.stringify(textEnv, null, 2) });
  return content;
}

function placeholderFor(base64: string, mime: string): string {
  return `<base64 ${mime}, ${base64.length} chars>`;
}

type ToolCallExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Per-call view of the context, carrying the two channels that only exist while a request is in
 * flight: progress notifications (only when the client sent a progressToken — Claude Code kills
 * calls idle for 30 minutes and each notification resets that timer) and elicitation (only when
 * the client declared the capability; Codex CLI does not). Tools that don't use them are
 * unaffected, and a context built outside a request simply has neither.
 */
function callContext(ctx: ToolContext, server: McpServer, extra: ToolCallExtra): ToolContext {
  const progressToken = extra._meta?.progressToken;
  const onProgress: ProgressReporter | undefined =
    progressToken === undefined
      ? undefined
      : (update) => {
          void extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken, ...update },
            })
            .catch(() => {
              // A dropped progress notification must never fail the tool call itself.
            });
        };

  const confirm: ConfirmElicitor | undefined = server.server.getClientCapabilities()?.elicitation
    ? async (request) => {
        try {
          const result = await server.server.elicitInput({
            message: request.message,
            requestedSchema: {
              type: "object",
              properties: {
                [request.field]: {
                  type: "boolean",
                  title: request.fieldTitle,
                  description: request.fieldDescription,
                },
              },
              required: [request.field],
            },
          });
          if (result.action !== "accept") return result.action;
          return result.content?.[request.field] === true ? "accept" : "decline";
        } catch {
          // Client advertised elicitation but couldn't serve it — fall back to the non-interactive path.
          return "unsupported";
        }
      }
    : undefined;

  return {
    ...ctx,
    ...(onProgress ? { onProgress } : {}),
    ...(confirm ? { confirmWithUser: confirm } : {}),
  };
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
    tools: allTools,
  };
}

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "unity-vibe-os",
      version: PRODUCT_VERSION,
    },
    {
      // Delivered to Claude Code on connect — teaches the workflows in the user's project.
      // Static text + generated primer share the client's 2KB window; composeInstructions
      // trims the primer to fit rather than letting the client silently drop the tail.
      instructions: composeInstructions(ctx.projectKnowledgePrimer),
    }
  );

  // Tool-group controller: registers each tool's handle and disables the ones whose group is not
  // active at startup (e.g. codegen). unity_manage_tools drives it live via the context.
  const controller = ctx.toolGroups ?? new ToolGroupController(defaultActiveGroups());
  ctx.toolGroups = controller;

  for (const tool of allTools) {
    const meta = toolMeta(tool);
    const registered = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: toolAnnotations(tool),
        ...(meta ? { _meta: meta } : {}),
      },
      async (rawArgs: unknown, extra: ToolCallExtra) => {
        try {
          const parsed = z.object(tool.inputShape).parse(rawArgs ?? {});
          const env = await executeTool(tool, parsed, callContext(ctx, server, extra));
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
    controller.register(tool.name, registered);
  }

  // Claude Code surfaces these as /mcp__unity-vibe-os__<name> slash commands.
  registerPrompts(server);
  // Claude Code lets the user @-mention these unity:// resources.
  registerResources(server, ctx);

  return server;
}

export async function startMcpServer(opts: ServeOptions = {}): Promise<void> {
  const ctx = buildContext(opts);
  // Before anything else: the Editor package and this server ship together and speak one
  // protocol version, so a project carrying a stale embedded copy is a defect the server can
  // fix by itself. Startup is the right moment — Unity re-imports once, instead of mid-task.
  await ensureUnityPackageCurrent(ctx.projectPath, {
    mock: ctx.configMockMode,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  try {
    await ensureBrainCurrent(ctx.projectPath);
    const knowledge = await readKnowledgeBase(ctx.projectPath);
    if (knowledge) ctx.projectKnowledgePrimer = renderKnowledgePrimer(knowledge);
  } catch {
    // Orientation/query tools surface knowledge errors without preventing MCP startup.
  }
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function renderKnowledgePrimer(knowledge: KnowledgeBase): string {
  const { manifest, entities } = knowledge;
  // Kept short on purpose: this shares the client's 2KB instructions window with
  // SERVER_INSTRUCTIONS, and composeInstructions trims whatever still doesn't fit.
  const modules = entities
    .filter((entity) => entity.kind === "module" && entity.scope === "first-party")
    .map((entity) => entity.name)
    .slice(0, 8);
  const coverage = manifest.coverage.complete
    ? "complete"
    : `partial ${manifest.coverage.scanned}/${manifest.coverage.discovered}`;
  return [
    `PROJECT MAP (generated): ${manifest.project.name}. Coverage ${coverage}, ${manifest.coverage.counts.firstPartyScripts} first-party scripts.`,
    modules.length ? `Modules: ${modules.join(", ")}.` : "Modules: none detected.",
  ].join("\n");
}

export {
  createHttpBridgeClient,
  createMockBridgeClient,
  timeoutForMethod,
  type BridgeClient,
  type HttpBridgeOptions,
};
export { allTools } from "./tools/index.js";
export { selectReturnedFrames, hammingDistance } from "./tools/unityCaptureFrames.js";
export type { ToolContext, ToolDef } from "./registry.js";
export { ToolGroupController, defaultActiveGroups, groupOf, isKnownGroup, TOOL_GROUPS } from "./groups.js";
export { toolAnnotations, toolMeta, type ToolAnnotations } from "./annotations.js";
export { ensureUnityPackageCurrent, syncEditorPackage } from "./selfUpdate.js";
export {
  reportProgress,
  confirmWithUser,
  type ConfirmElicitor,
  type ElicitDecision,
  type InteractionContext,
  type ProgressReporter,
} from "./interaction.js";
export { UNITY_PROMPTS, registerPrompts } from "./prompts.js";
export {
  registerResources,
  readSceneHierarchyResource,
  readConsoleResource,
  readActionLogResource,
  readProjectBrainResource,
} from "./resources.js";
export { SERVER_INSTRUCTIONS, INSTRUCTIONS_BUDGET_BYTES, composeInstructions } from "./instructions.js";
