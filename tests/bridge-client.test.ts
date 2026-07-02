import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  bridgeCall,
  createHttpBridgeClient,
  readBridgeDiscovery,
  type BridgeClient,
} from "@uvibe/bridge-client";
import { BRIDGE_DISCOVERY_REL, type BridgeMethod, type BridgeResponse } from "@uvibe/core";

const tmpDirs: string[] = [];
function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "uvibe-bridge-client-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe("bridge-client", () => {
  it("returns UNITY_NOT_CONNECTED against an unbound port (no discovery file)", async () => {
    const client = createHttpBridgeClient({ port: 39999, timeoutMs: 500 });
    const res = await client.call("system.health");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNITY_NOT_CONNECTED");
    expect(await client.isConnected()).toBe(false);
  });

  it("readBridgeDiscovery parses a valid discovery file and fills defaults", () => {
    const project = tmpProject();
    const discoPath = path.join(project, BRIDGE_DISCOVERY_REL);
    mkdirSync(path.dirname(discoPath), { recursive: true });
    writeFileSync(discoPath, JSON.stringify({ port: 40123, unityVersion: "6000.0.1f1" }), "utf8");

    const disco = readBridgeDiscovery(project);
    expect(disco).not.toBeNull();
    expect(disco?.port).toBe(40123);
    expect(disco?.host).toBe("127.0.0.1");
    expect(disco?.projectPath).toBe(project);
    expect(disco?.unityVersion).toBe("6000.0.1f1");
  });

  it("readBridgeDiscovery returns null for missing, invalid, or portless files", () => {
    const project = tmpProject();
    expect(readBridgeDiscovery(project)).toBeNull();

    const discoPath = path.join(project, BRIDGE_DISCOVERY_REL);
    mkdirSync(path.dirname(discoPath), { recursive: true });
    writeFileSync(discoPath, "not json", "utf8");
    expect(readBridgeDiscovery(project)).toBeNull();

    writeFileSync(discoPath, JSON.stringify({ host: "127.0.0.1" }), "utf8");
    expect(readBridgeDiscovery(project)).toBeNull();
  });

  it("bridgeCall retries through UNITY_RELOADING and succeeds once the bridge is back", async () => {
    let calls = 0;
    const fake: BridgeClient = {
      source: "unity_bridge",
      async call<T>(method: BridgeMethod): Promise<BridgeResponse<T>> {
        calls += 1;
        if (calls < 3) {
          return {
            id: "t",
            ok: false,
            result: null,
            error: { code: "UNITY_RELOADING", message: "socket down (domain reload)" },
            meta: {},
          };
        }
        return {
          id: "t",
          ok: true,
          result: { method } as T,
          error: null,
          meta: { unityVersion: "6000.0.1f1", projectPath: "/p", durationMs: 1 },
        };
      },
      async isConnected() {
        return true;
      },
    };

    const env = await bridgeCall<{ method: string }>(fake, "system.health");
    expect(calls).toBe(3);
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.data.method).toBe("system.health");
  });

  it("bridgeCall surfaces a terminal error without retrying", async () => {
    let calls = 0;
    const fake: BridgeClient = {
      source: "unity_bridge",
      async call<T>(): Promise<BridgeResponse<T>> {
        calls += 1;
        return {
          id: "t",
          ok: false,
          result: null,
          error: { code: "UNITY_NOT_CONNECTED", message: "no editor" },
          meta: {},
        };
      },
      async isConnected() {
        return false;
      },
    };
    const env = await bridgeCall(fake, "system.health");
    expect(calls).toBe(1);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("UNITY_NOT_CONNECTED");
  });

  it("stays MCP-SDK-free: package depends only on @uvibe/core", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, "..", "packages", "bridge-client", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@uvibe/core"]);
  });
});
