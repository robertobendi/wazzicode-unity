using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Editor-time screenshot capture.
    /// - Game view: renders the active main camera (or a named camera) off-screen.
    /// - Scene view: renders SceneView.lastActiveSceneView's authoring camera.
    /// - Selected: spawns a temporary HideAndDontSave camera framing the selection's bounds.
    /// All paths return base64-encoded PNG via the bridge envelope.
    /// </summary>
    public static class ScreenshotCapture
    {
        public static IDictionary<string, object> CaptureGameView(int width, int height, string cameraPath)
        {
            Camera cam = ResolveGameCamera(cameraPath);
            if (cam == null)
            {
                throw new BridgeRouter.HandlerError(
                    "OBJECT_NOT_FOUND",
                    "No suitable Camera found. Ensure the active scene contains a Camera (preferably tagged 'MainCamera') or pass cameraPath."
                );
            }
            var png = RenderCameraToPng(cam, width, height);
            return BuildResult("game_view", width, height, png, cam.name, "/" + GetCameraPath(cam));
        }

        public static IDictionary<string, object> CaptureSceneView(int width, int height)
        {
            var sv = SceneView.lastActiveSceneView ?? FirstSceneView();
            if (sv == null)
            {
                throw new BridgeRouter.HandlerError(
                    "OBJECT_NOT_FOUND",
                    "No SceneView is currently open in the editor."
                );
            }
            var cam = sv.camera;
            if (cam == null)
            {
                throw new BridgeRouter.HandlerError(
                    "INTERNAL_ERROR",
                    "SceneView is open but its camera is not initialized. Hover over the scene view first."
                );
            }
            var png = RenderCameraToPng(cam, width, height);
            return BuildResult("scene_view", width, height, png, "SceneView", "SceneView.lastActiveSceneView");
        }

        public static IDictionary<string, object> CaptureSelected(int width, int height, float paddingFactor)
        {
            var sel = Selection.activeGameObject;
            if (sel == null)
            {
                throw new BridgeRouter.HandlerError(
                    "OBJECT_NOT_FOUND",
                    "No GameObject is selected. Select an object in the Hierarchy and retry."
                );
            }

            // Prefab-asset shortcut: AssetPreview is fast and avoids spawning a camera.
            if (PrefabUtility.IsPartOfPrefabAsset(sel))
            {
                var preview = AssetPreview.GetAssetPreview(sel);
                if (preview != null)
                {
                    var pngFromPreview = preview.EncodeToPNG();
                    if (pngFromPreview != null && pngFromPreview.Length > 0)
                    {
                        return BuildResult("selected_object", preview.width, preview.height, pngFromPreview, "AssetPreview", SceneInspector.PathOf(sel));
                    }
                }
            }

            byte[] png = RenderObjectWithTempCamera(sel, width, height, paddingFactor);
            return BuildResult("selected_object", width, height, png, "TempCamera", SceneInspector.PathOf(sel));
        }

        /// <summary>
        /// Captures the entire Unity Editor main window (all docked panels: toolbar, Hierarchy,
        /// Scene/Game view, Inspector, Project, Console) as the OS sees it — not a camera render.
        /// Reads the framebuffer for the main container window via InternalEditorUtility.ReadScreenPixel,
        /// then optionally downscales so the longest side is at most maxWidth (0 = keep native size).
        /// </summary>
        public static IDictionary<string, object> CaptureEditorWindow(int maxWidth)
        {
            Rect r;
            try
            {
                r = EditorGUIUtility.GetMainWindowPosition();
            }
            catch (Exception e)
            {
                throw new BridgeRouter.HandlerError(
                    "INTERNAL_ERROR",
                    "Could not resolve the main editor window rect: " + e.Message
                );
            }
            if (r.width < 1f || r.height < 1f)
            {
                throw new BridgeRouter.HandlerError(
                    "OBJECT_NOT_FOUND",
                    "The Unity Editor main window has no resolvable bounds (is the editor minimized?)."
                );
            }

            // ReadScreenPixel works in real device pixels; GetMainWindowPosition is in points.
            float ppp = Mathf.Max(1f, EditorGUIUtility.pixelsPerPoint);
            int nativeW = Mathf.Max(1, Mathf.RoundToInt(r.width * ppp));
            int nativeH = Mathf.Max(1, Mathf.RoundToInt(r.height * ppp));
            var origin = new Vector2(r.x * ppp, r.y * ppp);

            Color[] pixels;
            try
            {
                pixels = InternalEditorUtility.ReadScreenPixel(origin, nativeW, nativeH);
            }
            catch (Exception e)
            {
                throw new BridgeRouter.HandlerError(
                    "INTERNAL_ERROR",
                    "ReadScreenPixel failed (some platforms/headless modes disallow framebuffer reads): " + e.Message
                );
            }
            if (pixels == null || pixels.Length < nativeW * nativeH)
            {
                throw new BridgeRouter.HandlerError(
                    "INTERNAL_ERROR",
                    "ReadScreenPixel returned no pixels for the editor window."
                );
            }

            var tex = new Texture2D(nativeW, nativeH, TextureFormat.RGB24, false);
            try
            {
                tex.SetPixels(pixels);
                tex.Apply(false, false);

                int outW = nativeW;
                int outH = nativeH;
                byte[] png;
                if (maxWidth > 0 && Mathf.Max(nativeW, nativeH) > maxWidth)
                {
                    float scale = (float)maxWidth / Mathf.Max(nativeW, nativeH);
                    outW = Mathf.Max(1, Mathf.RoundToInt(nativeW * scale));
                    outH = Mathf.Max(1, Mathf.RoundToInt(nativeH * scale));
                    png = DownscaleToPng(tex, outW, outH);
                }
                else
                {
                    png = tex.EncodeToPNG();
                }
                return BuildResult("editor_window", outW, outH, png ?? Array.Empty<byte>(), "EditorWindow", "Unity Editor main window");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(tex);
            }
        }

        // -------- helpers --------

        static byte[] DownscaleToPng(Texture2D src, int width, int height)
        {
            var rt = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32);
            var prevActive = RenderTexture.active;
            try
            {
                Graphics.Blit(src, rt);
                RenderTexture.active = rt;
                var tex = new Texture2D(width, height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                tex.Apply(false, false);
                var png = tex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(tex);
                return png ?? Array.Empty<byte>();
            }
            finally
            {
                RenderTexture.active = prevActive;
                RenderTexture.ReleaseTemporary(rt);
            }
        }

        static IDictionary<string, object> BuildResult(string source, int width, int height, byte[] pngBytes, string cameraName, string subject)
        {
            return new Dictionary<string, object>
            {
                { "source", source },
                { "width", width },
                { "height", height },
                { "mimeType", "image/png" },
                { "pngBase64", Convert.ToBase64String(pngBytes) },
                { "cameraName", cameraName },
                { "subject", subject }
            };
        }

        static SceneView FirstSceneView()
        {
            var arr = SceneView.sceneViews;
            if (arr == null || arr.Count == 0) return null;
            return arr[0] as SceneView;
        }

        static Camera ResolveGameCamera(string cameraPath)
        {
            if (!string.IsNullOrEmpty(cameraPath))
            {
                var go = GameObject.Find(cameraPath);
                if (go != null)
                {
                    var c = go.GetComponent<Camera>();
                    if (c != null) return c;
                }
                return null;
            }
            if (Camera.main != null) return Camera.main;
            // Fallback: highest-depth enabled camera in the active scene.
            Camera best = null;
            float bestDepth = float.NegativeInfinity;
#if UNITY_2023_1_OR_NEWER
            var cams = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
#else
            var cams = UnityEngine.Object.FindObjectsOfType<Camera>();
#endif
            foreach (var c in cams)
            {
                if (c == null || !c.enabled || !c.gameObject.activeInHierarchy) continue;
                if (c.depth > bestDepth) { best = c; bestDepth = c.depth; }
            }
            return best;
        }

        static string GetCameraPath(Camera c)
        {
            if (c == null) return "";
            return SceneInspector.PathOf(c.gameObject);
        }

        static byte[] RenderCameraToPng(Camera cam, int width, int height)
        {
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            rt.antiAliasing = 1;
            var prevTarget = cam.targetTexture;
            var prevActive = RenderTexture.active;
            try
            {
                cam.targetTexture = rt;
                cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(width, height, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                tex.Apply(false, false);
                var png = tex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(tex);
                return png ?? Array.Empty<byte>();
            }
            finally
            {
                cam.targetTexture = prevTarget;
                RenderTexture.active = prevActive;
                RenderTexture.ReleaseTemporary(rt);
            }
        }

        static byte[] RenderObjectWithTempCamera(GameObject target, int width, int height, float paddingFactor)
        {
            var bounds = ComputeBounds(target);
            var camGO = new GameObject("__UVibeCaptureCam__")
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            try
            {
                var cam = camGO.AddComponent<Camera>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.10f, 0.12f, 0.16f, 1f);
                cam.fieldOfView = 30f;
                cam.nearClipPlane = 0.01f;
                cam.farClipPlane = Mathf.Max(1000f, bounds.size.magnitude * 50f);

                float radius = Mathf.Max(bounds.extents.magnitude, 0.5f);
                float dist = radius * Mathf.Max(2.0f, paddingFactor);
                Vector3 dir = new Vector3(1f, 0.7f, -1f).normalized;
                cam.transform.position = bounds.center + dir * dist;
                cam.transform.LookAt(bounds.center);

                return RenderCameraToPng(cam, width, height);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(camGO);
            }
        }

        static Bounds ComputeBounds(GameObject go)
        {
            var renderers = go.GetComponentsInChildren<Renderer>();
            if (renderers != null && renderers.Length > 0)
            {
                Bounds b = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) b.Encapsulate(renderers[i].bounds);
                return b;
            }
            // No renderers: fall back to a unit cube around the transform position.
            return new Bounds(go.transform.position, Vector3.one);
        }
    }
}
