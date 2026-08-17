using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace UnityVibeOS
{
    /// <summary>
    /// Temporal capture: a short burst of Game-view frames so the agent can see motion rather than
    /// a single instant. Driven as a session (begin + long-poll, like multi-frame stepping) because
    /// frames arrive over wall-clock time and the editor loop must stay responsive throughout.
    ///
    /// Two acquisition paths, both writing into one persistent capture-sized RenderTexture:
    /// - Play mode: a HideAndDontSave pump MonoBehaviour yields WaitForEndOfFrame, then
    ///   ScreenCapture.CaptureScreenshotIntoRenderTexture grabs the composited Game view
    ///   (post-processing and UI included) and Graphics.Blit downscales it.
    /// - Edit mode: there is no player loop and no coroutines, so EditorApplication.update renders
    ///   the resolved camera off-screen — the same approach as <see cref="ScreenshotCapture"/>.
    ///
    /// Encoding runs on the main thread via ImageConversion (Texture2D.EncodeToJPG/PNG). Frames are
    /// small (~480x270), so this costs about a millisecond each and needs no off-thread work.
    /// </summary>
    public static class FrameCapture
    {
        const int MaxFrames = 16;
        /// <summary>Hard stop so a session can never wedge the long-poll if readbacks stop landing.</summary>
        const int GraceMs = 10_000;

        sealed class Frame
        {
            public int Index;
            public long TMs;
            public string Hash;
            public string ImageBase64;
        }

        static volatile bool _capturing;
        static readonly List<Frame> Frames = new List<Frame>();

        static int _targetFrames;
        static int _intervalMs;
        static string _format;
        static int _quality;
        static string _cameraPath;
        static int _width;
        static int _height;
        static long _startedAtMs;
        static long _deadlineMs;
        static long _nextDueMs;
        static int _requested;
        static int _pending;
        static int _dropped;
        static bool _playMode;
        static bool _useAsyncReadback;

        static RenderTexture _fullRT;
        static RenderTexture _captureRT;
        static Texture2D _readbackTex;
        static GameObject _pumpGO;
        static bool _watchdogHooked;

        /// <summary>Thread-safe: read by the bridge's long-poll probe on the HTTP thread.</summary>
        public static bool IsCapturing => _capturing;

        /// <summary>
        /// Starts a capture session. Idempotent while one is running so the client can re-issue the
        /// long-poll for a sequence longer than a single await window without restarting it.
        /// </summary>
        public static IDictionary<string, object> Begin(IDictionary<string, object> p)
        {
            if (_capturing) return Status();

            _targetFrames = Mathf.Clamp(BridgeParams.GetInt(p, "frames", 8), 2, MaxFrames);
            _intervalMs = Mathf.Clamp(BridgeParams.GetInt(p, "intervalMs", 250), 50, 2000);
            _width = Mathf.Clamp(BridgeParams.GetInt(p, "width", 480), 160, 1280);
            _format = BridgeParams.Str(p, "format", "jpg");
            _quality = Mathf.Clamp(BridgeParams.GetInt(p, "quality", 70), 1, 100);
            _cameraPath = BridgeParams.Str(p, "cameraPath", null);
            _playMode = EditorApplication.isPlaying;

            var camera = ResolveCamera();
            if (camera == null && !_playMode)
            {
                throw new BridgeRouter.HandlerError(
                    "OBJECT_NOT_FOUND",
                    "No suitable Camera found for edit-mode capture. Ensure the active scene contains a Camera (preferably tagged 'MainCamera') or pass cameraPath."
                );
            }

            _height = Mathf.Max(8, Mathf.RoundToInt(_width / ResolveAspect(camera)));
            Frames.Clear();
            _requested = 0;
            _pending = 0;
            _dropped = 0;
            _startedAtMs = NowMs();
            _nextDueMs = _startedAtMs;
            _deadlineMs = _startedAtMs + (long)_targetFrames * _intervalMs + GraceMs;
            _useAsyncReadback = _playMode && SystemInfo.supportsAsyncGPUReadback;

            try
            {
                AllocateTargets();
            }
            catch (Exception)
            {
                // Nothing has been marked in-flight yet, so the long-poll simply never starts.
                Cleanup();
                throw;
            }
            _capturing = true;

            if (!_watchdogHooked)
            {
                EditorApplication.update += Watchdog;
                _watchdogHooked = true;
            }
            if (_playMode) StartPlayModePump();

            return Status();
        }

        /// <summary>
        /// Current session payload. While capturing it reports progress only; once the session has
        /// finished it carries every collected frame (base64 + timing + perceptual hash).
        /// </summary>
        public static IDictionary<string, object> Status()
        {
            var frames = new List<object>();
            if (!_capturing)
            {
                Frames.Sort((a, b) => a.Index.CompareTo(b.Index));
                foreach (var f in Frames)
                {
                    frames.Add(new Dictionary<string, object>
                    {
                        { "index", f.Index },
                        { "tMs", f.TMs },
                        { "hash", f.Hash },
                        { "imageBase64", f.ImageBase64 }
                    });
                }
            }
            return new Dictionary<string, object>
            {
                { "capturing", _capturing },
                // Reported while still capturing too, so the client can drive progress from it.
                { "capturedFrames", Frames.Count },
                { "playMode", _playMode },
                { "width", _width },
                { "height", _height },
                { "mimeType", IsJpg(_format) ? "image/jpeg" : "image/png" },
                { "droppedFrames", _dropped },
                { "avgIntervalMs", AverageIntervalMs() },
                { "frames", frames }
            };
        }

        // -------- acquisition --------

        static void AllocateTargets()
        {
            // Allocated once per session and reused for every frame; releasing per frame would
            // thrash the GPU allocator at capture rates. The depth buffer is what makes the
            // edit-mode Camera.Render path depth-test correctly (Graphics.Blit ignores it).
            _captureRT = new RenderTexture(_width, _height, 24, RenderTextureFormat.ARGB32)
            {
                name = "__UVibeFrameCapture__",
                antiAliasing = 1
            };
            _captureRT.Create();
            _readbackTex = new Texture2D(_width, _height, TextureFormat.RGBA32, false)
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            if (_playMode)
            {
                // CaptureScreenshotIntoRenderTexture requires a screen-sized target; the downscale
                // to capture size happens in the Blit afterwards.
                _fullRT = new RenderTexture(Mathf.Max(1, Screen.width), Mathf.Max(1, Screen.height), 0, RenderTextureFormat.ARGB32)
                {
                    name = "__UVibeFrameCaptureFull__"
                };
                _fullRT.Create();
            }
        }

        static void StartPlayModePump()
        {
            _pumpGO = new GameObject("__UVibeFrameCapturePump__") { hideFlags = HideFlags.HideAndDontSave };
            var pump = _pumpGO.AddComponent<FrameCapturePump>();
            pump.StartCapture();
        }

        /// <summary>
        /// Grabs one frame at the end of the current render. Play-mode only: WaitForEndOfFrame is
        /// what makes ScreenCapture read the fully composited Game view.
        /// </summary>
        internal static void GrabPlayModeFrame()
        {
            if (!_capturing || _requested >= _targetFrames) return;
            try
            {
                ScreenCapture.CaptureScreenshotIntoRenderTexture(_fullRT);
                Graphics.Blit(_fullRT, _captureRT);
            }
            catch (Exception e)
            {
                _requested++;
                _dropped++;
                Debug.LogWarning($"[UnityVibeOS] frame capture failed: {e.Message}");
                return;
            }
            Acquire();
        }

        /// <summary>Edit mode has no player loop, so render the resolved camera off-screen instead.</summary>
        static void GrabEditModeFrame()
        {
            var cam = ResolveCamera();
            if (cam == null)
            {
                _dropped++;
                _requested++;
                return;
            }
            var prevTarget = cam.targetTexture;
            try
            {
                cam.targetTexture = _captureRT;
                cam.Render();
            }
            catch (Exception e)
            {
                _requested++;
                _dropped++;
                Debug.LogWarning($"[UnityVibeOS] frame capture failed: {e.Message}");
                return;
            }
            finally
            {
                cam.targetTexture = prevTarget;
            }
            Acquire();
        }

        /// <summary>
        /// Reads _captureRT back to CPU, async when the platform supports it. Counts the attempt
        /// exactly once — callers must not also increment on the way in — and never throws, so a
        /// failed readback costs one dropped frame rather than stalling the session.
        /// </summary>
        static void Acquire()
        {
            int index = ++_requested;
            long tMs = NowMs() - _startedAtMs;
            try
            {
                AcquireCore(index, tMs);
            }
            catch (Exception e)
            {
                _dropped++;
                Debug.LogWarning($"[UnityVibeOS] frame readback failed: {e.Message}");
            }
        }

        static void AcquireCore(int index, long tMs)
        {
            if (_useAsyncReadback)
            {
                _pending++;
                AsyncGPUReadback.Request(_captureRT, 0, TextureFormat.RGBA32, request =>
                {
                    _pending--;
                    if (request.hasError)
                    {
                        _dropped++;
                        return;
                    }
                    var data = request.GetData<byte>();
                    var bytes = new byte[data.Length];
                    data.CopyTo(bytes);
                    StoreFrame(index, tMs, bytes);
                });
                return;
            }
            // Synchronous readback: a 480x270 ReadPixels costs well under a millisecond, and it is
            // the only path available where AsyncGPUReadback is unsupported.
            var prevActive = RenderTexture.active;
            try
            {
                RenderTexture.active = _captureRT;
                _readbackTex.ReadPixels(new Rect(0, 0, _width, _height), 0, 0);
                _readbackTex.Apply(false, false);
                StoreFrame(index, tMs, _readbackTex.GetRawTextureData());
            }
            finally
            {
                RenderTexture.active = prevActive;
            }
        }

        static void StoreFrame(int index, long tMs, byte[] rgba)
        {
            // An async readback can land after the session already finished on its deadline, by
            // which point the session's textures are gone.
            if (!_capturing || _readbackTex == null) return;
            if (rgba == null || rgba.Length != _width * _height * 4)
            {
                _dropped++;
                return;
            }
            // ReadPixels already returns bottom-up rows; an async readback of a render target on a
            // top-left-origin graphics API does not, so flip those to match what the encoder wants.
            if (_useAsyncReadback && SystemInfo.graphicsUVStartsAtTop) FlipRows(rgba, _width, _height);

            _readbackTex.LoadRawTextureData(rgba);
            _readbackTex.Apply(false, false);
            byte[] encoded = IsJpg(_format) ? _readbackTex.EncodeToJPG(_quality) : _readbackTex.EncodeToPNG();
            Frames.Add(new Frame
            {
                Index = index,
                TMs = tMs,
                Hash = AverageHash(rgba, _width, _height),
                ImageBase64 = Convert.ToBase64String(encoded ?? Array.Empty<byte>())
            });
        }

        // -------- session lifecycle --------

        /// <summary>
        /// Runs on every editor tick while a session is live: drives edit-mode grabs on the
        /// interval, and ends the session once every frame has landed or the deadline passes.
        /// Also the safety net for a play-mode pump destroyed by a domain reload or play-state exit.
        /// </summary>
        static void Watchdog()
        {
            if (!_capturing)
            {
                if (_watchdogHooked)
                {
                    EditorApplication.update -= Watchdog;
                    _watchdogHooked = false;
                }
                return;
            }

            long now = NowMs();
            if (!_playMode && _requested < _targetFrames && now >= _nextDueMs)
            {
                _nextDueMs = now + _intervalMs;
                GrabEditModeFrame();
            }
            // The play-mode pump dies with the play session; finish with what landed.
            if (_playMode && !EditorApplication.isPlaying && _requested < _targetFrames)
            {
                _dropped += _targetFrames - _requested;
                _requested = _targetFrames;
            }
            if ((_requested >= _targetFrames && _pending <= 0) || now >= _deadlineMs)
            {
                if (now >= _deadlineMs) _dropped += Mathf.Max(0, _targetFrames - Frames.Count - _dropped);
                Finish();
            }
        }

        internal static bool WantsMoreFrames => _capturing && _requested < _targetFrames;
        internal static int IntervalMs => _intervalMs;

        static void Finish()
        {
            _capturing = false;
            Cleanup();
        }

        static void Cleanup()
        {
            if (_pumpGO != null)
            {
                UnityEngine.Object.DestroyImmediate(_pumpGO);
                _pumpGO = null;
            }
            if (_captureRT != null)
            {
                _captureRT.Release();
                UnityEngine.Object.DestroyImmediate(_captureRT);
                _captureRT = null;
            }
            if (_fullRT != null)
            {
                _fullRT.Release();
                UnityEngine.Object.DestroyImmediate(_fullRT);
                _fullRT = null;
            }
            if (_readbackTex != null)
            {
                UnityEngine.Object.DestroyImmediate(_readbackTex);
                _readbackTex = null;
            }
        }

        // -------- helpers --------

        static bool IsJpg(string format)
        {
            return string.Equals(format, "jpg", StringComparison.OrdinalIgnoreCase)
                || string.Equals(format, "jpeg", StringComparison.OrdinalIgnoreCase);
        }

        static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        static double AverageIntervalMs()
        {
            if (Frames.Count < 2) return 0;
            Frames.Sort((a, b) => a.Index.CompareTo(b.Index));
            return (double)(Frames[Frames.Count - 1].TMs - Frames[0].TMs) / (Frames.Count - 1);
        }

        static Camera ResolveCamera()
        {
            if (!string.IsNullOrEmpty(_cameraPath))
            {
                var go = GameObject.Find(_cameraPath);
                return go != null ? go.GetComponent<Camera>() : null;
            }
            if (Camera.main != null) return Camera.main;
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

        static float ResolveAspect(Camera cam)
        {
            if (cam != null && cam.aspect > 0.01f) return cam.aspect;
            if (Screen.width > 0 && Screen.height > 0) return (float)Screen.width / Screen.height;
            return 16f / 9f;
        }

        static void FlipRows(byte[] rgba, int width, int height)
        {
            int stride = width * 4;
            var row = new byte[stride];
            for (int y = 0; y < height / 2; y++)
            {
                int top = y * stride;
                int bottom = (height - 1 - y) * stride;
                Buffer.BlockCopy(rgba, top, row, 0, stride);
                Buffer.BlockCopy(rgba, bottom, rgba, top, stride);
                Buffer.BlockCopy(row, 0, rgba, bottom, stride);
            }
        }

        /// <summary>
        /// 8x8 grayscale average hash, returned as 16 hex chars. The client compares consecutive
        /// hashes by Hamming distance to decide which frames are worth spending context on, so this
        /// only has to be stable and cheap — not a rigorous perceptual metric.
        /// </summary>
        static string AverageHash(byte[] rgba, int width, int height)
        {
            var cells = new float[64];
            for (int cy = 0; cy < 8; cy++)
            {
                int y0 = cy * height / 8;
                int y1 = Mathf.Max(y0 + 1, (cy + 1) * height / 8);
                for (int cx = 0; cx < 8; cx++)
                {
                    int x0 = cx * width / 8;
                    int x1 = Mathf.Max(x0 + 1, (cx + 1) * width / 8);
                    double sum = 0;
                    int count = 0;
                    for (int y = y0; y < y1; y++)
                    {
                        int rowBase = y * width * 4;
                        for (int x = x0; x < x1; x++)
                        {
                            int o = rowBase + x * 4;
                            sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
                            count++;
                        }
                    }
                    cells[cy * 8 + cx] = count > 0 ? (float)(sum / count) : 0f;
                }
            }
            float mean = 0f;
            for (int i = 0; i < 64; i++) mean += cells[i];
            mean /= 64f;

            var hex = new char[16];
            for (int nibble = 0; nibble < 16; nibble++)
            {
                int value = 0;
                for (int bit = 0; bit < 4; bit++)
                {
                    if (cells[nibble * 4 + bit] >= mean) value |= 1 << (3 - bit);
                }
                hex[nibble] = "0123456789abcdef"[value];
            }
            return new string(hex);
        }
    }
}
