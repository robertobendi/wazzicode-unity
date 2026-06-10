using System;
using System.Collections.Concurrent;
using UnityEditor;

namespace UnityVibeOS
{
    /// <summary>
    /// Drains a queue of actions on the Editor main thread via EditorApplication.update.
    /// HttpListener callbacks run on the threadpool; Unity Editor APIs (Selection, SceneManager, etc.)
    /// must be called on the main thread, so all bridge handlers go through here.
    /// </summary>
    [InitializeOnLoad]
    public static class MainThreadDispatcher
    {
        static readonly ConcurrentQueue<Action> Queue = new ConcurrentQueue<Action>();

        static MainThreadDispatcher()
        {
            EditorApplication.update -= Pump;
            EditorApplication.update += Pump;
        }

        public static void Enqueue(Action action)
        {
            if (action == null) return;
            Queue.Enqueue(action);
        }

        static readonly System.Diagnostics.Stopwatch PumpWatch = new System.Diagnostics.Stopwatch();

        static void Pump()
        {
            // Time-budget the work-per-tick (rather than a fixed action count) so cheap bursts
            // — e.g. a unity_batch of many small edits — drain in one tick, while a run of slow
            // actions still yields to keep the editor responsive.
            if (Queue.IsEmpty) return;
            PumpWatch.Restart();
            int safety = 256;
            while (safety-- > 0 && Queue.TryDequeue(out var action))
            {
                try
                {
                    action();
                }
                catch (Exception e)
                {
                    UnityEngine.Debug.LogError($"[UnityVibeOS] Main-thread action threw: {e}");
                }
                if (PumpWatch.ElapsedMilliseconds >= 8) break;
            }
        }
    }
}
