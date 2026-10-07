import { describe, it, expect, vi, afterEach } from "vitest";
import type { BridgeMethod, BridgeResponse } from "@uvibe/core";
import type { BridgeClient } from "@uvibe/mcp-server";
import { createMockBridgeClient } from "@uvibe/mcp-server";
import {
  isAllowedPackageId,
  unityAddPackage,
  unityListPackages,
} from "../packages/mcp-server/src/tools/unityPackages.js";

describe("mcp/unity packages", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts registry names and https git URLs, never file: or ssh sources", () => {
    expect(isAllowedPackageId("com.unity.cloud.gltfast")).toBe(true);
    expect(isAllowedPackageId("com.unity.cloud.gltfast@6.20.0")).toBe(true);
    expect(isAllowedPackageId("https://github.com/atteneder/glTFast.git#v6.0.0")).toBe(true);
    expect(isAllowedPackageId("file:../evil")).toBe(false);
    expect(isAllowedPackageId("git@github.com:a/b.git")).toBe(false);
    expect(isAllowedPackageId("com.unity.x; rm -rf /")).toBe(false);
    expect(isAllowedPackageId("")).toBe(false);
  });

  it("lists and adds through the mock bridge", async () => {
    const ctx = { bridge: createMockBridgeClient(), projectPath: process.cwd(), configMockMode: true };
    const listed = await unityListPackages.run({}, ctx);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data.packages.some((p) => p.name === "com.unity.cloud.gltfast")).toBe(true);
    const added = await unityAddPackage.run({ id: "com.unity.cloud.gltfast@6.20.0" }, ctx);
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.data).toMatchObject({ status: "installed", version: "6.20.0" });
  });

  it("polls the package list until an in-progress add resolves", async () => {
    vi.useFakeTimers();
    let listCalls = 0;
    const reply = <T>(result: unknown): BridgeResponse<T> => ({ id: "t", ok: true, result: result as T, meta: {} });
    const bridge: BridgeClient = {
      source: "unity_bridge",
      async call<T>(method: BridgeMethod): Promise<BridgeResponse<T>> {
        if (method === "package.add") {
          return reply<T>({ applied: true, status: "in_progress", name: "com.unity.cloud.gltfast", summary: "requested" });
        }
        if (method === "package.list") {
          listCalls++;
          const packages = listCalls >= 2 ? [{ name: "com.unity.cloud.gltfast", version: "6.20.0" }] : [];
          return reply<T>({ count: packages.length, packages });
        }
        throw new Error(`unexpected ${method}`);
      },
      async isConnected() {
        return true;
      },
    };
    const pending = unityAddPackage.run(
      { id: "com.unity.cloud.gltfast" },
      { bridge, projectPath: process.cwd(), configMockMode: false }
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ status: "installed", version: "6.20.0" });
    expect(listCalls).toBe(2);
  });
});
