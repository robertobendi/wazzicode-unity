import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall, isUnknownMethodError } from "./_helpers.js";
import { CompileStatus, ToolEnvelope, err, isErrorCode } from "@uvibe/core";

const InputShape = {
  timeoutMs: z.number().int().min(500).max(300_000).optional(),
  pollMs: z.number().int().min(100).max(5_000).optional(),
};

/** Single long-poll round is capped server-side; re-issue until our own deadline. */
const AWAIT_WINDOW_MS = 25_000;

export const unityWaitForCompile: ToolDef<typeof InputShape, CompileStatus> = {
  name: "unity_wait_for_compile",
  description:
    "Waits until Unity's compile status is idle (or the timeout elapses) and returns the final status with error/warning counts. Uses a server-side long-poll so it returns the moment compilation settles; falls back to client-side polling against older Unity packages. Backed by UnityEditor.Compilation.CompilationPipeline; if detailed errors are unavailable, the response includes a 'fallback' note.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    const timeoutMs = args.timeoutMs ?? 60_000;
    const pollMs = args.pollMs ?? 500;
    const start = Date.now();
    let last: ToolEnvelope<CompileStatus> | undefined;
    // Fast path: compile.await holds the request open inside Unity and settles within ~50ms of
    // the compile finishing — no client-side poll interval to wait out.
    let useAwait = true;
    while (Date.now() - start < timeoutMs) {
      if (useAwait) {
        const remaining = timeoutMs - (Date.now() - start);
        last = await bridgeCall<CompileStatus>(ctx.bridge, BRIDGE_METHODS.compileAwait, {
          timeoutMs: Math.min(remaining, AWAIT_WINDOW_MS),
        });
        if (last.ok) {
          if (last.data.settled !== false) return last;
          continue; // long-poll window closed while still compiling — re-issue
        }
        if (isUnknownMethodError(last)) {
          useAwait = false; // older Unity package: fall back to client-side polling
          continue;
        }
        const errCode = isErrorCode(last.error.code) ? last.error.code : "INTERNAL_ERROR";
        return err(errCode, last.error.message, last.meta);
      }
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
