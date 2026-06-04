import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { CodeExecResult } from "@uvibe/core";

/**
 * Run a snippet of C# inside the live Editor. The snippet becomes the body of a static
 * Execute() method (return a value to get it back); whatever it logs is captured too. This is the
 * escape hatch for one-off Editor operations that have no dedicated tool — bulk edits, probing an
 * API, recomputing something — without creating a script file and waiting for a domain reload.
 *
 * It is unsandboxed and powerful, so it is gated behind a dedicated `code` target
 * (confirm/autopilot + allowCodeExecution, which is OFF by default and NOT enabled by
 * `autonomy on`). Compilation needs the project's Api Compatibility Level to be ".NET Framework";
 * otherwise it returns FEATURE_UNAVAILABLE and you should use unity_create_script instead.
 */
const ExecuteCodeShape = {
  code: z
    .string()
    .describe("C# statements forming the body of `static object Execute()`. `return <x>;` to report a value. Common usings (UnityEngine/UnityEditor/System.Linq/...) are already imported."),
  usings: z.array(z.string()).optional().describe("Extra namespaces to `using`, e.g. ['UnityEngine.UI']."),
  safetyChecks: z
    .boolean()
    .optional()
    .describe("Refuse snippets containing obviously destructive calls (File/Directory.Delete, Process.Start, infinite loops). Default true."),
};

export const unityExecuteCode: ToolDef<typeof ExecuteCodeShape, CodeExecResult> = {
  name: "unity_execute_code",
  description:
    "Compiles and runs a C# snippet inside the Editor and returns its return value, captured logs, and any compile/runtime errors. Use for ad-hoc Editor automation with no dedicated tool. Powerful and unsandboxed — gated by safetyMode (confirm/autopilot + allowCodeExecution, off by default). Needs Api Compatibility Level '.NET Framework'; otherwise prefer unity_create_script + unity_verify.",
  requires: ["unity_bridge"],
  write: true,
  writeTarget: "code",
  inputShape: ExecuteCodeShape,
  async run(args, ctx) {
    return bridgeCall<CodeExecResult>(ctx.bridge, BRIDGE_METHODS.codeExecute, {
      code: args.code,
      usings: args.usings,
      safetyChecks: args.safetyChecks ?? true,
    });
  },
};
