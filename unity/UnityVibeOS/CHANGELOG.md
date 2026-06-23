# Changelog

## Unreleased

- Add `screenshot.editorWindow` method / `unity_capture_editor_window` tool: captures the entire Editor main window (all docked panels) from the OS framebuffer via `InternalEditorUtility.ReadScreenPixel`, with optional `maxWidth` downscale. Distinct from the existing camera-render captures (game/scene/selected).
- Add `AutoSaveGuard`: in autonomous sessions, automatically persists dirty (already-on-disk) scenes just before an assembly/domain reload or entering play mode, so Unity's blocking "Scene(s) have been modified — save before reloading?" modal can never freeze an unattended loop. Gated to `safetyMode: "autopilot"` (or an explicit `"autoSaveBeforeReload": true` in `.unity-vibe/config.json`); interactive read-only/confirm sessions are unaffected, and untitled scenes are skipped to avoid a Save-As dialog.

## 0.1.0 — initial MVP

- Editor-only HTTP JSON-RPC bridge on `127.0.0.1:38578`.
- Methods: `system.health`, `system.summary`, `scene.getOpenScenes`, `scene.getHierarchy`, `selection.inspect`, `console.getLogs`, `compile.status`.
- Console capture via `Application.logMessageReceivedThreaded` (post-load only).
- Compile state via `UnityEditor.Compilation.CompilationPipeline`.
- Read-only. No write methods exposed.
- Menu: `Window → Unity Vibe OS → Status`.
