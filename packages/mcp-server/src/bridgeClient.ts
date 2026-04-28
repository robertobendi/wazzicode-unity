import {
  BridgeMethod,
  BridgeResponse,
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
  port?: number;
  timeoutMs?: number;
}

export function createHttpBridgeClient(opts: HttpBridgeOptions = {}): BridgeClient {
  const host = opts.host ?? DEFAULT_BRIDGE_HOST;
  const port = opts.port ?? DEFAULT_BRIDGE_PORT;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const baseUrl = `http://${host}:${port}`;

  async function call<T>(
    method: BridgeMethod,
    params: Record<string, unknown> = {}
  ): Promise<BridgeResponse<T>> {
    const body = makeBridgeRequest(method, params);
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
      try {
        return JSON.parse(text) as BridgeResponse<T>;
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
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      const code = err?.name === "AbortError" ? "BRIDGE_TIMEOUT" : "UNITY_NOT_CONNECTED";
      return {
        id: body.id,
        ok: false,
        result: null,
        error: {
          code,
          message: err?.message ?? "Bridge call failed.",
        },
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
