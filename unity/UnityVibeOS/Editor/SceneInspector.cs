using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityVibeOS
{
    public static class SceneInspector
    {
        public static IDictionary<string, object> GetOpenScenes()
        {
            var scenes = new List<object>();
            string activePath = null;
            int count = SceneManager.sceneCount;
            for (int i = 0; i < count; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                scenes.Add(new Dictionary<string, object>
                {
                    { "path", s.path ?? "" },
                    { "name", s.name ?? "" },
                    { "isLoaded", s.isLoaded },
                    { "isDirty", s.isDirty },
                    { "rootCount", s.isLoaded ? s.rootCount : 0 },
                    { "buildIndex", s.buildIndex }
                });
            }
            var active = SceneManager.GetActiveScene();
            if (active.IsValid()) activePath = active.path;
            return new Dictionary<string, object>
            {
                { "scenes", scenes },
                { "activeScene", activePath ?? "" }
            };
        }

        public static IDictionary<string, object> GetHierarchy(string scenePath, int maxDepth, bool includeComponents)
        {
            Scene target = default;
            int count = SceneManager.sceneCount;
            for (int i = 0; i < count; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                if (string.IsNullOrEmpty(scenePath) ? i == 0 : s.path == scenePath)
                {
                    target = s;
                    break;
                }
            }
            if (string.IsNullOrEmpty(scenePath))
            {
                target = SceneManager.GetActiveScene();
            }

            if (!target.IsValid())
            {
                return new Dictionary<string, object>
                {
                    { "scene", scenePath ?? "" },
                    { "roots", new List<object>() },
                    { "totalObjects", 0 }
                };
            }

            var roots = new List<object>();
            int total = 0;
            foreach (var root in target.GetRootGameObjects())
            {
                roots.Add(BuildNode(root.transform, 0, maxDepth, includeComponents, ref total));
            }
            return new Dictionary<string, object>
            {
                { "scene", target.path },
                { "roots", roots },
                { "totalObjects", total }
            };
        }

        static IDictionary<string, object> BuildNode(Transform t, int depth, int maxDepth, bool includeComponents, ref int total)
        {
            total++;
            var go = t.gameObject;
            var node = new Dictionary<string, object>
            {
                { "name", go.name },
                { "path", PathOf(go) },
                { "active", go.activeInHierarchy },
                { "childCount", t.childCount }
            };
            if (includeComponents)
            {
                var components = new List<object>();
                foreach (var comp in go.GetComponents<Component>())
                {
                    components.Add(comp == null ? "<MissingScript>" : comp.GetType().Name);
                }
                node["components"] = components;
            }
            if (depth < maxDepth && t.childCount > 0)
            {
                var children = new List<object>();
                for (int i = 0; i < t.childCount; i++)
                {
                    children.Add(BuildNode(t.GetChild(i), depth + 1, maxDepth, includeComponents, ref total));
                }
                node["children"] = children;
            }
            return node;
        }

        public static string PathOf(GameObject go)
        {
            if (go == null) return "";
            var sb = new System.Text.StringBuilder("/" + go.name);
            var t = go.transform.parent;
            while (t != null)
            {
                sb.Insert(0, "/" + t.name);
                t = t.parent;
            }
            return sb.ToString();
        }
    }
}
