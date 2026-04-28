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

        public static object Dispatch(string method, IDictionary<string, object> p)
        {
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
