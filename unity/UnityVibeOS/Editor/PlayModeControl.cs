using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Drives the Editor play-mode state machine. Entering/exiting play mode triggers a script
    /// domain reload (with the default project settings); the bridge socket drops and restarts,
    /// which the MCP client rides through as UNITY_RELOADING. Callers should poll
    /// <see cref="Status"/> until <c>isPlaying</c> settles.
    /// </summary>
    public static class PlayModeControl
    {
        public static IDictionary<string, object> Status()
        {
            bool isPlaying = EditorApplication.isPlaying;
            bool willChange = EditorApplication.isPlayingOrWillChangePlaymode;
            var d = new Dictionary<string, object>
            {
                { "isPlaying", isPlaying },
                { "isPaused", EditorApplication.isPaused },
                { "isTransitioning", willChange != isPlaying }
            };
            if (isPlaying)
            {
                d["frameCount"] = Time.frameCount;
                d["timeSinceLevelLoad"] = (double)Time.timeSinceLevelLoad;
            }
            return d;
        }

        public static IDictionary<string, object> Enter()
        {
            if (!EditorApplication.isPlaying && !EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorApplication.EnterPlaymode();
            }
            return Status();
        }

        public static IDictionary<string, object> Exit()
        {
            if (EditorApplication.isPlaying)
            {
                EditorApplication.ExitPlaymode();
            }
            return Status();
        }

        public static IDictionary<string, object> Step()
        {
            if (!EditorApplication.isPlaying)
            {
                throw new BridgeRouter.HandlerError("PLAY_MODE_REQUIRED", "Cannot step a frame while not in play mode.");
            }
            // Stepping pauses the game and advances exactly one frame.
            EditorApplication.Step();
            return Status();
        }
    }
}
