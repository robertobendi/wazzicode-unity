using System;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Thread-safe snapshot of editor state, refreshed every EditorApplication.update tick.
    /// The long-poll await handlers in <see cref="BridgeServer"/> run on HTTP threadpool
    /// threads, which must not touch Unity APIs — they read these volatile fields instead
    /// and only hop to the main thread once the awaited condition has flipped.
    /// </summary>
    [InitializeOnLoad]
    public static class EditorStateMirror
    {
        static volatile bool _isCompiling;
        static volatile bool _isPlaying;
        static volatile bool _isPaused;
        static volatile bool _willChange;
        static volatile int _frameCount;
        static long _lastTickMs;

        public static bool IsCompiling => _isCompiling;
        public static bool IsPlaying => _isPlaying;
        public static bool IsPaused => _isPaused;
        public static bool IsTransitioning => _willChange != _isPlaying;
        public static int FrameCount => _frameCount;
        public static long LastTickMs => Interlocked.Read(ref _lastTickMs);

        static EditorStateMirror()
        {
            EditorApplication.update -= Tick;
            EditorApplication.update += Tick;
            Tick();
        }

        static void Tick()
        {
            _isCompiling = EditorApplication.isCompiling;
            _isPlaying = EditorApplication.isPlaying;
            _isPaused = EditorApplication.isPaused;
            _willChange = EditorApplication.isPlayingOrWillChangePlaymode;
            _frameCount = _isPlaying ? Time.frameCount : 0;
            Interlocked.Exchange(ref _lastTickMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
    }
}
