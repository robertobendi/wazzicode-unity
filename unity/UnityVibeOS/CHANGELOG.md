# Changelog

## 0.1.0 — initial MVP

- Editor-only HTTP JSON-RPC bridge on `127.0.0.1:38578`.
- Methods: `system.health`, `system.summary`, `scene.getOpenScenes`, `scene.getHierarchy`, `selection.inspect`, `console.getLogs`, `compile.status`.
- Console capture via `Application.logMessageReceivedThreaded` (post-load only).
- Compile state via `UnityEditor.Compilation.CompilationPipeline`.
- Read-only. No write methods exposed.
- Menu: `Window → Unity Vibe OS → Status`.
