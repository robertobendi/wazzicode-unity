import { loadConfig } from "@uvibe/safety";
import { ensureEditorRunning, type EnsureEditorResult } from "@uvibe/unity-cli";
import type { ToolContext } from "../registry.js";
import { reportProgress } from "../interaction.js";

/**
 * Self-healing connection step shared by the tools that *need* a live Editor.
 *
 * Historically `UNITY_NOT_CONNECTED` ended the task: the agent had to stop and ask a human to open
 * Unity. When the Unity CLI is installed we can just open it. This helper is the single place that
 * decides whether to do that (config `autoLaunchEditor`, never in mock mode), relays the wait as
 * MCP progress so the client's idle timer keeps resetting, and stays completely silent — returning
 * `attempted:false` — when the CLI isn't there, so every caller degrades to the old behaviour.
 */

export interface AutoLaunchAttempt {
  attempted: boolean;
  ready: boolean;
  /** One-line summary suitable for a tool `warnings[]` entry. */
  summary?: string;
  result?: EnsureEditorResult;
}

const NOT_ATTEMPTED: AutoLaunchAttempt = { attempted: false, ready: false };

/** Default budget for an implicit launch. Long enough for a cold Editor, short of a first import. */
const IMPLICIT_LAUNCH_TIMEOUT_MS = 180_000;

export async function autoLaunchEditor(
  ctx: ToolContext,
  opts: { timeoutMs?: number; progressLabel?: string } = {}
): Promise<AutoLaunchAttempt> {
  if (ctx.configMockMode) return NOT_ATTEMPTED;
  const config = await loadConfig(ctx.projectPath);
  if (!config.autoLaunchEditor) return NOT_ATTEMPTED;

  let step = 0;
  const label = opts.progressLabel ?? "unity";
  const result = await ensureEditorRunning(ctx.projectPath, {
    timeoutMs: opts.timeoutMs ?? IMPLICIT_LAUNCH_TIMEOUT_MS,
    installMissingEditor: config.autoInstallEditor,
    ...(config.unityCliPath ? { cliPath: config.unityCliPath } : {}),
    onProgress: (message) => reportProgress(ctx, ++step, undefined, `${label}: ${message}`),
  });

  // "already_running" means the bridge was up all along — the caller's failure was something else
  // (a reload, a stall), so report nothing and let its own error stand.
  if (result.outcome === "already_running") return NOT_ATTEMPTED;
  if (result.outcome === "cli_unavailable" || result.outcome === "not_a_project") return NOT_ATTEMPTED;

  return {
    attempted: true,
    ready: result.ready,
    summary: result.ready
      ? `Auto-started the Unity Editor (${result.outcome}, ${Math.round(result.waitedMs / 1000)}s).`
      : `Auto-start did not reach a live Editor (${result.outcome}): ${result.message} → ${result.nextAction}`,
    result,
  };
}

/** True when an envelope failed only because no Editor was listening. */
export function isNotConnected(error: { code: string } | undefined): boolean {
  return error?.code === "UNITY_NOT_CONNECTED";
}
