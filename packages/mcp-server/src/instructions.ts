/**
 * Server instructions. The MCP protocol delivers this string to the client (Claude Code) on
 * connect, so it is the one place that teaches the agent the toolset and the right workflows
 * *inside the user's Unity project* — where there is no wazzicode CLAUDE.md. Keep it tight: it is
 * sent every session. It is the reason the user can "just write prompts" and trust the agent knows
 * which tools exist and how to chain them.
 */
export const SERVER_INSTRUCTIONS = `Unity Vibe OS — a Unity-aware operating layer. The unity_* tools read and edit the user's OPEN Unity Editor live over a local bridge, so work from real project state, not from guessing at .unity/.prefab YAML.

GOLDEN RULES
1. Start any task with \`unity_orient\` — one call returns the project summary, open scenes, current selection, compile status, recent errors/warnings, git status, and brain freshness. Don't gather those separately.
2. Before writing C# against a Unity/package API, verify it exists with \`unity_reflect\` (it reads the project's actually-loaded assemblies — ground truth over memory). \`unity_docs\` adds prose/usage.
3. After ANY C# change, run \`unity_verify\` (compile → console → tests → one pass/fail verdict). Never claim a change works until it passes.
4. When the user says "this" / "the selected object", call \`unity_inspect_selected\` first.
5. Inspect first, act second, verify after. Prefer a concrete target (named GameObject, file path, instanceId) over guessing.

EDIT C#: \`unity_read_script\` (returns a sha256) → \`unity_create_script\` for new files, \`unity_apply_text_edits\` for exact 1-based line/col ranges, or \`unity_script_edit\` for whole-method/anchor ops. Pass the sha back as preconditionSha256; use preview:true for a diff. Writes recompile — follow with unity_verify.

BUILD SCENES: unity_create_gameobject, unity_add_component, unity_set_serialized_field, unity_assign_reference, unity_set_transform, unity_reparent, unity_instantiate_prefab, unity_save_scene. Every scene/prefab edit is Undo-wrapped (Ctrl+Z). Bundle a known multi-step plan into ONE \`unity_batch\` call.

PLAY-TEST: unity_enter_play_mode → observe with unity_get_console_logs / unity_find_runtime_objects / unity_inspect_runtime_object / unity_get_performance_stats / unity_simulate_input → unity_exit_play_mode. Screenshot tools (unity_capture_game_view, unity_capture_editor_window) return real images — use them to SEE what you built; pass format:"jpg" when capturing repeatedly (≈10x smaller). unity_step_frame steps N frames in one call.

DIAGNOSE: unity_find_missing_scripts, unity_find_missing_references, unity_find_references / unity_find_dependencies before any rename/delete.

SAFETY: scene/prefab/script/asset writes are ON by default (autopilot) — just edit; every write is Undo-wrapped + action-logged. Only two things stay opt-in: menu items (allowMenuItems + allowedMenuItems allowlist) and \`unity_execute_code\` (arbitrary in-Editor C#, in the \`codegen\` group, OFF by default — enable with \`unity_manage_tools\` activate codegen and ask the user to set allowCodeExecution). If a write ever returns SAFETY_MODE_BLOCKED the user locked it down; tell them to run \`uvibe autonomy on\` — do NOT edit .unity-vibe/config.json yourself.

TOOL GROUPS: core/scripting/reflection/runtime/testing are active; codegen is off. \`unity_manage_tools\` lists/toggles them. Big scenes: unity_get_scene_hierarchy is capped (maxNodes) and flags truncated — narrow with scenePath/maxDepth instead of dumping everything.

BRIDGE STATE: UNITY_RELOADING means the Editor is mid script-reload — recoverable, auto-retries, just proceed. UNITY_NOT_CONNECTED means no Editor with this project is open (ask the user to open Unity, then \`uvibe doctor\`).

Slash commands (/mcp__unity-vibe-os__*): orient, diagnose_scene, analyze_scene, verify, new_script, play_test, enable_autonomy. Resources: unity://project-brain, unity://conventions, unity://action-log, unity://scene-hierarchy, unity://console.`;
