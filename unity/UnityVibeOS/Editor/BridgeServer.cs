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
            AssemblyReloadEvents.beforeAssemblyReload -= Stop;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting -= Stop;
            EditorApplication.quitting += Stop;
        }

        public static void Start()
        {
            if (IsRunning) return;
            try
            {
                Listener = new HttpListener();
                var prefix = $"http://{DefaultHost}:{DefaultPort}/";
                Listener.Prefixes.Add(prefix);
                Listener.Start();
                Cts = new CancellationTokenSource();
                StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                ServeTask = Task.Run(() => AcceptLoop(Cts.Token));
                Debug.Log($"[UnityVibeOS] bridge listening on {prefix}");
            }
            catch (Exception e)
            {
                Debug.LogError($"[UnityVibeOS] failed to start bridge on {DefaultHost}:{DefaultPort}: {e.Message}");
                Listener = null;
            }
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
                    var body = MiniJson.Serialize(new Dictionary<string, object>
                    {
                        { "status", "ok" },
                        { "unityVersion", ProjectInfo.UnityVersion },
                        { "projectPath", ProjectInfo.ProjectPath },
                        { "uptimeMs", UptimeMs }
                    });
                    WriteResponse(ctx, 200, body);
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

                if (!done.Wait(TimeSpan.FromSeconds(15)))
                {
                    WriteResponse(ctx, 504, MakeErrorEnvelope(id, "BRIDGE_TIMEOUT", "Main-thread handler did not complete within 15s."));
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
