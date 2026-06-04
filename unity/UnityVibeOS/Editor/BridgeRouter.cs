using System;
using System.Collections.Generic;

namespace UnityVibeOS
{
    /// <summary>
    /// Maps protocol method names to handlers that run on the Unity main thread.
    /// Each handler returns the `result` payload (a Dictionary&lt;string, object&gt; or list).
    /// Errors are propagated as exceptions; the caller wraps them into the bridge envelope.
    /// </summary>
    public static class BridgeRouter
    {
        public sealed class HandlerError : Exception
        {
            public string Code { get; }
            public IDictionary<string, object> Details { get; }
            public HandlerError(string code, string message, IDictionary<string, object> details = null) : base(message)
            {
                Code = code;
                Details = details;
            }
        }

        /// <summary>
        /// Dynamic handler table for optional modules (e.g. the Test Framework integration)
        /// that live in a separate assembly which may not be compiled in every project.
        /// They self-register on load via <see cref="Register"/>; Dispatch checks this first.
        /// </summary>
        static readonly Dictionary<string, Func<IDictionary<string, object>, object>> Dynamic =
            new Dictionary<string, Func<IDictionary<string, object>, object>>();

        public static void Register(string method, Func<IDictionary<string, object>, object> handler)
        {
            if (string.IsNullOrEmpty(method) || handler == null) return;
            Dynamic[method] = handler;
        }

