import { BridgeMethod, BridgeResponse, ErrorCode, isErrorCode, ToolEnvelope, err, ok, timed } from "@uvibe/core";
import { BridgeClient } from "./httpClient.js";

/**
 * Run a single bridge call and lift the bridge envelope into the MCP tool envelope.
 * Source is taken from the bridge ("unity_bridge" | "mock").
 *
 * Rides through script-domain reloads: a recompile (or entering play mode) briefly drops
 * the bridge socket, surfaced as UNITY_RELOADING. Rather than fail the tool, we wait and
 * retry for a few seconds so the agent's call simply resumes once Unity is back.
 */
export async function bridgeCall<T>(
  bridge: BridgeClient,
  method: BridgeMethod,
  params: Record<string, unknown> = {},
  detailLevel: "summary" | "normal" | "full" = "normal"
): Promise<ToolEnvelope<T>> {
  const reloadDeadline = Date.now() + 20_000;
  let result: BridgeResponse<T>;
  let durationMs = 0;
  // Short reloads are common (small script change), so start retrying quickly and back off.
  let retryMs = 150;
  for (;;) {
    const timedCall = await timed(() => bridge.call<T>(method, params));
    result = timedCall.result;
    durationMs += timedCall.durationMs;
    if (result.ok || result.error.code !== "UNITY_RELOADING" || Date.now() >= reloadDeadline) break;
    await new Promise((r) => setTimeout(r, retryMs));
    retryMs = Math.min(800, Math.round(retryMs * 1.6));
  }
  if (!result.ok) {
    const code: ErrorCode = isErrorCode(result.error.code)
      ? result.error.code
      : "INTERNAL_ERROR";
    return err(code, result.error.message, {
      source: bridge.source,
      durationMs,
      detailLevel,
    }, result.error.details);
  }
  return ok(result.result, {
    source: bridge.source,
    durationMs,
    detailLevel,
    unityVersion: result.meta?.unityVersion,
    projectPath: result.meta?.projectPath,
  });
}

/**
 * True when the bridge answered but does not know the method — i.e. the Unity package predates
 * a newer protocol method (e.g. the long-poll awaits). Callers use this to fall back to the
 * legacy polling path instead of failing.
 */
export function isUnknownMethodError(env: ToolEnvelope<unknown>): boolean {
  if (env.ok) return false;
  return /unknown method|no responder/i.test(env.error.message ?? "");
}
