using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityVibeOS
{
    /// <summary>
    /// Write operations on scene/GameObject state. Every mutation goes through Unity's Undo
    /// system so the user can Ctrl+Z, and marks the owning scene dirty (the caller decides when
    /// to save). The MCP layer gates these behind safetyMode; the bridge itself trusts the call.
    /// </summary>
    public static class Mutators
    {
        public static IDictionary<string, object> SetSerializedField(IDictionary<string, object> p)
        {
            var go = RequireTarget(p);
            string componentName = Str(p, "component");
            string field = Str(p, "field");
            if (string.IsNullOrEmpty(componentName)) throw Invalid("Missing 'component'.");
            if (string.IsNullOrEmpty(field)) throw Invalid("Missing 'field'.");
            if (!p.TryGetValue("value", out var value)) throw Invalid("Missing 'value'.");

            Component comp = null;
            foreach (var c in go.GetComponents<Component>())
            {
                if (c != null && c.GetType().Name == componentName) { comp = c; break; }
            }
            if (comp == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Component '{componentName}' not found on '{go.name}'.");

            var so = new SerializedObject(comp);
            var prop = so.FindProperty(field);
            if (prop == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Field '{field}' not found on '{componentName}'.");

            Undo.RecordObject(comp, $"UnityVibeOS set {componentName}.{field}");
            SetPropertyValue(prop, value);
            so.ApplyModifiedProperties();
            EditorUtility.SetDirty(comp);
            string dirtied = MarkDirty(go);

            return new Dictionary<string, object>
            {
                { "applied", true },
                { "summary", $"Set {componentName}.{field} on {SceneInspector.PathOf(go)}" },
                { "target", SceneInspector.PathOf(go) },
                { "sceneDirtied", dirtied },
                { "undoable", true }
            };
        }

        public static IDictionary<string, object> AddComponent(IDictionary<string, object> p)
        {
            var go = RequireTarget(p);
            string componentName = Str(p, "component");
            if (string.IsNullOrEmpty(componentName)) throw Invalid("Missing 'component'.");

            Type type = null;
            foreach (var t in TypeCache.GetTypesDerivedFrom<Component>())
            {
                if (t.Name == componentName || t.FullName == componentName) { type = t; break; }
            }
            if (type == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Component type '{componentName}' not found.");

            var added = Undo.AddComponent(go, type);
            string dirtied = MarkDirty(go);
            return new Dictionary<string, object>
            {
                { "applied", added != null },
                { "summary", $"Added {componentName} to {SceneInspector.PathOf(go)}" },
                { "target", SceneInspector.PathOf(go) },
                { "sceneDirtied", dirtied },
                { "undoable", true }
            };
        }

        public static IDictionary<string, object> CreateGameObject(IDictionary<string, object> p)
        {
            string name = Str(p, "name");
            if (string.IsNullOrEmpty(name)) name = "GameObject";
            string primitive = Str(p, "primitive"); // optional: Cube/Sphere/etc.
            string parentPath = Str(p, "parentPath");

            GameObject go;
            if (!string.IsNullOrEmpty(primitive) && Enum.TryParse<PrimitiveType>(primitive, true, out var pt))
            {
                go = GameObject.CreatePrimitive(pt);
                go.name = name;
            }
            else
            {
                go = new GameObject(name);
            }

            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = FindByPath(parentPath);
                if (parent == null)
                {
                    UnityEngine.Object.DestroyImmediate(go);
                    throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Parent '{parentPath}' not found.");
                }
                go.transform.SetParent(parent.transform, false);
            }

            Undo.RegisterCreatedObjectUndo(go, $"UnityVibeOS create {name}");
            string dirtied = MarkDirty(go);
            return new Dictionary<string, object>
            {
                { "applied", true },
                { "summary", $"Created GameObject '{name}'" },
                { "createdPath", SceneInspector.PathOf(go) },
                { "sceneDirtied", dirtied },
                { "undoable", true }
            };
        }

        public static IDictionary<string, object> SaveScene(IDictionary<string, object> p)
        {
            string scenePath = Str(p, "scenePath");
            bool saved;
            string savedPath;
            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                    throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Scene '{scenePath}' is not open.");
                saved = EditorSceneManager.SaveScene(scene);
                savedPath = scene.path;
            }
            else
            {
                var active = SceneManager.GetActiveScene();
                saved = EditorSceneManager.SaveScene(active);
                savedPath = active.path;
            }
            return new Dictionary<string, object>
            {
                { "applied", saved },
                { "summary", saved ? $"Saved scene {savedPath}" : $"Save failed for {savedPath}" },
                { "target", savedPath }
            };
        }

        public static IDictionary<string, object> AssignReference(IDictionary<string, object> p)
        {
            var go = RequireTarget(p);
            string componentName = Str(p, "component");
            string field = Str(p, "field");
            if (string.IsNullOrEmpty(componentName)) throw Invalid("Missing 'component'.");
            if (string.IsNullOrEmpty(field)) throw Invalid("Missing 'field'.");

            var comp = FindComponent(go, componentName);
            var so = new SerializedObject(comp);
            var prop = so.FindProperty(field);
            if (prop == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Field '{field}' not found on '{componentName}'.");
            if (prop.propertyType != SerializedPropertyType.ObjectReference)
                throw Invalid($"Field '{field}' is not an object reference ({prop.propertyType}). Use unity_set_serialized_field for value types.");

            var source = ResolveSource(p);
            Undo.RecordObject(comp, $"UnityVibeOS assign {componentName}.{field}");
            prop.objectReferenceValue = source;
            so.ApplyModifiedProperties();

            // Unity silently drops type-incompatible references; verify with a fresh read.
            var verify = new SerializedObject(comp).FindProperty(field);
            if (source != null && (verify == null || verify.objectReferenceValue == null))
                throw Invalid($"Type mismatch: '{source.GetType().Name}' is not assignable to '{componentName}.{field}'.");

            EditorUtility.SetDirty(comp);
            string dirtied = MarkDirty(go);
            return EditOk(
                $"Assigned {componentName}.{field} = {(source != null ? source.name : "null")} on {SceneInspector.PathOf(go)}",
                SceneInspector.PathOf(go), dirtied);
        }

        public static IDictionary<string, object> WireUiButton(IDictionary<string, object> p)
        {
            var buttonGo = RequireTarget(p);
            // Locate the Button component by full type name so we don't hard-reference UGUI.
            Component button = null;
            foreach (var c in buttonGo.GetComponents<Component>())
            {
                if (c != null && c.GetType().FullName == "UnityEngine.UI.Button") { button = c; break; }
            }
            if (button == null)
                throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND",
                    $"No UnityEngine.UI.Button on '{buttonGo.name}'. Is the UGUI package installed and is this the button object?");

            string method = Str(p, "method");
            if (string.IsNullOrEmpty(method)) throw Invalid("Missing 'method' (the handler method to call).");

            var handler = ResolveHandler(p, buttonGo);
            var methodInfo = handler.GetType().GetMethod(method, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (methodInfo == null || methodInfo.ReturnType != typeof(void))
                throw Invalid($"No public void {method}() on '{handler.GetType().Name}'.");

            var onClick = button.GetType().GetProperty("onClick")?.GetValue(button) as UnityEngine.Events.UnityEvent;
            if (onClick == null)
                throw new BridgeRouter.HandlerError("INTERNAL_ERROR", "Could not access Button.onClick.");

            var action = (UnityEngine.Events.UnityAction)Delegate.CreateDelegate(typeof(UnityEngine.Events.UnityAction), handler, methodInfo);
            Undo.RecordObject(button, $"UnityVibeOS wire Button.onClick -> {method}");
            UnityEditor.Events.UnityEventTools.AddPersistentListener(onClick, action);
            EditorUtility.SetDirty(button);
            string dirtied = MarkDirty(buttonGo);
            return EditOk(
                $"Wired {SceneInspector.PathOf(buttonGo)} Button.onClick -> {handler.GetType().Name}.{method}()",
                SceneInspector.PathOf(buttonGo), dirtied);
        }

        // ---- helpers ----

        static Component FindComponent(GameObject go, string name)
        {
            foreach (var c in go.GetComponents<Component>())
            {
                if (c != null && (c.GetType().Name == name || c.GetType().FullName == name)) return c;
            }
            throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Component '{name}' not found on '{go.name}'.");
        }

        static UnityEngine.Object ResolveSource(IDictionary<string, object> p)
        {
            string assetPath = Str(p, "sourceAssetPath");
            string guid = Str(p, "sourceGuid");
            if (string.IsNullOrEmpty(assetPath) && !string.IsNullOrEmpty(guid)) assetPath = AssetDatabase.GUIDToAssetPath(guid);
            if (!string.IsNullOrEmpty(assetPath))
            {
                var asset = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(assetPath);
                if (asset == null) throw new BridgeRouter.HandlerError("ASSET_NOT_FOUND", $"No asset at '{assetPath}'.");
                return asset;
            }
            int sourceId = Int(p, "sourceInstanceId", 0);
            if (sourceId != 0)
            {
                var obj = EditorCompat.IdToObject(sourceId);
                if (obj == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"No object with instanceId {sourceId}.");
                if (obj is GameObject g) return MaybeComponent(p, g, obj);
                return obj; // a Component or asset reference
            }
            string sourcePath = Str(p, "sourcePath");
            if (!string.IsNullOrEmpty(sourcePath))
            {
                var srcGo = FindByPath(sourcePath);
                if (srcGo == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Scene object '{sourcePath}' not found.");
                return MaybeComponent(p, srcGo, srcGo);
            }
            throw Invalid("No source given. Provide sourceAssetPath/sourceGuid (asset) or sourceInstanceId/sourcePath (scene), optionally sourceComponent.");
        }

        static UnityEngine.Object MaybeComponent(IDictionary<string, object> p, GameObject go, UnityEngine.Object fallback)
        {
            string sourceComponent = Str(p, "sourceComponent");
            return string.IsNullOrEmpty(sourceComponent) ? fallback : (UnityEngine.Object)FindComponent(go, sourceComponent);
        }

        static UnityEngine.Object ResolveHandler(IDictionary<string, object> p, GameObject fallback)
        {
            int id = Int(p, "handlerInstanceId", 0);
            if (id != 0)
            {
                var o = EditorCompat.IdToObject(id);
                if (o is Component) return o;
                if (o is GameObject g) fallback = g;
            }
            string handlerPath = Str(p, "handlerPath");
            GameObject go = !string.IsNullOrEmpty(handlerPath) ? FindByPath(handlerPath) : fallback;
            if (go == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", "Handler object not found.");
            string handlerComponent = Str(p, "handlerComponent");
            if (string.IsNullOrEmpty(handlerComponent))
                throw Invalid("Specify handlerComponent — the component whose method the button should call.");
            return FindComponent(go, handlerComponent);
        }

        static IDictionary<string, object> EditOk(string summary, string target, string dirtied)
        {
            var d = new Dictionary<string, object> { { "applied", true }, { "summary", summary }, { "undoable", true } };
            if (!string.IsNullOrEmpty(target)) d["target"] = target;
            if (!string.IsNullOrEmpty(dirtied)) d["sceneDirtied"] = dirtied;
            return d;
        }

        static GameObject RequireTarget(IDictionary<string, object> p)
        {
            int instanceId = Int(p, "instanceId", 0);
            string path = Str(p, "path");
            GameObject go = null;
            if (instanceId != 0) go = EditorCompat.IdToObject(instanceId) as GameObject;
            if (go == null && !string.IsNullOrEmpty(path)) go = FindByPath(path);
            if (go == null && instanceId == 0 && string.IsNullOrEmpty(path))
            {
                go = Selection.activeGameObject; // fall back to current selection
            }
            if (go == null)
                throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", "Target GameObject not found (provide instanceId or path, or select one).");
            return go;
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

        static string MarkDirty(GameObject go)
        {
            if (go.scene.IsValid())
            {
                EditorSceneManager.MarkSceneDirty(go.scene);
                return go.scene.path;
            }
            return null;
        }

        static void SetPropertyValue(SerializedProperty prop, object value)
        {
            switch (prop.propertyType)
            {
                case SerializedPropertyType.Integer:
                    prop.intValue = (int)Convert.ToInt64(value);
                    break;
                case SerializedPropertyType.Boolean:
                    prop.boolValue = Convert.ToBoolean(value);
                    break;
                case SerializedPropertyType.Float:
                    prop.floatValue = (float)Convert.ToDouble(value);
                    break;
                case SerializedPropertyType.String:
                    prop.stringValue = value?.ToString() ?? "";
                    break;
                case SerializedPropertyType.Enum:
                    if (value is string es)
                    {
                        int idx = Array.IndexOf(prop.enumNames, es);
                        if (idx < 0) throw Invalid($"Enum value '{es}' not valid. Options: {string.Join(",", prop.enumNames)}");
                        prop.enumValueIndex = idx;
                    }
                    else prop.enumValueIndex = (int)Convert.ToInt64(value);
                    break;
                case SerializedPropertyType.Vector2:
                    prop.vector2Value = new Vector2(F(value, "x"), F(value, "y"));
                    break;
                case SerializedPropertyType.Vector3:
                    prop.vector3Value = new Vector3(F(value, "x"), F(value, "y"), F(value, "z"));
                    break;
                case SerializedPropertyType.Vector4:
                    prop.vector4Value = new Vector4(F(value, "x"), F(value, "y"), F(value, "z"), F(value, "w"));
                    break;
                case SerializedPropertyType.Color:
                    prop.colorValue = new Color(F(value, "r"), F(value, "g"), F(value, "b"), HasKey(value, "a") ? F(value, "a") : 1f);
                    break;
                case SerializedPropertyType.ObjectReference:
                    prop.objectReferenceValue = ResolveObjectReference(value);
                    break;
                default:
                    throw Invalid($"Setting fields of type {prop.propertyType} is not supported yet.");
            }
        }

        static UnityEngine.Object ResolveObjectReference(object value)
        {
            if (value == null) return null;
            if (value is Dictionary<string, object> d)
            {
                string path = d.TryGetValue("path", out var pv) ? pv?.ToString() : null;
                string guid = d.TryGetValue("guid", out var gv) ? gv?.ToString() : null;
                if (string.IsNullOrEmpty(path) && !string.IsNullOrEmpty(guid)) path = AssetDatabase.GUIDToAssetPath(guid);
                if (!string.IsNullOrEmpty(path) && path.StartsWith("Assets/"))
                {
                    var asset = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(path);
                    if (asset == null) throw new BridgeRouter.HandlerError("ASSET_NOT_FOUND", $"No asset at '{path}'.");
                    return asset;
                }
                if (!string.IsNullOrEmpty(path))
                {
                    var sceneGo = FindByPath(path);
                    if (sceneGo == null) throw new BridgeRouter.HandlerError("OBJECT_NOT_FOUND", $"Scene object '{path}' not found.");
                    return sceneGo;
                }
            }
            throw Invalid("Object reference must be {path|guid} for an asset, or {path} for a scene object.");
        }

        static bool HasKey(object value, string key) => value is Dictionary<string, object> d && d.ContainsKey(key);

        static float F(object value, string key)
        {
            if (value is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v != null)
                return (float)Convert.ToDouble(v);
            return 0f;
        }

        static string Str(IDictionary<string, object> p, string key)
            => p != null && p.TryGetValue(key, out var v) && v != null ? v.ToString() : null;

        static int Int(IDictionary<string, object> p, string key, int def)
        {
            if (p == null || !p.TryGetValue(key, out var v) || v == null) return def;
            try { return (int)Convert.ToInt64(v); } catch { return def; }
        }

        static BridgeRouter.HandlerError Invalid(string msg) => new BridgeRouter.HandlerError("INVALID_ARGUMENT", msg);
    }
}
