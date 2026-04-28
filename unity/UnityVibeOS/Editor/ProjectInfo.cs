using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    public static class ProjectInfo
    {
        public static string UnityVersion => Application.unityVersion;

        /// <summary>
        /// Project path = parent of the Assets folder.
        /// </summary>
        public static string ProjectPath
        {
            get
            {
                var dataPath = Application.dataPath;
                if (string.IsNullOrEmpty(dataPath)) return "";
                return Path.GetFullPath(Path.Combine(dataPath, ".."));
            }
        }

        public static IDictionary<string, object> GetSummary()
        {
            var packages = new List<object>();
            var manifestPath = Path.Combine(ProjectPath, "Packages", "manifest.json");
            if (File.Exists(manifestPath))
            {
                try
                {
                    var raw = File.ReadAllText(manifestPath);
                    if (MiniJson.Deserialize(raw) is Dictionary<string, object> root
                        && root.TryGetValue("dependencies", out var depObj)
                        && depObj is Dictionary<string, object> deps)
                    {
                        foreach (var kv in deps)
                        {
                            packages.Add(new Dictionary<string, object>
                            {
                                { "name", kv.Key },
                                { "version", kv.Value?.ToString() ?? "" }
                            });
                        }
                    }
                }
                catch { /* tolerated */ }
            }

            string renderPipeline = "Built-in";
            if (UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null)
            {
                renderPipeline = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline.GetType().Name;
            }

            string inputSystem = "Legacy InputManager";
#if ENABLE_INPUT_SYSTEM
            inputSystem = "InputSystem";
#endif

            string scriptingBackend = "Mono";
#if ENABLE_IL2CPP
            scriptingBackend = "IL2CPP";
#endif

            var dict = new Dictionary<string, object>
            {
                { "unityVersion", UnityVersion },
                { "projectPath", ProjectPath },
                { "productName", PlayerSettings.productName },
                { "companyName", PlayerSettings.companyName },
                { "bundleIdentifier", Application.identifier },
                { "renderPipeline", renderPipeline },
                { "inputSystem", inputSystem },
                { "scriptingBackend", scriptingBackend },
                { "buildTarget", EditorUserBuildSettings.activeBuildTarget.ToString() },
                { "packages", packages }
            };
            return dict;
        }
    }
}
