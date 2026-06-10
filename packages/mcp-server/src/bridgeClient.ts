import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  BridgeDiscovery,
  BridgeMethod,
  BridgeResponse,
  BRIDGE_DISCOVERY_REL,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  makeBridgeRequest,
} from "@uvibe/core";

export type BridgeSource = "unity_bridge" | "mock";

export interface BridgeClient {
  readonly source: BridgeSource;
  call<T = unknown>(method: BridgeMethod, params?: Record<string, unknown>): Promise<BridgeResponse<T>>;
  isConnected(): Promise<boolean>;
}

export interface HttpBridgeOptions {
  host?: string;
  /** Explicit port. When set, discovery is skipped (used by tests and manual overrides). */
  port?: number;
  /**
   * Force a single timeout for every call, overriding the per-method budget. Mainly for tests
   * (e.g. timeoutMs:500 against an unbound port). In normal operation leave this unset so each
   * method gets a budget that matches what the Unity side actually allows it (see timeoutForMethod).
   */
  timeoutMs?: number;
  /**
   * Project root. When set (and no explicit port given), the client reads
   * Library/UnityVibeOS/bridge.json to learn the actual bound port and to verify it is
   * talking to the right Unity Editor instance.
   */
  projectPath?: string;
}

/**
 * Per-method client-side timeout, in milliseconds. The Unity bridge gives each method its own
 * main-thread budget (BridgeServer.TimeoutFor) — up to 120s for asset-graph scans and 60s for
 * play-mode transitions — and returns its own BRIDGE_TIMEOUT at that budget. A flat 5s client
 * timeout would abort those calls long before Unity finished, so we mirror the server budgets
 * here with a few seconds of network slack on top. Anything not listed gets a safe default.
 */
const METHOD_TIMEOUT_MS: Record<string, number> = {
  // Asset / reference-graph scans walk the whole AssetDatabase.
  "asset.findReferences": 125_000,
  "asset.findDependencies": 125_000,
  "asset.findMissingScripts": 125_000,
  "asset.findMissingReferences": 125_000,
  // Play-mode transitions trigger a domain reload / scene (un)load.
  "playmode.enter": 65_000,
  "playmode.exit": 65_000,
  // Long-poll awaits hold the HTTP request open server-side for up to 25s per round.
  "compile.await": 30_000,
  "playmode.await": 30_000,
  "test.await": 30_000,
  // Multi-frame stepping long-polls in the same way.
  "playmode.step": 30_000,
  // Test runner kicks off an async job; the polling tool calls these repeatedly.
  "test.run": 35_000,
  "test.status": 35_000,
  // Script edits and in-Editor code execution can trigger an import / compile.
  "script.create": 40_000,
  "script.applyEdits": 40_000,
  "script.applyStructuredEdits": 40_000,
  "code.execute": 60_000,
};

const DEFAULT_TIMEOUT_MS = 20_000;

export function timeoutForMethod(method: string): number {
  return METHOD_TIMEOUT_MS[method] ?? DEFAULT_TIMEOUT_MS;
}

function readDiscovery(projectPath: string): BridgeDiscovery | null {
  try {
    const raw = readFileSync(path.join(projectPath, BRIDGE_DISCOVERY_REL), "utf8");
    const d = JSON.parse(raw) as Partial<BridgeDiscovery>;
    if (typeof d.port === "number" && d.port > 0) {
      return {
        port: d.port,
        host: d.host ?? DEFAULT_BRIDGE_HOST,
        projectPath: d.projectPath ?? projectPath,
        unityVersion: d.unityVersion ?? "",
        pid: d.pid ?? 0,
        protocolVersion: d.protocolVersion ?? "",
        startedAt: d.startedAt ?? 0,
      };
    }
  } catch {
    // No discovery file — Unity bridge has never started here, or this isn't a project root.
  }
  return null;
}

