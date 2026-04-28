# MCP tools

All tools return a `ToolEnvelope`. Success:

```json
{ "ok": true, "data": {...}, "warnings": [],
  "meta": { "source": "unity_bridge|mock|git|project_brain|filesystem",
            "durationMs": 0, "detailLevel": "summary|normal|full" } }
```

Failure:

```json
{ "ok": false,
  "error": { "code": "STABLE_CODE", "message": "...", "recoverable": true, "suggestedAction": "..." },
  "meta": { ... } }
```

Stable error codes: `UNITY_NOT_CONNECTED`, `UNITY_COMPILING`, `OBJECT_NOT_FOUND`, `ASSET_NOT_FOUND`, `INVALID_ARGUMENT`, `SAFETY_MODE_BLOCKED`, `WRITE_REQUIRES_SNAPSHOT`, `UNSUPPORTED_UNITY_VERSION`, `INTERNAL_ERROR`, `MOCK_MODE_ACTIVE`, `BRIDGE_TIMEOUT`, `MALFORMED_BRIDGE_RESPONSE`, `TOOL_NOT_IMPLEMENTED`, `PROJECT_NOT_FOUND`, `GIT_NOT_AVAILABLE`.

## Implemented (MVP, 11 tools)

| Tool | Source | Notes |
|---|---|---|
| `unity_project_summary` | `unity_bridge` | Unity version, render pipeline, input system, build target, packages |
| `unity_get_open_scenes` | `unity_bridge` | Per-scene path/name/dirty/loaded/buildIndex; activeScene |
| `unity_get_scene_hierarchy` | `unity_bridge` | Tree of `{name,path,active,childCount,components?,children?}` |
| `unity_inspect_selected` | `unity_bridge` | Full inspector view of `Selection.activeGameObject` including serialized fields |
| `unity_get_console_logs` | `unity_bridge` | Logs captured since package load (Application.logMessageReceivedThreaded) |
| `unity_wait_for_compile` | `unity_bridge` | Polls compile.status until idle or timeout |
| `unity_check_git_status` | `git` | Runs `git status --porcelain=v2` in the project dir |
| `unity_generate_project_brain` | `project_brain` | Filesystem scan + writes 5 brain files |
| `unity_capture_game_view` | `unity_bridge` | Renders `Camera.main` (or specified) off-screen. Returns multimodal **image** content + base64 PNG. Auto-saves to `.unity-vibe/screenshots/`. |
| `unity_capture_scene_view` | `unity_bridge` | Renders `SceneView.lastActiveSceneView` camera. Multimodal image. |
| `unity_capture_selected` | `unity_bridge` | Spawns a temporary HideAndDontSave camera framing the selection's bounds; falls back to `AssetPreview` for prefab assets. Multimodal image. |

Screenshot tools return `{source, width, height, mimeType, pngBase64, savedTo?, cameraName?, subject?}`. The MCP server detects `pngBase64` and emits an `image` content block alongside the JSON envelope so Claude sees the actual pixels — not just a data URL string.

Every tool supports a `detailLevel` input of `summary | normal | full` (default `normal`). The hierarchy tool also accepts `maxDepth` and `includeComponents`.

## Bridge methods (server-internal)

| Method | Purpose |
|---|---|
| `system.health` | Liveness probe |
| `system.summary` | Project metadata |
| `scene.getOpenScenes` | Open scenes list |
| `scene.getHierarchy` | Hierarchy tree |
| `selection.inspect` | Active selection |
| `console.getLogs` | Console buffer |
| `compile.status` | Compile state |
| `screenshot.gameView` | Render Camera.main / specified Camera as PNG |
| `screenshot.sceneView` | Render the active SceneView camera as PNG |
| `screenshot.selected` | Render the active selection from a temp camera |

`console.clear` is reserved for a future post-MVP `unity_clear_console` tool but isn't routed yet.

## Planned (post-MVP)

These are designed but not yet exposed. They follow the same envelope.

**Core context:** `unity_project_brain`, `unity_get_conventions`, `unity_update_conventions`, `unity_get_recent_changes`, `unity_get_current_task_context`.

**Scene:** `unity_list_scenes`, `unity_open_scene`, `unity_inspect_gameobject`, `unity_find_objects`, `unity_find_objects_with_component`, `unity_find_objects_missing_component`, `unity_diagnose_scene`.

**Asset:** `unity_find_asset`, `unity_inspect_asset`, `unity_find_references`, `unity_find_dependencies`, `unity_list_scriptable_objects`, `unity_inspect_scriptable_object`, `unity_find_missing_references`, `unity_find_missing_scripts`, `unity_find_duplicate_assets`, `unity_find_probably_unused_assets`.

**Prefab:** `unity_inspect_prefab`, `unity_find_prefabs_with_component`, `unity_find_prefabs_using_script`, `unity_compare_prefab_instance`, `unity_get_prefab_overrides`, `unity_diagnose_prefab`.

**Console/compile/test/build:** `unity_clear_console`, `unity_get_compile_errors`, `unity_run_editmode_tests`, `unity_run_playmode_tests`, `unity_run_specific_test`, `unity_get_build_settings`, `unity_build_player`, `unity_get_build_errors`.

**Runtime:** `unity_enter_play_mode`, `unity_exit_play_mode`, `unity_pause_play_mode`, `unity_step_frame`, `unity_find_runtime_objects`, `unity_inspect_runtime_object`, `unity_watch_value`, `unity_get_runtime_snapshot`, `unity_simulate_input`.

**Visual:** `unity_capture_prefab_preview`, `unity_capture_ui_canvas` (the first three game/scene/selected captures are implemented above).

**Edit (gated by safety):** `unity_create_gameobject`, `unity_add_component`, `unity_set_serialized_field`, `unity_assign_reference`, `unity_create_scriptable_object`, `unity_create_material`, `unity_instantiate_prefab`, `unity_create_prefab_variant`, `unity_wire_ui_button`, `unity_save_scene`.

**Safety:** `unity_create_snapshot`, `unity_list_snapshots`, `unity_restore_snapshot`, `unity_list_ai_actions`, `unity_revert_last_action`, `unity_show_pending_changes`, `unity_set_safety_mode`.

**Diagnostic:** `unity_diagnose_null_reference`, `unity_diagnose_input_problem`, `unity_diagnose_ui_problem`, `unity_diagnose_physics_problem`, `unity_diagnose_build_failure`, `unity_diagnose_performance_spike`, `unity_map_game_system`.

**Workflows:** `unity_create_weapon_workflow`, `unity_create_enemy_workflow`, `unity_create_ui_screen_workflow`, `unity_create_test_scene_workflow`, `unity_add_gameplay_feature_workflow`.

The MVP intentionally ships only the eight tools that compose into a useful Claude session. More breadth without depth would just create raw API soup.
