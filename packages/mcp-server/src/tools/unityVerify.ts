import { z } from "zod";
import { CompileStatus, ConsoleLogsResult, TestRunStatus, ToolEnvelope } from "@uvibe/core";
import { ToolDef } from "../registry.js";
import { ok } from "./_helpers.js";
import { unityWaitForCompile } from "./unityWaitForCompile.js";
import { unityGetConsoleLogs } from "./unityGetConsoleLogs.js";
import { unityRunTests } from "./unityRunTests.js";

/**
 * The canonical post-change verification loop in one call: wait for compilation to settle, read
 * new warnings/errors, then (if it compiled cleanly) run tests — returning a single pass/fail
 * verdict. This is what Claude should call after any C# change instead of orchestrating three
 * tools by hand, so a green/red answer costs one round trip. Read-only.
 */

const InputShape = {
  runTests: z.boolean().optional().describe("Run the Test Framework after a clean compile. Default true."),
  testMode: z.enum(["EditMode", "PlayMode"]).optional().describe("Test mode (default EditMode)."),
  testFilter: z.string().optional().describe("Scope tests to a full-name filter."),
  compileTimeoutMs: z.number().int().min(500).max(300_000).optional(),
};

export const unityVerify: ToolDef<typeof InputShape, unknown> = {
  name: "unity_verify",
  description:
    "Runs the canonical edit-loop check after a code change — wait_for_compile → console warnings/errors → (if clean) run_tests — and returns one verdict {pass, compiled, errorCount, problems, tests}. Use this instead of calling the three tools separately. Read-only; honors TEST_FRAMEWORK_MISSING gracefully.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    const wantTests = args.runTests ?? true;
    const warnings: string[] = [];

    const compileEnv = (await unityWaitForCompile.run(
      { timeoutMs: args.compileTimeoutMs },
      ctx
    )) as ToolEnvelope<CompileStatus>;
    if (!compileEnv.ok) {
      // Couldn't even reach compile status (bridge down / reloading) — surface as-is.
      return compileEnv;
    }
    const compile = compileEnv.data;
    const compiled = !compile.hasErrors;

    const problemsEnv = (await unityGetConsoleLogs.run(
      { level: "warning_or_error", limit: 50 },
      ctx
    )) as ToolEnvelope<ConsoleLogsResult>;
    const problems = problemsEnv.ok ? problemsEnv.data.logs : [];
    if (!problemsEnv.ok) warnings.push(`console: ${problemsEnv.error.code}`);

    let tests: unknown = wantTests ? (compiled ? undefined : "skipped (compile failed)") : "skipped (runTests=false)";
    let testsPassed = true;
    if (wantTests && compiled) {
      const testEnv = (await unityRunTests.run(
        { mode: args.testMode ?? "EditMode", filter: args.testFilter },
        ctx
      )) as ToolEnvelope<TestRunStatus>;
      if (testEnv.ok) {
        tests = testEnv.data;
        testsPassed = (testEnv.data.failed ?? 0) === 0 && testEnv.data.state === "completed";
      } else {
        tests = { error: testEnv.error.code, message: testEnv.error.message };
        // Missing framework shouldn't fail the verdict on its own; note it.
        if (testEnv.error.code === "TEST_FRAMEWORK_MISSING") warnings.push("Test Framework not installed; skipped tests.");
        else testsPassed = false;
      }
    }

    const verdict = {
      pass: compiled && testsPassed,
      compiled,
      errorCount: compile.errorCount,
      warningCount: compile.warningCount,
      problems,
      tests,
    };
    if (!verdict.pass) warnings.push(compiled ? "Tests did not pass." : `Compile failed with ${compile.errorCount} error(s).`);

    return ok(verdict, { source: ctx.bridge.source, durationMs: 0 }, warnings);
  },
};
