import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { CompileStatus, ToolEnvelope, err, isErrorCode } from "@uvibe/core";

const InputShape = {
  timeoutMs: z.number().int().min(500).max(300_000).optional(),
  pollMs: z.number().int().min(100).max(5_000).optional(),
};

export const unityWaitForCompile: ToolDef<typeof InputShape, CompileStatus> = {
  name: "unity_wait_for_compile",
  description:
    "Polls Unity's compile status until idle or until the timeout elapses. Returns final compile status with error/warning counts. Backed by UnityEditor.Compilation.CompilationPipeline; if detailed errors are unavailable, the response includes a 'fallback' note.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    const timeoutMs = args.timeoutMs ?? 60_000;
    const pollMs = args.pollMs ?? 500;
    const start = Date.now();
    let last: ToolEnvelope<CompileStatus> | undefined;
    while (Date.now() - start < timeoutMs) {
      last = await bridgeCall<CompileStatus>(ctx.bridge, BRIDGE_METHODS.compileStatus);
      if (!last.ok) {
        const errCode = isErrorCode(last.error.code) ? last.error.code : "INTERNAL_ERROR";
        return err(errCode, last.error.message, last.meta);
      }
      if (!last.data.isCompiling) return last;
      await sleep(pollMs);
    }
    if (last) {
      if (last.ok) {
        last.warnings.push(`Timed out after ${timeoutMs}ms while still compiling.`);
      }
      return last;
    }
    return err("BRIDGE_TIMEOUT", "Could not reach Unity bridge before timeout.", {
      source: ctx.bridge.source,
      durationMs: Date.now() - start,
    });
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
