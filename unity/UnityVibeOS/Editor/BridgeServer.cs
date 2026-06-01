using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// HTTP JSON-RPC bridge server. Bound to 127.0.0.1 only.
    /// Routes are:
    ///   POST /rpc      - JSON-RPC envelope (see protocol)
    ///   GET  /health   - returns {"status":"ok"} for cheap reachability probes
    /// Auto-starts on editor load.
    /// </summary>
    [InitializeOnLoad]
    public static class BridgeServer
    {
        public const string ProtocolVersion = "1.0";
        public const string DefaultHost = "127.0.0.1";
        public const int DefaultPort = 38578;

        static HttpListener Listener;
        static CancellationTokenSource Cts;
        static Task ServeTask;
        static long StartedAt;

        public static int Port { get; private set; } = DefaultPort;
        public static string Host { get; private set; } = DefaultHost;
        public static bool IsRunning => Listener != null && Listener.IsListening;
        public static long UptimeMs => StartedAt == 0 ? 0 : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - StartedAt;

        static BridgeServer()
        {
            // Defer to next editor tick so static-init order across the package is settled.
            EditorApplication.delayCall += () => { try { Start(); } catch (Exception e) { Debug.LogError($"[UnityVibeOS] bridge auto-start failed: {e}"); } };
            // On domain reload we only tear down the socket — the discovery file stays so the
            // client knows a bridge exists here and treats the gap as UNITY_RELOADING, not a
            // missing Editor. On quit we also remove the discovery file.
            AssemblyReloadEvents.beforeAssemblyReload -= Stop;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting -= OnQuit;
            EditorApplication.quitting += OnQuit;
        }

        public static void Start()
        {
            if (IsRunning) return;
            // Resolve the port: explicit override (env) first, then probe upward from the
            // default so a second Editor instance falls back cleanly instead of colliding.
            int requested = ResolvePreferredPort();
            for (int candidate = requested; candidate < requested + 16; candidate++)
            {
                try
                {
                    var listener = new HttpListener();
                    var prefix = $"http://{DefaultHost}:{candidate}/";
                    listener.Prefixes.Add(prefix);
                    listener.Start();
                    Listener = listener;
                    Port = candidate;
                    Cts = new CancellationTokenSource();
                    StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    ServeTask = Task.Run(() => AcceptLoop(Cts.Token));
                    WriteDiscovery();
                    Debug.Log($"[UnityVibeOS] bridge listening on {prefix} (project {ProjectInfo.ProjectPath})");
                    return;
                }
                catch (HttpListenerException)
                {
                    // Port busy (another Editor / leftover socket) — try the next one.
                    continue;
                }
                catch (Exception e)
                {
                    Debug.LogError($"[UnityVibeOS] failed to start bridge on {DefaultHost}:{candidate}: {e.Message}");
                    Listener = null;
                    return;
                }
            }
            Debug.LogError($"[UnityVibeOS] could not bind any port in [{requested}, {requested + 16}); bridge not started.");
        }

        static int ResolvePreferredPort()
        {
            var env = Environment.GetEnvironmentVariable("UVIBE_BRIDGE_PORT");
            if (!string.IsNullOrEmpty(env) && int.TryParse(env, out var p) && p > 0 && p < 65536) return p;
            return DefaultPort;
        }

        /// <summary>
        /// Discovery file lets the MCP server find the actual bound port and verify it is
        /// talking to the right project, even when the port was auto-selected.
        /// </summary>
        static void WriteDiscovery()
        {
            try
            {
                var dir = Path.Combine(ProjectInfo.ProjectPath, "Library", "UnityVibeOS");
                Directory.CreateDirectory(dir);
                var payload = new Dictionary<string, object>
                {
                    { "port", Port },
                    { "host", DefaultHost },
                    { "projectPath", ProjectInfo.ProjectPath },
                    { "unityVersion", ProjectInfo.UnityVersion },
                    { "pid", System.Diagnostics.Process.GetCurrentProcess().Id },
                    { "protocolVersion", ProtocolVersion },
                    { "startedAt", StartedAt }
                };
                File.WriteAllText(Path.Combine(dir, "bridge.json"), MiniJson.Serialize(payload));
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UnityVibeOS] failed to write discovery file: {e.Message}");
            }
        }

        static void DeleteDiscovery()
        {
            try
            {
                var file = Path.Combine(ProjectInfo.ProjectPath, "Library", "UnityVibeOS", "bridge.json");
                if (File.Exists(file)) File.Delete(file);
            }
            catch { /* ignore */ }
        }

        public static void Stop()
        {
            try
            {
                Cts?.Cancel();
                if (Listener != null)
                {
                    try { Listener.Stop(); } catch { /* ignore */ }
                    try { Listener.Close(); } catch { /* ignore */ }
                }
            }
            finally
            {
                Listener = null;
                Cts = null;
                ServeTask = null;
                StartedAt = 0;
            }
        }

        static void OnQuit()
        {
            Stop();
            DeleteDiscovery();
        }

        /// <summary>
        /// Per-method main-thread budget. Most reads are sub-second, but test runs,
        /// play-mode transitions, and asset graph scans can legitimately take longer.
        /// </summary>
        static TimeSpan TimeoutFor(string method)
        {
            switch (method)
            {
                case "playmode.enter":
                case "playmode.exit":
                    return TimeSpan.FromSeconds(60);
                case "asset.findReferences":
                case "asset.findDependencies":
                case "asset.findMissingScripts":
                case "asset.findMissingReferences":
                    return TimeSpan.FromSeconds(120);
                case "test.run":
                case "test.status":
                    return TimeSpan.FromSeconds(30);
                default:
                    return TimeSpan.FromSeconds(15);
            }
        }

        static async Task AcceptLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested && Listener != null && Listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await Listener.GetContextAsync().ConfigureAwait(false);
                }
                catch (ObjectDisposedException) { break; }
                catch (HttpListenerException) { break; }
                catch (Exception e)
                {
                    Debug.LogWarning($"[UnityVibeOS] bridge accept error: {e.Message}");
                    continue;
                }

                _ = Task.Run(() => HandleRequest(ctx));
            }
        }

        static async Task HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                var path = ctx.Request.Url?.AbsolutePath ?? "/";
                if (ctx.Request.HttpMethod == "GET" && path == "/health")
                {
                    var healthBody = MiniJson.Serialize(new Dictionary<string, object>
                    {
                        { "status", "ok" },
                        { "unityVersion", ProjectInfo.UnityVersion },
                        { "projectPath", ProjectInfo.ProjectPath },
                        { "uptimeMs", UptimeMs }
                    });
                    WriteResponse(ctx, 200, healthBody);
                    return;
                }
                if (ctx.Request.HttpMethod == "OPTIONS")
                {
                    ctx.Response.AddHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
                    ctx.Response.AddHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
                    ctx.Response.AddHeader("Access-Control-Allow-Headers", "Content-Type");
                    WriteResponse(ctx, 204, "");
                    return;
                }
                if (ctx.Request.HttpMethod != "POST" || path != "/rpc")
                {
                    WriteResponse(ctx, 404, MiniJson.Serialize(new Dictionary<string, object>
                    {
                        { "ok", false },
                        { "error", new Dictionary<string, object> {
                            { "code", "INVALID_ARGUMENT" },
                            { "message", $"Unknown route: {ctx.Request.HttpMethod} {path}" } } }
                    }));
                    return;
                }

                string body;
                using (var sr = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding ?? Encoding.UTF8))
                {
                    body = await sr.ReadToEndAsync().ConfigureAwait(false);
                }

                Dictionary<string, object> req;
                try
                {
                    req = MiniJson.Deserialize(body) as Dictionary<string, object>;
                }
                catch (Exception e)
                {
                    WriteResponse(ctx, 400, MakeErrorEnvelope(null, "MALFORMED_BRIDGE_RESPONSE", $"Bad request JSON: {e.Message}"));
                    return;
                }
                if (req == null)
                {
                    WriteResponse(ctx, 400, MakeErrorEnvelope(null, "MALFORMED_BRIDGE_RESPONSE", "Bad request JSON: not an object."));
                    return;
                }

                string id = TryGetString(req, "id");
                string method = TryGetString(req, "method");
                Dictionary<string, object> p = req.TryGetValue("params", out var pObj) ? pObj as Dictionary<string, object> : new Dictionary<string, object>();

                if (string.IsNullOrEmpty(method))
                {
                    WriteResponse(ctx, 400, MakeErrorEnvelope(id, "INVALID_ARGUMENT", "missing 'method'"));
                    return;
                }

                long start = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                object result = null;
                Exception captured = null;
                var done = new ManualResetEventSlim(false);
                MainThreadDispatcher.Enqueue(() =>
                {
                    try { result = BridgeRouter.Dispatch(method, p); }
                    catch (Exception e) { captured = e; }
                    finally { done.Set(); }
                });

                var budget = TimeoutFor(method);
                if (!done.Wait(budget))
                {
                    WriteResponse(ctx, 504, MakeErrorEnvelope(id, "BRIDGE_TIMEOUT", $"Main-thread handler for '{method}' did not complete within {budget.TotalSeconds:0}s."));
                    return;
                }

                long durationMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - start;

                if (captured != null)
                {
                    string code = "INTERNAL_ERROR";
                    IDictionary<string, object> details = null;
                    if (captured is BridgeRouter.HandlerError he)
                    {
                        code = he.Code;
                        details = he.Details;
                    }
                    var envelope = new Dictionary<string, object>
                    {
                        { "id", id ?? "" },
                        { "ok", false },
                        { "result", null },
                        { "error", new Dictionary<string, object> {
                            { "code", code },
                            { "message", captured.Message ?? "" },
                            { "details", details ?? new Dictionary<string, object>() }
                        }},
                        { "meta", new Dictionary<string, object> {
                            { "unityVersion", ProjectInfo.UnityVersion },
                            { "projectPath", ProjectInfo.ProjectPath },
                            { "durationMs", durationMs }
                        }}
                    };
                    WriteResponse(ctx, 200, MiniJson.Serialize(envelope));
                    return;
                }

                var ok = new Dictionary<string, object>
                {
                    { "id", id ?? "" },
                    { "ok", true },
                    { "result", result },
                    { "error", null },
                    { "meta", new Dictionary<string, object> {
                        { "unityVersion", ProjectInfo.UnityVersion },
                        { "projectPath", ProjectInfo.ProjectPath },
                        { "durationMs", durationMs }
                    }}
                };
                WriteResponse(ctx, 200, MiniJson.Serialize(ok));
            }
            catch (Exception e)
            {
                Debug.LogError($"[UnityVibeOS] request handling failure: {e}");
                try
                {
                    WriteResponse(ctx, 500, MakeErrorEnvelope(null, "INTERNAL_ERROR", e.Message));
                }
                catch { /* ignore */ }
            }
        }

        static string MakeErrorEnvelope(string id, string code, string message)
        {
            var d = new Dictionary<string, object>
            {
                { "id", id ?? "" },
                { "ok", false },
                { "result", null },
                { "error", new Dictionary<string, object> {
                    { "code", code },
                    { "message", message },
                    { "details", new Dictionary<string, object>() }
                }},
                { "meta", new Dictionary<string, object> {
                    { "unityVersion", ProjectInfo.UnityVersion },
                    { "projectPath", ProjectInfo.ProjectPath },
                    { "durationMs", 0 }
                }}
            };
            return MiniJson.Serialize(d);
        }

        static void WriteResponse(HttpListenerContext ctx, int status, string body)
        {
            try
            {
                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = "application/json; charset=utf-8";
                if (!string.IsNullOrEmpty(body))
                {
                    var bytes = Encoding.UTF8.GetBytes(body);
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UnityVibeOS] failed to write response: {e.Message}");
            }
            finally
            {
                try { ctx.Response.OutputStream.Close(); } catch { /* ignore */ }
                try { ctx.Response.Close(); } catch { /* ignore */ }
            }
        }

        static string TryGetString(IDictionary<string, object> d, string k)
        {
            return d != null && d.TryGetValue(k, out var v) && v != null ? v.ToString() : null;
        }
    }
}
