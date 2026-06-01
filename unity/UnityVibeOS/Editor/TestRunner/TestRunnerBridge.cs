#if UNITY_INCLUDE_TESTS
using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Optional integration with the Unity Test Framework. Lives in its own assembly guarded by
    /// UNITY_INCLUDE_TESTS so the core bridge still compiles when the package is absent. It
    /// self-registers test.run / test.status / test.cancel handlers into <see cref="BridgeRouter"/>.
    ///
    /// Test runs are asynchronous and PlayMode runs reload the script domain, so run state is
    /// persisted in <see cref="SessionState"/> (survives reloads, cleared on Editor restart) and
    /// callbacks are re-registered on every load.
    /// </summary>
    [InitializeOnLoad]
    public static class TestRunnerBridge
    {
        const string StateKey = "UnityVibeOS.testRun";
        static readonly TestRunnerApi Api;

        static TestRunnerBridge()
        {
            Api = ScriptableObject.CreateInstance<TestRunnerApi>();
            Api.RegisterCallbacks(new Collector());

            BridgeRouter.Register("test.run", Run);
            BridgeRouter.Register("test.status", Status);
            BridgeRouter.Register("test.cancel", Cancel);
        }

        static object Run(IDictionary<string, object> p)
        {
            string modeStr = p != null && p.TryGetValue("mode", out var m) && m != null ? m.ToString() : "EditMode";
            var mode = modeStr.Equals("PlayMode", StringComparison.OrdinalIgnoreCase) ? TestMode.PlayMode : TestMode.EditMode;
            string filter = p != null && p.TryGetValue("filter", out var f) && f != null ? f.ToString() : null;

            string runId = Guid.NewGuid().ToString("N");
            var state = new Dictionary<string, object>
            {
                { "runId", runId },
                { "state", "running" },
                { "mode", mode.ToString() },
                { "startedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() },
                { "results", new List<object>() },
                { "passed", 0 }, { "failed", 0 }, { "skipped", 0 }, { "total", 0 }
            };
            SessionState.SetString(StateKey, MiniJson.Serialize(state));

            var execFilter = new Filter { testMode = mode };
            if (!string.IsNullOrEmpty(filter)) execFilter.testNames = new[] { filter };
            Api.Execute(new ExecutionSettings(execFilter));

            return new Dictionary<string, object>
            {
                { "runId", runId },
                { "state", "running" },
                { "mode", mode.ToString() }
            };
        }

        static object Status(IDictionary<string, object> p)
        {
            var raw = SessionState.GetString(StateKey, null);
            if (string.IsNullOrEmpty(raw))
            {
                return new Dictionary<string, object> { { "runId", "" }, { "state", "not_found" } };
            }
            // Round-trip the stored JSON straight back to the caller.
            return MiniJson.Deserialize(raw);
        }

        static object Cancel(IDictionary<string, object> p)
        {
            // The Api has no public cancel; mark our record cancelled so pollers stop waiting.
            var raw = SessionState.GetString(StateKey, null);
            if (!string.IsNullOrEmpty(raw) && MiniJson.Deserialize(raw) is Dictionary<string, object> s)
            {
                s["state"] = "cancelled";
                SessionState.SetString(StateKey, MiniJson.Serialize(s));
                return s;
            }
            return new Dictionary<string, object> { { "state", "not_found" } };
        }

        sealed class Collector : ICallbacks
        {
            public void RunStarted(ITestAdaptor testsToRun) { }

            public void TestStarted(ITestAdaptor test) { }

            public void TestFinished(ITestResultAdaptor result) { }

            public void RunFinished(ITestResultAdaptor result)
            {
                var raw = SessionState.GetString(StateKey, null);
                Dictionary<string, object> state = (!string.IsNullOrEmpty(raw) && MiniJson.Deserialize(raw) is Dictionary<string, object> s)
                    ? s
                    : new Dictionary<string, object>();

                var results = new List<object>();
                int passed = 0, failed = 0, skipped = 0;
                Flatten(result, results, ref passed, ref failed, ref skipped);

                state["state"] = "completed";
                state["results"] = results;
                state["total"] = results.Count;
                state["passed"] = passed;
                state["failed"] = failed;
                state["skipped"] = skipped;
                state["durationSec"] = (double)result.Duration;
                state["finishedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                SessionState.SetString(StateKey, MiniJson.Serialize(state));
            }

            static void Flatten(ITestResultAdaptor node, List<object> outList, ref int passed, ref int failed, ref int skipped)
            {
                if (node.HasChildren)
                {
                    foreach (var child in node.Children) Flatten(child, outList, ref passed, ref failed, ref skipped);
                    return;
                }
                // Leaf = a single test case.
                string status = node.TestStatus.ToString();
                if (status == "Passed") passed++;
                else if (status == "Failed") failed++;
                else if (status == "Skipped") skipped++;

                outList.Add(new Dictionary<string, object>
                {
                    { "name", node.Test != null ? node.Test.Name : node.Name },
                    { "fullName", node.Test != null ? node.Test.FullName : "" },
                    { "status", status },
                    { "durationSec", (double)node.Duration },
                    { "message", node.Message ?? "" },
                    { "stackTrace", node.StackTrace ?? "" }
                });
            }
        }
    }
}
#endif
