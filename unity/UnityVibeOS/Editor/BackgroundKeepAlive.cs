using System;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Keeps the Editor responsive to the bridge while its window is NOT focused.
    ///
    /// By default Unity throttles the editor loop (and pauses play mode) when it loses OS focus,
    /// so <see cref="MainThreadDispatcher"/> stops draining and bridge tool calls — wait-for-compile,
    /// play-mode stepping, frame capture — hang until you click back into Unity. When enabled, this
    /// driver:
    ///   • sets <c>Application.runInBackground = true</c> so play mode keeps running unfocused, and
    ///   • while unfocused, repeatedly pumps the player loop and repaints so the editor keeps
    ///     ticking at a healthy rate (and queued main-thread work / compilation proceeds).
    ///
    /// It only does work while the Editor is in the background, so a focused editor is unaffected.
    /// Costs some background CPU — toggle it in Window ▸ Unity Vibe OS ▸ "Keep Unity awake (background)".
    /// The choice is per-user (EditorPrefs) and defaults ON.
    /// </summary>
    [InitializeOnLoad]
    public static class BackgroundKeepAlive
    {
        const string PrefKey = "UnityVibeOS.KeepAwake";
        // ~30 Hz while unfocused: snappy for the dispatcher without pegging a core.
        const double IntervalMs = 33.0;
        static double _lastTickMs;

        public static bool Enabled
        {
            get => EditorPrefs.GetBool(PrefKey, true);
            set { EditorPrefs.SetBool(PrefKey, value); Apply(); }
        }

        static BackgroundKeepAlive()
        {
            // Defer so static-init order across the package is settled (mirrors BridgeServer).
            EditorApplication.delayCall += Apply;
        }

        static void Apply()
        {
            EditorApplication.update -= Tick;
            if (!Enabled) return;
            // Lets the player loop run while the app is in the background (play mode unfocused).
            Application.runInBackground = true;
            EditorApplication.update += Tick;
        }

        static void Tick()
        {
            // A focused Editor already ticks fully; only intervene when it's in the background.
            if (InternalEditorUtility.isApplicationActive) return;

            double nowMs = EditorApplication.timeSinceStartup * 1000.0;
            if (nowMs - _lastTickMs < IntervalMs) return;
            _lastTickMs = nowMs;

            try
            {
                // Advance the player loop and force repaints so the editor keeps updating —
                // this is what drains MainThreadDispatcher and lets compile/import proceed
                // without the user having to refocus the window.
                EditorApplication.QueuePlayerLoopUpdate();
                InternalEditorUtility.RepaintAllViews();
            }
            catch
            {
                // Editor mid domain-reload (entering play / post-compile); ignore and retry next tick.
            }
        }
    }
}
