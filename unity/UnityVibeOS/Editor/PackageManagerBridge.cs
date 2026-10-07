using System.Collections.Generic;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Threading;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using static UnityVibeOS.BridgeParams;

namespace UnityVibeOS
{
    /// <summary>
    /// UPM access through UnityEditor.PackageManager.Client: list the resolved packages and add one
    /// (e.g. com.unity.cloud.gltfast so .glb files import). Requests are waited on for a bounded
    /// time inside the bridge's main-thread budget; an add that is still resolving returns
    /// status "in_progress" and the caller polls package.list (stateless, so it survives the domain
    /// reload a newly added package triggers). Only registry names (optionally @version) and https
    /// git URLs are accepted — never file: paths or arbitrary manifest edits.
    /// </summary>
    public static class PackageManagerBridge
    {
        // Both well under BridgeServer's default 15s main-thread budget.
        const int ListWaitMs = 10000;
        const int AddWaitMs = 3000; // a registry add usually takes far longer (download + resolve: ~90s for glTFast); don't freeze the Editor waiting

        static readonly Regex RegistryId = new Regex(@"^[a-z0-9][a-z0-9._-]{0,213}(@[0-9A-Za-z.+-]{1,64})?$");
        static readonly Regex GitUrl = new Regex(@"^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~/-]+(\.git)?(\?path=[A-Za-z0-9._~/-]+)?(#[A-Za-z0-9._/-]+)?$");

        public static bool IsAllowedId(string id)
            => !string.IsNullOrEmpty(id) && (RegistryId.IsMatch(id) || GitUrl.IsMatch(id));

        public static IDictionary<string, object> List(IDictionary<string, object> p)
        {
            bool includeIndirect = GetBool(p, "includeIndirect", false);
            var req = Client.List(true, includeIndirect);
            if (!Wait(req, ListWaitMs))
                throw new BridgeRouter.HandlerError("BRIDGE_TIMEOUT", "Package Manager did not answer the list request in time; retry shortly.");
            if (req.Status == StatusCode.Failure)
                throw new BridgeRouter.HandlerError("INTERNAL_ERROR", $"Package list failed: {req.Error?.message}");

            var packages = new List<object>();
            foreach (var info in req.Result)
            {
                packages.Add(new Dictionary<string, object>
                {
                    { "name", info.name },
                    { "version", info.version },
                    { "displayName", info.displayName },
                    { "source", info.source.ToString() },
                    { "direct", info.isDirectDependency },
                });
            }
            return new Dictionary<string, object>
            {
                { "count", packages.Count },
                { "packages", packages },
            };
        }

        public static IDictionary<string, object> Add(IDictionary<string, object> p)
        {
            string id = Str(p, "id");
            if (!IsAllowedId(id))
                throw new BridgeRouter.HandlerError("INVALID_ARGUMENT",
                    $"'{id}' is not an allowed package id. Use a registry name (com.vendor.pkg or com.vendor.pkg@1.2.3) or an https git URL.");

            // A bare name for a package that is already a direct dependency is a no-op, not an
            // upgrade: Client.Add would otherwise move it to the latest version.
            if (id.IndexOf('@') < 0 && !id.StartsWith("https://"))
            {
                var list = Client.List(true, false);
                if (Wait(list, ListWaitMs) && list.Status == StatusCode.Success)
                {
                    foreach (var info in list.Result)
                    {
                        if (info.name == id && info.isDirectDependency)
                            return Result(true, "already_installed", info.name, info.version,
                                $"{info.name}@{info.version} is already installed.");
                    }
                }
            }

            var req = Client.Add(id);
            if (!Wait(req, AddWaitMs))
                return Result(true, "in_progress", id, null,
                    $"Requested {id}; Unity is still resolving it. Poll unity_list_packages until it appears, then unity_wait_for_compile.");
            if (req.Status == StatusCode.Failure)
            {
                var code = req.Error != null ? req.Error.errorCode : ErrorCode.Unknown;
                throw new BridgeRouter.HandlerError(
                    code == ErrorCode.NotFound ? "INVALID_ARGUMENT" : "INTERNAL_ERROR",
                    $"Adding '{id}' failed: {req.Error?.message}",
                    new Dictionary<string, object> { { "packageManagerError", code.ToString() } });
            }
            var r = req.Result;
            return Result(true, "installed", r.name, r.version,
                $"Added {r.name}@{r.version}. Unity will import and recompile; call unity_wait_for_compile before using it.");
        }

        static IDictionary<string, object> Result(bool applied, string status, string name, string version, string summary)
        {
            return new Dictionary<string, object>
            {
                { "applied", applied },
                { "status", status },
                { "name", name },
                { "version", version },
                { "target", "Packages/manifest.json" },
                { "summary", summary },
                { "undoable", false },
            };
        }

        static bool Wait(Request req, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            while (!req.IsCompleted)
            {
                if (sw.ElapsedMilliseconds > timeoutMs) return false;
                Thread.Sleep(25);
            }
            return true;
        }
    }
}
