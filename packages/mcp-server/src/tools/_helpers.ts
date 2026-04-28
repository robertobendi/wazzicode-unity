import { BRIDGE_METHODS, BridgeMethod, ErrorCode, isErrorCode, ToolEnvelope, err, ok, timed } from "@uvibe/core";
import { BridgeClient } from "../bridgeClient.js";

/**
 * Run a single bridge call and lift the bridge envelope into the MCP tool envelope.
 * Source is taken from the bridge ("unity_bridge" | "mock").
 */
export async function bridgeCall<T>(
  bridge: BridgeClient,
  method: BridgeMethod,
  params: Record<string, unknown> = {},
  detailLevel: "summary" | "normal" | "full" = "normal"
): Promise<ToolEnvelope<T>> {
  const { result, durationMs } = await timed(() => bridge.call<T>(method, params));
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

export { BRIDGE_METHODS, ok, err, timed };