export function createHttpBridgeClient(opts: HttpBridgeOptions = {}): BridgeClient {
  const explicitPort = opts.port;
  const projectPath = opts.projectPath;
  // An explicit timeoutMs forces one budget for every call (tests). Otherwise each method gets
  // its own budget via timeoutForMethod, resolved per call below.
  const forcedTimeoutMs = opts.timeoutMs;

  // One keep-alive agent per client: the MCP server makes a steady stream of small RPC calls to
  // the same localhost bridge, so reusing TCP connections removes a connect/handshake per call.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 1000 });

  let cached: { at: number; disco: BridgeDiscovery | null } | null = null;
  function discovery(): BridgeDiscovery | null {
    if (explicitPort !== undefined || !projectPath) return null;
    const now = Date.now();
    if (cached && now - cached.at < 1000) return cached.disco;
    const disco = readDiscovery(projectPath);
    cached = { at: now, disco };
    return disco;
  }

  function target(): { host: string; port: number; expectProject?: string; bridgeKnown: boolean } {
    const disco = discovery();
    if (explicitPort !== undefined) {
      return { host: opts.host ?? DEFAULT_BRIDGE_HOST, port: explicitPort, bridgeKnown: false };
    }
    if (disco) {
      return { host: disco.host, port: disco.port, expectProject: disco.projectPath, bridgeKnown: true };
    }
    return { host: opts.host ?? DEFAULT_BRIDGE_HOST, port: opts.port ?? DEFAULT_BRIDGE_PORT, bridgeKnown: false };
  }

  function call<T>(
    method: BridgeMethod,
    params: Record<string, unknown> = {}
  ): Promise<BridgeResponse<T>> {
    const body = makeBridgeRequest(method, params);
    const payload = JSON.stringify(body);
    const t = target();
    const timeoutMs = forcedTimeoutMs ?? timeoutForMethod(method);

    return new Promise<BridgeResponse<T>>((resolve) => {
      let settled = false;
      let timedOut = false;
      const finish = (r: BridgeResponse<T>) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      const req = http.request(
        {
          host: t.host,
          port: t.port,
          path: "/rpc",
          method: "POST",
          agent,
          timeout: timeoutMs,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            connection: "keep-alive",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              finish({
                id: body.id,
                ok: false,
                result: null,
                error: {
                  code: "UNITY_NOT_CONNECTED",
                  message: `Unity bridge HTTP ${status}: ${text.slice(0, 200)}`,
                },
                meta: {},
              });
              return;
            }
            let parsed: BridgeResponse<T>;
            try {
              parsed = JSON.parse(text) as BridgeResponse<T>;
            } catch {
              finish({
                id: body.id,
                ok: false,
                result: null,
                error: {
                  code: "MALFORMED_BRIDGE_RESPONSE",
                  message: `Bridge returned non-JSON payload (length=${text.length}).`,
                  details: { sample: text.slice(0, 200) },
                },
                meta: {},
              });
              return;
            }
            // Identity guard: the Editor that answered must be the project Claude works in.
            if (parsed.ok && t.expectProject && parsed.meta?.projectPath) {
              if (!samePath(parsed.meta.projectPath, t.expectProject)) {
                finish({
                  id: body.id,
                  ok: false,
                  result: null,
                  error: {
                    code: "PROJECT_IDENTITY_MISMATCH",
                    message: `Connected Unity is '${parsed.meta.projectPath}' but expected '${t.expectProject}'.`,
                  },
                  meta: parsed.meta,
                });
                return;
              }
            }
            finish(parsed);
          });
        }
      );

      req.on("timeout", () => {
        timedOut = true;
        req.destroy();
      });

      req.on("error", (e: NodeJS.ErrnoException) => {
        if (timedOut) {
          finish({
            id: body.id,
            ok: false,
            result: null,
            error: { code: "BRIDGE_TIMEOUT", message: `Bridge call timed out after ${timeoutMs}ms.` },
            meta: {},
          });
          return;
        }
        // Connection refused. If a discovery file exists, the bridge lives here but its socket
        // is briefly down — almost always a script-domain reload (post-compile / entering play).
        // Surface that as the recoverable UNITY_RELOADING so callers retry instead of giving up.
        const code = t.bridgeKnown ? "UNITY_RELOADING" : "UNITY_NOT_CONNECTED";
        finish({
          id: body.id,
          ok: false,
          result: null,
          error: { code, message: e?.message ?? "Bridge call failed." },
          meta: {},
        });
      });

      req.write(payload);
      req.end();
    });
  }

  async function isConnected(): Promise<boolean> {
    const res = await call("system.health");
    return res.ok;
  }

  return { source: "unity_bridge", call, isConnected };
}

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => path.resolve(s).replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}
