import {
  buildContext,
  allTools,
  createMockBridgeClient,
} from "@uvibe/mcp-server";
import { ToolEnvelope } from "@uvibe/core";
import { CommandResult, GlobalOptions } from "../options.js";

export interface VerifyResult {
  total: number;
  passed: number;
  failed: number;
  cases: Array<{ name: string; ok: boolean; reason?: string }>;
}

const ACCEPTANCE: Array<{ tool: string; args?: Record<string, unknown>; expectShape?: (data: unknown) => string | null }> = [
  { tool: "unity_project_summary", expectShape: (d: any) => d?.unityVersion ? null : "missing unityVersion" },
  { tool: "unity_get_open_scenes", expectShape: (d: any) => Array.isArray(d?.scenes) ? null : "missing scenes[]" },
  { tool: "unity_get_scene_hierarchy", expectShape: (d: any) => Array.isArray(d?.roots) ? null : "missing roots[]" },
  { tool: "unity_inspect_selected", expectShape: (d: any) => "hasSelection" in (d ?? {}) ? null : "missing hasSelection" },
  { tool: "unity_get_console_logs", expectShape: (d: any) => Array.isArray(d?.logs) ? null : "missing logs[]" },
  { tool: "unity_wait_for_compile", expectShape: (d: any) => "isCompiling" in (d ?? {}) ? null : "missing isCompiling" },
  { tool: "unity_check_git_status", expectShape: (d: any) => "isGitRepo" in (d ?? {}) ? null : "missing isGitRepo" },
  {
    tool: "unity_capture_game_view",
    args: { save: false },
    expectShape: (d: any) => (typeof d?.pngBase64 === "string" && d.pngBase64.length > 0 ? null : "missing pngBase64"),
  },
  {
    tool: "unity_capture_scene_view",
    args: { save: false },
    expectShape: (d: any) => (typeof d?.pngBase64 === "string" && d.pngBase64.length > 0 ? null : "missing pngBase64"),
  },
  {
    tool: "unity_capture_selected",
    args: { save: false },
    expectShape: (d: any) => (typeof d?.pngBase64 === "string" && d.pngBase64.length > 0 ? null : "missing pngBase64"),
  },
];

export async function runVerify(g: GlobalOptions): Promise<CommandResult> {
  // Verify always runs against the mock bridge for determinism.
  const ctx = buildContext({
    mock: true,
    projectPath: g.project,
    bridgeOverride: createMockBridgeClient(),
  });
  const cases: VerifyResult["cases"] = [];
  for (const acceptance of ACCEPTANCE) {
    const tool = allTools.find((t) => t.name === acceptance.tool);
    if (!tool) {
      cases.push({ name: acceptance.tool, ok: false, reason: "tool not registered" });
      continue;
    }
    const env: ToolEnvelope<unknown> = await tool.run((acceptance.args ?? {}) as never, ctx);
    if (!env.ok) {
      cases.push({ name: tool.name, ok: false, reason: `envelope error ${env.error.code}: ${env.error.message}` });
      continue;
    }
    const shapeError = acceptance.expectShape?.(env.data) ?? null;
    if (shapeError) {
      cases.push({ name: tool.name, ok: false, reason: shapeError });
      continue;
    }
    cases.push({ name: tool.name, ok: true });
  }

  const passed = cases.filter((c) => c.ok).length;
  const failed = cases.length - passed;
  const result: VerifyResult = { total: cases.length, passed, failed, cases };

  if (g.json) {
    return { exitCode: failed === 0 ? 0 : 1, stdout: JSON.stringify(result, null, 2) + "\n" };
  }

  const lines: string[] = [];
  lines.push(`Unity Vibe OS — verify (mock bridge)`);
  for (const c of cases) lines.push(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.ok ? "" : ` — ${c.reason ?? ""}`}`);
  lines.push("");
  lines.push(`${passed}/${cases.length} passed${failed > 0 ? ` (${failed} failed)` : ""}`);
  return { exitCode: failed === 0 ? 0 : 1, stdout: lines.join("\n") + "\n" };
}
