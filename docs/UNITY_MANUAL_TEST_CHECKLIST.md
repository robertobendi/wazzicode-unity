# Unity manual test checklist

Unity Vibe OS's Unity Editor package (`unity/UnityVibeOS/`) **cannot be run from this build environment** (no Unity Editor available). The package is written against documented Unity Editor APIs and standard idioms, but until it has been installed in a real Unity project, runtime behavior is unverified.

This checklist enumerates every assertion that should be hand-verified inside Unity before claiming the bridge is fully working.

## Prerequisites

- Unity 2021.3 LTS or newer (URP, HDRP, or Built-in pipeline).
- A test Unity project with at least one scene and one prefab.
- The `UnityVibeOS` package installed (see `unity/UnityVibeOS/README.md`).

## 1. Package installs cleanly

- [ ] Open the project. No compile errors in the Console after the package compiles.
- [ ] `Window → Unity Vibe OS → Status` opens a dialog with port, uptime, buffer size, compile state.

## 2. Bridge auto-starts

- [ ] Console shows `[UnityVibeOS] bridge listening on http://127.0.0.1:38578/`.
- [ ] `curl http://127.0.0.1:38578/health` returns `{"status":"ok",...}` JSON.
- [ ] `uvibe doctor` (from outside Unity) reports `Unity bridge: ✓`.

## 3. `system.summary` / `unity_project_summary`

- [ ] `unity_project_summary` returns the project's real Unity version, render pipeline, input system, build target, and at least one package.

## 4. `scene.getOpenScenes` / `unity_get_open_scenes`

- [ ] With one scene loaded: response contains exactly one entry, correct path/name, `isLoaded:true`.
- [ ] After `Ctrl/Cmd-S` (no changes): `isDirty:false`. After modifying a transform without saving: `isDirty:true`.
- [ ] Open a second scene additively: response now contains two entries; `activeScene` reflects current active.

## 5. `scene.getHierarchy` / `unity_get_scene_hierarchy`

- [ ] In a scene with `/Main Camera` and `/Directional Light`: response includes both as roots, with `Camera` and `Light` in their `components` arrays.
- [ ] Add a nested object `/Gameplay/Player`: response shows `Gameplay` with `children: [{name: "Player", path: "/Gameplay/Player", ...}]`.
- [ ] `maxDepth=1` returns roots only with no children.
- [ ] `includeComponents=false` omits the components array.

## 6. `selection.inspect` / `unity_inspect_selected`

- [ ] No selection → `{ hasSelection: false }`.
- [ ] Select an object → `selected.path` matches the hierarchy path; `transform`, `components`, `tag`, `layer`, `prefab`, and serialized `fields` are populated.
- [ ] On a prefab instance → `prefab.isPrefabInstance: true`, `prefab.sourcePath` is the asset path.
- [ ] Add a `Missing Script` component → `components` includes one with `isMissingScript: true` and `warnings` mentions the missing slot.
- [ ] On a MonoBehaviour with serialized fields (int, float, string, Vector3, ObjectReference) → all values appear under `fields` with correct types.
- [ ] On a null `Transform` reference field → field value is `null`.
- [ ] On an assigned-then-deleted reference (still has fileId) → `{ referenceType: "Missing", name: null }`.

## 7. `console.getLogs` / `unity_get_console_logs`

- [ ] Emit `Debug.Log("hi")` from a MonoBehaviour after the package has loaded → response includes the log.
- [ ] Emit `Debug.LogWarning` / `Debug.LogError` → both appear with correct `type`.
- [ ] Logs emitted **before** the package loaded are **not** retained. (Documented limitation.)
- [ ] `level=warning_or_error` excludes plain logs.
- [ ] `limit=10` returns at most 10 entries.

## 8. `compile.status` / `unity_wait_for_compile`

- [ ] During an active recompile (introduce a deliberate edit) → `isCompiling: true`.
- [ ] After compile finishes with no errors → `isCompiling: false, hasErrors: false, errorCount: 0`.
- [ ] Introduce a syntax error → `errorCount >= 1`, `errors[]` includes the file/line/message.
- [ ] `unity_wait_for_compile` polls and returns when `isCompiling` flips to `false`.

## 9. Screenshots

- [ ] `unity_capture_game_view` returns a PNG that matches what would render through `Camera.main` at the requested size (default 1280×720).
- [ ] Open a saved PNG from `.unity-vibe/screenshots/` — colors, geometry, lighting all look correct.
- [ ] If no `Camera.main` and no other active Camera exist, `unity_capture_game_view` returns `OBJECT_NOT_FOUND` with a useful suggestion.
- [ ] Pass `cameraPath: "/SecondaryCam"` — that camera renders, not Main.
- [ ] `unity_capture_scene_view` matches the visible Scene view (camera angle, gizmos visibility per Unity's editor settings).
- [ ] With no SceneView open, the call returns `OBJECT_NOT_FOUND`.
- [ ] Select a prefab asset in the Project pane → `unity_capture_selected` returns the AssetPreview thumbnail (square, dark background).
- [ ] Select a runtime GameObject with renderers → response is a 3/4 angle render framing the bounds. No leftover `__UVibeCaptureCam__` remains in the hierarchy after the call (`HideAndDontSave` + `DestroyImmediate`).
- [ ] In Claude Code, after a screenshot tool call, the chat shows the image inline (multimodal content block) — not just a JSON blob.

## 10. Threading & lifecycle

- [ ] Issue 50 rapid `unity_get_open_scenes` calls. None hangs; Editor remains responsive.
- [ ] Trigger an assembly reload (e.g. modify a script). Bridge stops cleanly, then auto-starts again.
- [ ] Quit the Editor. No port remains bound (`lsof -i:38578` returns nothing).
- [ ] `Window → Unity Vibe OS → Restart Bridge` reopens the port without errors.

## 11. Failure paths

- [ ] Send a malformed JSON request → response is `{ok:false, error:{code:"MALFORMED_BRIDGE_RESPONSE"}}`.
- [ ] Send `{"id":"x","version":"1.0","method":"unknown"}` → `error.code: "INVALID_ARGUMENT"`.
- [ ] Hold the main thread artificially > 15s (debugger pause) → bridge returns `BRIDGE_TIMEOUT`.

## 12. End-to-end through Claude Code

- [ ] Configure Claude Code with the `mcp-config` snippet.
- [ ] In a fresh Claude Code session: `/mcp` shows `unity-vibe-os` as connected.
- [ ] Ask Claude "what is selected in Unity?" → it calls `unity_inspect_selected` and reports the right object.
- [ ] Ask Claude "are there any compile errors?" → it calls `unity_wait_for_compile` then `unity_get_console_logs`.
- [ ] Ask Claude "show me the game view" → it calls `unity_capture_game_view` and the rendered frame appears inline in chat.

## What is NOT verified by this checklist

- Play-mode tools (not implemented).
- Write tools (intentionally not exposed).
- Tests on Windows (the package is platform-agnostic but cross-OS HttpListener behavior should be re-verified on Windows specifically).
