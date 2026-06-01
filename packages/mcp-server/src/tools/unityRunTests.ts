import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { TestRunStatus, ToolEnvelope, isErrorCode } from "@uvibe/core";

const InputShape = {
  mode: z.enum(["EditMode", "PlayMode"]).optional(),
  filter: z
    .string()
    .optional()
    .describe("Run only tests whose full name matches this (e.g. 'MyNamespace.MyTests')."),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(1_800_000)
    .optional()
    .describe("Max time to wait for the run to finish (default 5 min)."),
  pollMs: z.number().int().min(200).max(10_000).optional(),
};

export const unityRunTests: ToolDef<typeof InputShape, TestRunStatus> = {
  name: "unity_run_tests",
  description:
    "Runs the Unity Test Framework (EditMode by default, or PlayMode) and returns structured pass/fail results with messages and stack traces — the agent's ground truth for whether code actually works, not just compiles. Starts the run, then polls until it completes (PlayMode runs reload the domain; this rides through that). Requires com.unity.test-framework; without it the bridge returns TEST_FRAMEWORK_MISSING. Use `filter` to scope to a subset.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    const mode = args.mode ?? "EditMode";
    const timeoutMs = args.timeoutMs ?? 300_000;
    const pollMs = args.pollMs ?? 1000;

    const started = await bridgeCall<TestRunStatus>(ctx.bridge, BRIDGE_METHODS.testRun, {
      mode,
      filter: args.filter,
    });
    if (!started.ok) return started; // e.g. TEST_FRAMEWORK_MISSING

    const runId = started.data.runId;
    if (ctx.configMockMode) {
      // Mock bridge resolves synchronously; one status fetch returns the completed run.
      const s = await bridgeCall<TestRunStatus>(ctx.bridge, BRIDGE_METHODS.testStatus, { runId });
      return s.ok ? s : started;
    }
    const start = Date.now();
    let last: ToolEnvelope<TestRunStatus> = started;
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      const status = await bridgeCall<TestRunStatus>(ctx.bridge, BRIDGE_METHODS.testStatus, { runId });
      if (!status.ok) {
        // UNITY_RELOADING is already retried inside bridgeCall; anything else is terminal.
        const code = isErrorCode(status.error.code) ? status.error.code : "INTERNAL_ERROR";
        if (code === "UNITY_RELOADING") continue;
        return status;
      }
      last = status;
      if (status.data.state !== "running") {
        if (status.data.failed && status.data.failed > 0) {
          status.warnings.push(`${status.data.failed} test(s) failed.`);
        }
        return status;
      }
    }
    if (last.ok) last.warnings.push(`Timed out after ${timeoutMs}ms; tests may still be running.`);
    return last;
  },
};
