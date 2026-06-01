using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Write operations that create assets (ScriptableObjects, materials, prefab variants) or
    /// instantiate prefabs into the scene. Asset creations are persisted immediately; scene
    /// instantiations are Undo-wrapped and mark the scene dirty. Gated by safetyMode at the MCP
    /// layer (asset target needs confirm/autopilot; prefab target also needs allowPrefabWrites).
    /// </summary>
    public static class AssetMutators
    {
        public static IDictionary<string, object> InstantiatePrefab(IDictionary<string, object> p)
        {
            string prefabPath = ResolveAssetPath(p, "prefabPath", "prefabGuid");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null) throw new BridgeRouter.HandlerError("ASSET_NOT_FOUND", $"No prefab at '{prefabPath}'.");

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            if (instance == null) throw new BridgeRouter.HandlerError("INTERNAL_ERROR", "InstantiatePrefab returned null.");

            string name = Str(p, "name");
            if (!string.IsNullOrEmpty(name)) instance.name = name;

            string parentPath = Str(p, "parentPath");
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = FindByPath(parentPath);
                if (parent == null)
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                    throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Parent '{parentPath}' not found.");
                }
                instance.transform.SetParent(parent.transform, false);
            }

            Undo.RegisterCreatedObjectUndo(instance, $"UnityVibeOS instantiate {prefab.name}");
            string dirtied = null;
            if (instance.scene.IsValid())
            {
                UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(instance.scene);
                dirtied = instance.scene.path;
            }
            return new Dictionary<string, object>
            {
                { "applied", true },
                { "summary", $"Instantiated prefab '{prefab.name}' into the scene" },
                { "createdPath", SceneInspector.PathOf(instance) },
                { "sceneDirtied", dirtied },
                { "undoable", true }
            };
        }

        public static IDictionary<string, object> CreateScriptableObject(IDictionary<string, object> p)
        {
            string typeName = Str(p, "type");
            if (string.IsNullOrEmpty(typeName)) throw Invalid("Missing 'type' (ScriptableObject type name).");
            string path = RequireWritablePath(p, ".asset");

            Type type = null;
            foreach (var t in TypeCache.GetTypesDerivedFrom<ScriptableObject>())
            {
                if (t.Name == typeName || t.FullName == typeName) { type = t; break; }
            }
            if (type == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"ScriptableObject type '{typeName}' not found.");

            var so = ScriptableObject.CreateInstance(type);
            string unique = AssetDatabase.GenerateUniqueAssetPath(path);
            AssetDatabase.CreateAsset(so, unique);
            AssetDatabase.SaveAssets();
            return CreatedAsset($"Created {typeName} asset", unique);
        }

        public static IDictionary<string, object> CreateMaterial(IDictionary<string, object> p)
        {
            string path = RequireWritablePath(p, ".mat");
            string shaderName = Str(p, "shader");
            Shader shader = !string.IsNullOrEmpty(shaderName) ? Shader.Find(shaderName) : null;
            if (shader == null)
            {
                // Pick a sensible default for the active pipeline.
                shader = Shader.Find("Universal Render Pipeline/Lit")
                         ?? Shader.Find("HDRP/Lit")
                         ?? Shader.Find("Standard");
            }
            if (shader == null) throw new BridgeRouter.HandlerError("FEATURE_UNAVAILABLE", "Could not find a default shader to create the material.");

            var mat = new Material(shader);
            string unique = AssetDatabase.GenerateUniqueAssetPath(path);
            AssetDatabase.CreateAsset(mat, unique);
            AssetDatabase.SaveAssets();
            return CreatedAsset($"Created material with shader '{shader.name}'", unique);
        }

        public static IDictionary<string, object> CreatePrefabVariant(IDictionary<string, object> p)
        {
            string sourcePath = ResolveAssetPath(p, "sourcePath", "sourceGuid");
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePath);
            if (source == null) throw new BridgeRouter.HandlerError("ASSET_NOT_FOUND", $"No prefab at '{sourcePath}'.");
            string path = RequireWritablePath(p, ".prefab");
            string unique = AssetDatabase.GenerateUniqueAssetPath(path);

            // Instantiate the base prefab, then save the instance as a new asset: because the
            // instance is a prefab instance, SaveAsPrefabAsset produces a variant of the source.
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source);
            try
            {
                var variant = PrefabUtility.SaveAsPrefabAsset(instance, unique, out bool success);
                if (!success || variant == null)
                    throw new BridgeRouter.HandlerError("INTERNAL_ERROR", $"Failed to save prefab variant at '{unique}'.");
                return CreatedAsset($"Created prefab variant of '{source.name}'", unique);
            }
            finally
            {
                if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        // ---- helpers ----

        static IDictionary<string, object> CreatedAsset(string summary, string path)
        {
            return new Dictionary<string, object>
            {
                { "applied", true },
                { "summary", $"{summary} at {path}" },
                { "createdPath", path },
                { "undoable", false }
            };
        }

        static string ResolveAssetPath(IDictionary<string, object> p, string pathKey, string guidKey)
        {
            string path = Str(p, pathKey);
            string guid = Str(p, guidKey);
            if (string.IsNullOrEmpty(path) && !string.IsNullOrEmpty(guid)) path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) throw Invalid($"Missing '{pathKey}' (or '{guidKey}').");
            return path;
        }

        static string RequireWritablePath(IDictionary<string, object> p, string requiredExt)
        {
            string path = Str(p, "path");
            if (string.IsNullOrEmpty(path)) throw Invalid("Missing 'path' (project-relative, under Assets/).");
            path = path.Replace('\\', '/');
            if (!path.StartsWith("Assets/")) throw Invalid("'path' must be under Assets/.");
            if (!path.EndsWith(requiredExt, StringComparison.OrdinalIgnoreCase))
                throw Invalid($"'path' must end with {requiredExt}.");
            EnsureFolder(Path.GetDirectoryName(path).Replace('\\', '/'));
            return path;
        }

        static void EnsureFolder(string folder)
        {
            if (string.IsNullOrEmpty(folder) || folder == "Assets") return;
            if (AssetDatabase.IsValidFolder(folder)) return;
            string parent = Path.GetDirectoryName(folder).Replace('\\', '/');
            string leaf = Path.GetFileName(folder);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, leaf);
        }

        static GameObject FindByPath(string path)
        {
            foreach (var go in Resources.FindObjectsOfTypeAll<GameObject>())
            {
                if (go == null || !go.scene.IsValid()) continue;
                if ((go.hideFlags & HideFlags.HideAndDontSave) != 0) continue;
                if (SceneInspector.PathOf(go) == path) return go;
            }
            return null;
        }

        static string Str(IDictionary<string, object> p, string key)
            => p != null && p.TryGetValue(key, out var v) && v != null ? v.ToString() : null;

        static BridgeRouter.HandlerError Invalid(string msg) => new BridgeRouter.HandlerError("INVALID_ARGUMENT", msg);
    }
}
