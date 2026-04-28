using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    public static class MenuItems
    {
        const string Root = "Window/Unity Vibe OS/";

        [MenuItem(Root + "Status")]
        static void ShowStatus()
        {
            string msg =
                $"Unity Vibe OS\n" +
                $"\n" +
                $"Bridge:        {(BridgeServer.IsRunning ? "running" : "stopped")}\n" +
                $"Address:       {BridgeServer.Host}:{BridgeServer.Port}\n" +
                $"Uptime:        {BridgeServer.UptimeMs / 1000}s\n" +
                $"Console buffer:{ConsoleCapture.BufferSize}\n" +
                $"Compiling:     {EditorApplication.isCompiling}\n" +
                $"Unity version: {Application.unityVersion}\n" +
                $"Project path:  {ProjectInfo.ProjectPath}";
            EditorUtility.DisplayDialog("Unity Vibe OS", msg, "OK");
        }

        [MenuItem(Root + "Restart Bridge")]
        static void RestartBridge()
        {
            BridgeServer.Stop();
            EditorApplication.delayCall += () => BridgeServer.Start();
        }

        [MenuItem(Root + "Stop Bridge")]
        static void StopBridge()
        {
            BridgeServer.Stop();
        }

        [MenuItem(Root + "Start Bridge")]
        static void StartBridge()
        {
            BridgeServer.Start();
        }
    }
}
