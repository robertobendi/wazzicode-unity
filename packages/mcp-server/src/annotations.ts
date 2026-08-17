import { AnyToolDef } from "./registry.js";

/**
 * MCP tool annotations, tuned for Claude Code (the only client). Claude Code uses these hints to
 * decide what to surface and what it can run without a permission prompt:
 *   - readOnlyHint: this tool only observes — safe to auto-run.
 *   - destructiveHint: this write is hard to undo (overwrites a file, runs code, clears state).
 *   - idempotentHint: repeating it with the same args changes nothing further.
 *   - openWorldHint: it touches the network / outside world.
 * We derive them from each tool's write/writeTarget plus a few explicit overrides, so adding a tool
 * gets sensible defaults for free.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// Tools that aren't flagged `write` (they don't mutate the *project*) but still change runtime,
// session, or filesystem state — so they are NOT read-only and shouldn't be auto-run silently.
const MUTATING_NON_WRITE = new Set<string>([
  "unity_batch", // can perform any sub-op, including writes
  "unity_generate_project_brain", // writes .unity-vibe/*
  "unity_manage_tools", // changes which tools are exposed this session
  "unity_refresh_assets", // imports externally changed files into the AssetDatabase
  "unity_verify", // refreshes assets and may start compilation/tests
  // Capture tools are deliberately NOT here: they only save under the
  // gitignored .unity-vibe/screenshots scratch dir, and CLAUDE.md promises
  // capture is auto-approvable read-only.
  "unity_run_tests", // changes Test Runner session state
  "unity_open_scene", // changes open Editor content
  "unity_load_scene_additive",
  "unity_open_prefab",
  "unity_simulate_input", // drives runtime input
  "unity_set_animator_parameter", // drives runtime animator
  "unity_enter_play_mode",
  "unity_exit_play_mode",
  "unity_step_frame",
  "unity_configure_play_mode",
  "unity_set_runtime_field",
  "unity_smoke_test",
  "unity_qa",
]);

// Writes that overwrite/erase or run code — hard to undo (no Unity Undo entry). Scene/prefab edits
// are Undo-wrapped and additive, so they are NOT marked destructive — except deletes, which erase
// existing state and warrant an approval prompt even though they're Undo-wrapped.
const DESTRUCTIVE = new Set<string>([
  "unity_create_script",
  "unity_apply_text_edits",
  "unity_script_edit",
  "unity_execute_code",
  "unity_execute_menu_item",
  "unity_clear_console",
  "unity_save_scene",
  "unity_save_prefab",
  "unity_apply_prefab_instance",
  "unity_animator_edit_transition",
  "unity_delete_gameobject",
  "unity_remove_component",
  "unity_delete_asset",
]);

// Repeating with the same args lands on the same state (vs. create/instantiate which add each time).
const IDEMPOTENT = new Set<string>([
  "unity_set_serialized_field",
  "unity_set_transform",
  "unity_assign_reference",
  "unity_save_scene",
  "unity_save_prefab",
  "unity_clear_console",
  "unity_reparent",
]);

const OPEN_WORLD = new Set<string>(["unity_docs"]);

function titleOf(name: string): string {
  return name
    .replace(/^unity_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Read tools whose payload is bounded by the *project*, not by our own caps: a 5000-node
 * hierarchy, a full type dump, a brain query, a console flood. Claude Code reads
 * `anthropic/maxResultSizeChars` off tools/list and truncates the result client-side instead of
 * blowing the context window. Generous on purpose — these tools already page/limit themselves,
 * so the cap is a backstop, not the primary bound.
 */
const MAX_RESULT_SIZE_CHARS = 200_000;
const LARGE_OUTPUT = new Set<string>([
  "unity_get_scene_hierarchy",
  "unity_reflect",
  "unity_query_project_brain",
  "unity_get_console_logs",
]);

/**
 * Arbitrary-execution tools: the argument *is* the program, so no static annotation can bound
 * what they do. `anthropic/requiresUserInteraction` makes Claude Code raise a real permission
 * prompt even in bypass modes. Deliberately just these two — every other write is bounded by its
 * schema and already gated by safetyMode.
 */
const REQUIRES_USER_INTERACTION = new Set<string>(["unity_execute_code", "unity_execute_menu_item"]);

/** `_meta` for a tool's tools/list entry, or undefined when it carries none. */
export function toolMeta(tool: AnyToolDef): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (LARGE_OUTPUT.has(tool.name)) meta["anthropic/maxResultSizeChars"] = MAX_RESULT_SIZE_CHARS;
  if (REQUIRES_USER_INTERACTION.has(tool.name)) meta["anthropic/requiresUserInteraction"] = true;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function toolAnnotations(tool: AnyToolDef): ToolAnnotations {
  const name = tool.name;
  const mutates = tool.write === true || MUTATING_NON_WRITE.has(name);
  const a: ToolAnnotations = {
    title: titleOf(name),
    readOnlyHint: !mutates,
  };
  if (OPEN_WORLD.has(name)) a.openWorldHint = true;
  if (!mutates) return a;
  // Mutating tools: classify how risky / repeatable the change is.
  a.destructiveHint = DESTRUCTIVE.has(name);
  if (IDEMPOTENT.has(name)) a.idempotentHint = true;
  return a;
}