        public static object Dispatch(string method, IDictionary<string, object> p)
        {
            if (Dynamic.TryGetValue(method, out var dyn))
            {
                return dyn(p ?? new Dictionary<string, object>());
            }
            switch (method)
            {
                case "system.health":
                    return new Dictionary<string, object>
                    {
                        { "status", "ok" },
                        { "uptimeMs", BridgeServer.UptimeMs }
                    };
                case "system.summary":
                    return ProjectInfo.GetSummary();
                case "scene.getOpenScenes":
                    return SceneInspector.GetOpenScenes();
                case "scene.getHierarchy":
                {
                    string scenePath = GetString(p, "scenePath", null);
                    int maxDepth = GetInt(p, "maxDepth", 32);
                    bool includeComponents = GetBool(p, "includeComponents", true);
                    return SceneInspector.GetHierarchy(scenePath, maxDepth, includeComponents);
                }
                case "selection.inspect":
                {
                    bool includeFields = GetBool(p, "includeFields", true);
                    return SelectionInspector.Inspect(includeFields);
                }
                case "console.getLogs":
                {
                    string level = GetString(p, "level", "all");
                    int limit = GetInt(p, "limit", 200);
                    long? since = null;
                    if (p != null && p.TryGetValue("sinceTimestamp", out var st) && st != null)
                    {
                        if (st is long lv) since = lv;
                        else if (st is int iv) since = iv;
                        else if (st is double dv) since = (long)dv;
                    }
                    var logs = ConsoleCapture.Read(level, limit, since);
                    return new Dictionary<string, object>
                    {
                        { "logs", logs },
                        { "truncated", false },
                        { "bufferSize", ConsoleCapture.BufferSize }
                    };
                }
                case "compile.status":
                    return CompileWatcher.GetStatus();
                case "screenshot.gameView":
                {
                    int width = GetInt(p, "width", 1280);
                    int height = GetInt(p, "height", 720);
                    string cameraPath = GetString(p, "cameraPath", null);
                    return ScreenshotCapture.CaptureGameView(width, height, cameraPath);
                }
                case "screenshot.sceneView":
                {
                    int width = GetInt(p, "width", 1024);
                    int height = GetInt(p, "height", 640);
                    return ScreenshotCapture.CaptureSceneView(width, height);
                }
                case "screenshot.selected":
                {
                    int width = GetInt(p, "width", 768);
                    int height = GetInt(p, "height", 768);
                    float padding = GetFloat(p, "paddingFactor", 3.5f);
                    return ScreenshotCapture.CaptureSelected(width, height, padding);
                }
                case "screenshot.editorWindow":
                {
                    int maxWidth = GetInt(p, "maxWidth", 0);
                    return ScreenshotCapture.CaptureEditorWindow(maxWidth);
                }

                case "perf.sample":
                    return PerformanceProbe.Sample();

                case "playmode.enter":
                    return PlayModeControl.Enter();
                case "playmode.exit":
                    return PlayModeControl.Exit();
                case "playmode.step":
                    return PlayModeControl.Step();
                case "playmode.status":
                    return PlayModeControl.Status();
                case "runtime.findObjects":
                {
                    string query = GetString(p, "query", null);
                    string component = GetString(p, "component", null);
                    int limit = GetInt(p, "limit", 100);
                    bool includeInactive = GetBool(p, "includeInactive", false);
                    return RuntimeInspector.FindObjects(query, component, limit, includeInactive);
                }
                case "runtime.inspect":
                {
                    int instanceId = GetInt(p, "instanceId", 0);
                    string path = GetString(p, "path", null);
                    bool includeFields = GetBool(p, "includeFields", true);
                    return RuntimeInspector.Inspect(instanceId, path, includeFields);
                }

                case "asset.findMissingScripts":
                {
                    int limit = GetInt(p, "limit", 200);
                    return AssetGraph.FindMissingScripts(limit);
                }
                case "asset.findMissingReferences":
                {
                    int limit = GetInt(p, "limit", 200);
                    return AssetGraph.FindMissingReferences(limit);
                }
                case "asset.findReferences":
                {
                    string path = GetString(p, "path", null);
                    int limit = GetInt(p, "limit", 500);
                    return AssetGraph.FindReferences(path, limit);
                }
                case "asset.findDependencies":
                {
                    string path = GetString(p, "path", null);
                    bool recursive = GetBool(p, "recursive", true);
                    int limit = GetInt(p, "limit", 500);
                    return AssetGraph.FindDependencies(path, recursive, limit);
                }

                case "scene.open":
                    return SceneNavigator.OpenScene(p);
                case "scene.loadAdditive":
                    return SceneNavigator.LoadSceneAdditive(p);

                case "prefab.open":
                    return PrefabStageBridge.OpenPrefab(p);
                case "prefab.save":
                    return PrefabStageBridge.SavePrefab(p);
                case "prefab.applyInstance":
                    return PrefabStageBridge.ApplyInstance(p);

                case "input.simulate":
                    return InputSimulator.Simulate(p);
                case "animator.getState":
                    return AnimatorBridge.GetState(p);
                case "animator.setParameter":
                    return AnimatorBridge.SetParameter(p);
                case "animator.editTransition":
                    return AnimatorBridge.EditTransition(p);

                case "editor.executeMenuItem":
                    return MenuBridge.ExecuteMenuItem(p);

                case "script.read":
                    return ScriptEditor.Read(p);
                case "script.getSha":
                    return ScriptEditor.GetSha(p);
                case "script.findInFile":
                    return ScriptEditor.FindInFile(p);
                case "script.create":
                    return ScriptEditor.Create(p);
                case "script.applyEdits":
                    return ScriptEditor.ApplyTextEdits(p);
                case "script.applyStructuredEdits":
                    return ScriptEditor.ApplyStructuredEdits(p);

                case "asset.import":
                    return AssetMutators.ImportAsset(p);
                case "asset.sliceSprite":
                    return AssetMutators.SliceSprite(p);

                case "edit.setSerializedField":
                    return Mutators.SetSerializedField(p);
                case "edit.setTransform":
                    return Mutators.SetTransform(p);
                case "edit.reparent":
                    return Mutators.Reparent(p);
                case "edit.paintTilemap":
                    return TilemapMutators.PaintTilemap(p);
                case "edit.addComponent":
                    return Mutators.AddComponent(p);
                case "edit.createGameObject":
                    return Mutators.CreateGameObject(p);
                case "edit.saveScene":
                    return Mutators.SaveScene(p);
                case "edit.assignReference":
                    return Mutators.AssignReference(p);
                case "edit.wireUiButton":
                    return Mutators.WireUiButton(p);
                case "edit.instantiatePrefab":
                    return AssetMutators.InstantiatePrefab(p);
                case "edit.createScriptableObject":
                    return AssetMutators.CreateScriptableObject(p);
                case "edit.createMaterial":
                    return AssetMutators.CreateMaterial(p);
                case "edit.createPrefabVariant":
                    return AssetMutators.CreatePrefabVariant(p);

                case "console.clear":
                    return ConsoleCapture.Clear();

                default:
                    throw new HandlerError("INVALID_ARGUMENT", $"Unknown method: {method}");
            }
        }

        static string GetString(IDictionary<string, object> p, string key, string def)
        {
            if (p == null || !p.TryGetValue(key, out var v) || v == null) return def;
            return v.ToString();
        }

        static int GetInt(IDictionary<string, object> p, string key, int def)
        {
            if (p == null || !p.TryGetValue(key, out var v) || v == null) return def;
            if (v is int i) return i;
            if (v is long l) return (int)l;
            if (v is double d) return (int)d;
            return def;
        }

        static bool GetBool(IDictionary<string, object> p, string key, bool def)
        {
            if (p == null || !p.TryGetValue(key, out var v) || v == null) return def;
            if (v is bool b) return b;
            return def;
        }

        static float GetFloat(IDictionary<string, object> p, string key, float def)
        {
            if (p == null || !p.TryGetValue(key, out var v) || v == null) return def;
            if (v is float f) return f;
            if (v is double d) return (float)d;
            if (v is int i) return i;
            if (v is long l) return l;
            return def;
        }
    }
}
