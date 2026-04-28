using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Captures Unity logs into a bounded ring buffer using
    /// Application.logMessageReceivedThreaded so multi-threaded logs are not dropped.
    /// Logs emitted before this static ctor runs are not retained (documented limitation).
    /// </summary>
    [InitializeOnLoad]
    public static class ConsoleCapture
    {
        public sealed class Entry
        {
            public string Type;       // "Log" | "Warning" | "Error" | "Assert" | "Exception"
            public string Message;
            public string StackTrace;
            public long Timestamp;    // ms since unix epoch
        }

        const int CAPACITY = 2000;
        static readonly object Lock = new object();
        static readonly Queue<Entry> Buffer = new Queue<Entry>(CAPACITY);

        static ConsoleCapture()
        {
            Application.logMessageReceivedThreaded -= OnLog;
            Application.logMessageReceivedThreaded += OnLog;
        }

        static void OnLog(string message, string stackTrace, LogType type)
        {
            var entry = new Entry
            {
                Type = MapType(type),
                Message = message ?? "",
                StackTrace = stackTrace ?? "",
                Timestamp = NowMs(),
            };
            lock (Lock)
            {
                if (Buffer.Count >= CAPACITY) Buffer.Dequeue();
                Buffer.Enqueue(entry);
            }
        }

        public static IList<object> Read(string level, int limit, long? sinceTimestamp)
        {
            var snapshot = SnapshotEntries();
            var result = new List<object>();
            for (int i = snapshot.Count - 1; i >= 0; i--)
            {
                if (result.Count >= limit) break;
                var e = snapshot[i];
                if (sinceTimestamp.HasValue && e.Timestamp <= sinceTimestamp.Value) continue;
                if (!MatchesLevel(level, e.Type)) continue;
                result.Add(new Dictionary<string, object>
                {
                    { "type", e.Type },
                    { "message", e.Message },
                    { "stackTrace", e.StackTrace },
                    { "timestamp", e.Timestamp }
                });
            }
            // Re-reverse to chronological order for callers.
            result.Reverse();
            return result;
        }

        public static int BufferSize { get { lock (Lock) { return Buffer.Count; } } }

        static List<Entry> SnapshotEntries()
        {
            lock (Lock)
            {
                return new List<Entry>(Buffer);
            }
        }

        static bool MatchesLevel(string level, string type)
        {
            if (string.IsNullOrEmpty(level) || level == "all") return true;
            if (level == "warning_or_error")
                return type == "Warning" || type == "Error" || type == "Assert" || type == "Exception";
            if (level == "error")
                return type == "Error" || type == "Assert" || type == "Exception";
            return true;
        }

        static string MapType(LogType t)
        {
            switch (t)
            {
                case LogType.Log: return "Log";
                case LogType.Warning: return "Warning";
                case LogType.Error: return "Error";
                case LogType.Assert: return "Assert";
                case LogType.Exception: return "Exception";
                default: return "Log";
            }
        }

        static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
}
