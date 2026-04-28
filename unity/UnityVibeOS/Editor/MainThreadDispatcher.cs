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

        static void Pump()
        {
            // Bound the work-per-tick so the editor remains responsive even under burst.
            int budget = 32;
            while (budget-- > 0 && Queue.TryDequeue(out var action))
            {
                try
                {
                    action();
                }
                catch (Exception e)
                {
                    UnityEngine.Debug.LogError($"[UnityVibeOS] Main-thread action threw: {e}");
                }
            }
        }
    }
}
