import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP prompts. Claude Code surfaces each of these as a slash command
 * (/mcp__unity-vibe-os__<name>) the user can trigger to kick off a Unity workflow. They expand to a
 * user message that drives the unity_* tools — packaging the canonical loops from CLAUDE.md so the
 * user doesn't have to remember which tools to chain. (Other MCP clients ignore prompts, which is
 * why CoplayDev — being client-agnostic — doesn't ship them; for a Claude-Code-only tool they're
 * free UX.)
 */
export interface UnityPrompt {
  name: string;
  config: { title: string; description: string; argsSchema?: Record<string, z.ZodType> };
  build: (args: Record<string, string>) => string;
}

export const UNITY_PROMPTS: UnityPrompt[] = [
  {
    name: "orient",
    config: { title: "Orient in the Unity project", description: "Summarize the current Unity project state in one pass." },
    build: () =>
      "Call `unity_orient` and give me a concise status of the Unity project: open scenes and which is active, the current selection, compile status (with any errors), recent warnings/errors, git status, and how stale the project brain is. Flag anything that looks broken.",
  },
  {
    name: "diagnose_scene",
    config: { title: "Diagnose a broken scene/prefab", description: "Find missing scripts and dangling references and explain how to fix them." },
    build: () =>
      "Diagnose why the current scene/prefab might be broken. Run `unity_find_missing_scripts` and `unity_find_missing_references`, then summarize each missing script and dangling reference (object path, component, field) and the most likely fix. Use `unity_find_references`/`unity_find_dependencies` to trace anything before suggesting a rename or delete. Don't change anything yet — just report.",
  },
  {
    name: "verify",
    config: { title: "Verify the latest changes", description: "Run the compile → console → tests verdict." },
    build: () =>
      "Run `unity_verify` and report a single pass/fail verdict: whether it compiled, any new console errors, and the test results (name + status for failures). If it failed, point at the specific file/line and propose the fix.",
  },
  {
    name: "new_script",
    config: {
      title: "Create a new C# script",
      description: "Scaffold a verified C# script with API checks.",
      argsSchema: { name: z.string().describe("Class/file name, e.g. EnemyController"), description: z.string().describe("What the script should do") },
    },
    build: (a) =>
      `Create a new C# script named "${a.name || "NewBehaviour"}" that does the following: ${a.description || "(describe the behaviour)"}.\n` +
      "Before writing, use `unity_reflect` to confirm any Unity/package APIs you rely on actually exist with the signatures you expect. Then `unity_create_script` under an appropriate Assets/ path, and finish with `unity_verify` to confirm it compiles and tests pass. If anything fails to compile, fix it and re-verify.",
  },
  {
    name: "play_test",
    config: { title: "Play-test the game", description: "Enter play mode, observe, and exit cleanly." },
    build: () =>
      "Play-test the current scene: `unity_enter_play_mode`, then observe with `unity_get_console_logs`, `unity_find_runtime_objects`/`unity_inspect_runtime_object`, `unity_capture_game_view`, and `unity_get_performance_stats`. Use `unity_simulate_input` to exercise controls and `unity_step_frame` to advance deterministically if needed. Summarize what happened (errors, FPS/draw calls, anything off), then `unity_exit_play_mode`.",
  },
  {
    name: "enable_autonomy",
    config: { title: "Enable write access", description: "Explain how to let Claude apply changes." },
    build: () =>
      "Writes are gated by safetyMode. If you need me to apply changes (scene/prefab/asset/script edits), tell me to run `uvibe autonomy on` (autopilot + writes + autoSnapshot; every scene/prefab change is Undo-wrapped and all writes are action-logged). `unity_execute_code` stays off unless `allowCodeExecution` is enabled separately. Do not edit `.unity-vibe/config.json` by hand — use the CLI. Confirm the current posture with `uvibe autonomy status`.",
  },
];

export function registerPrompts(server: McpServer): void {
  for (const p of UNITY_PROMPTS) {
    server.registerPrompt(
      p.name,
      p.config as { title: string; description: string; argsSchema?: Record<string, z.ZodType> & Record<string, z.ZodTypeAny> },
      ((args: Record<string, string> = {}) => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: p.build(args) } }],
      })) as never
    );
  }
}
