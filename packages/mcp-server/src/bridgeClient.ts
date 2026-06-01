import { readFileSync } from "node:fs";
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
  timeoutMs?: number;
  /**
   * Project root. When set (and no explicit port given), the client reads
   * Library/UnityVibeOS/bridge.json to learn the actual bound port and to verify it is
   * talking to the right Unity Editor instance.
   */
  projectPath?: string;
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
  const timeoutMs = opts.timeoutMs ?? 5000;

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

  async function call<T>(
    method: BridgeMethod,
    params: Record<string, unknown> = {}
  ): Promise<BridgeResponse<T>> {
    const body = makeBridgeRequest(method, params);
    const t = target();
    const baseUrl = `http://${t.host}:${t.port}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          id: body.id,
          ok: false,
          result: null,
          error: {
            code: "UNITY_NOT_CONNECTED",
            message: `Unity bridge HTTP ${res.status}: ${text.slice(0, 200)}`,
          },
          meta: {},
        };
      }
      let parsed: BridgeResponse<T>;
      try {
        parsed = JSON.parse(text) as BridgeResponse<T>;
      } catch {
        return {
          id: body.id,
          ok: false,
          result: null,
          error: {
            code: "MALFORMED_BRIDGE_RESPONSE",
            message: `Bridge returned non-JSON payload (length=${text.length}).`,
            details: { sample: text.slice(0, 200) },
          },
          meta: {},
        };
      }
      // Identity guard: the Editor that answered must be the project Claude works in.
      if (parsed.ok && t.expectProject && parsed.meta?.projectPath) {
        if (!samePath(parsed.meta.projectPath, t.expectProject)) {
          return {
            id: body.id,
            ok: false,
            result: null,
            error: {
              code: "PROJECT_IDENTITY_MISMATCH",
              message: `Connected Unity is '${parsed.meta.projectPath}' but expected '${t.expectProject}'.`,
            },
            meta: parsed.meta,
          };
        }
      }
      return parsed;
    } catch (e: unknown) {
      const errLike = e as { name?: string; message?: string };
      if (errLike?.name === "AbortError") {
        return {
          id: body.id,
          ok: false,
          result: null,
          error: { code: "BRIDGE_TIMEOUT", message: errLike?.message ?? "Bridge call timed out." },
          meta: {},
        };
      }
      // Connection refused. If a discovery file exists, the bridge lives here but its socket
      // is briefly down — almost always a script-domain reload (post-compile / entering play).
      // Surface that as the recoverable UNITY_RELOADING so callers retry instead of giving up.
      const code = t.bridgeKnown ? "UNITY_RELOADING" : "UNITY_NOT_CONNECTED";
      return {
        id: body.id,
        ok: false,
        result: null,
        error: { code, message: errLike?.message ?? "Bridge call failed." },
        meta: {},
      };
    } finally {
      clearTimeout(timer);
    }
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
