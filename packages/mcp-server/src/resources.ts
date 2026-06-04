import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readActions } from "@uvibe/safety";
import { ToolContext } from "./registry.js";

/**
 * MCP resources. Claude Code lets the user @-mention these (and the model can read them on demand),
 * so Unity state becomes first-class context: the generated project brain & conventions, the action
 * log of what's been changed, and live snapshots of the scene hierarchy and console. The file-backed
 * ones degrade to a friendly note when absent; the live ones go through the bridge.
 */
export interface ResourceContents {
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
  // The MCP ReadResourceResult type carries an index signature (for _meta); mirror it so our
  // callbacks are structurally assignable without per-call casts.
  [k: string]: unknown;
}

async function readTextFile(ctx: ToolContext, rel: string, uri: string, mimeType: string): Promise<ResourceContents> {
  try {
    const text = await fs.readFile(path.join(ctx.projectPath, rel), "utf8");
    return { contents: [{ uri, mimeType, text }] };
  } catch {
    return { contents: [{ uri, mimeType: "text/plain", text: `(${rel} not found — run \`uvibe brain\` to generate the project brain.)` }] };
  }
}

export async function readActionLogResource(ctx: ToolContext, uri = "unity://action-log"): Promise<ResourceContents> {
  const entries = await readActions(ctx.projectPath, 50);
  const text = entries.length ? entries.map((e) => JSON.stringify(e)).join("\n") : "(no actions logged yet)";
  return { contents: [{ uri, mimeType: "application/x-ndjson", text }] };
}

export async function readSceneHierarchyResource(ctx: ToolContext, uri = "unity://scene-hierarchy"): Promise<ResourceContents> {
  const res = await ctx.bridge.call("scene.getHierarchy", { maxDepth: 32, includeComponents: true, maxNodes: 2000 });
  const text = JSON.stringify(res.ok ? res.result : { error: res.error }, null, 2);
  return { contents: [{ uri, mimeType: "application/json", text }] };
}

export async function readConsoleResource(ctx: ToolContext, uri = "unity://console"): Promise<ResourceContents> {
  const res = await ctx.bridge.call("console.getLogs", { level: "all", limit: 100 });
  const text = JSON.stringify(res.ok ? res.result : { error: res.error }, null, 2);
  return { contents: [{ uri, mimeType: "application/json", text }] };
}

export function registerResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    "project-brain",
    "unity://project-brain",
    { title: "Unity project brain", description: "Generated summary of the project (engine, packages, assets, architecture).", mimeType: "text/markdown" },
    (uri) => readTextFile(ctx, ".unity-vibe/project_brain.md", uri.href, "text/markdown")
  );
  server.registerResource(
    "conventions",
    "unity://conventions",
    { title: "Project conventions", description: "Team conventions Claude should follow in this project.", mimeType: "text/markdown" },
    (uri) => readTextFile(ctx, ".unity-vibe/conventions.md", uri.href, "text/markdown")
  );
  server.registerResource(
    "action-log",
    "unity://action-log",
    { title: "Unity Vibe action log", description: "The last 50 write operations Claude performed (JSONL).", mimeType: "application/x-ndjson" },
    (uri) => readActionLogResource(ctx, uri.href)
  );
  server.registerResource(
    "scene-hierarchy",
    "unity://scene-hierarchy",
    { title: "Active scene hierarchy", description: "Live GameObject tree of the active scene (capped).", mimeType: "application/json" },
    (uri) => readSceneHierarchyResource(ctx, uri.href)
  );
  server.registerResource(
    "console",
    "unity://console",
    { title: "Unity console", description: "Live snapshot of the last 100 Unity console entries.", mimeType: "application/json" },
    (uri) => readConsoleResource(ctx, uri.href)
  );
}
