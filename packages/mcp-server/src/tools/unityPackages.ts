import { z } from "zod";
import { ok } from "@uvibe/core";
import { ToolDef } from "../registry.js";
import { reportProgress } from "../interaction.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";

/**
 * Unity Package Manager (UPM) access: list resolved packages and add one. The motivating case is
 * glTFast (com.unity.cloud.gltfast) — Unity cannot import .glb/.gltf without it. Adds go through
 * UnityEditor.PackageManager.Client (never a hand-edited manifest) and accept only registry names
 * or https git URLs, never file: paths.
 */

export interface UnityPackageInfo {
  name: string;
  version: string;
  displayName?: string;
  source?: string;
  direct?: boolean;
}

export interface PackageListResult {
  count: number;
  packages: UnityPackageInfo[];
}

export interface PackageAddResult {
  applied: boolean;
  /** installed | already_installed | in_progress */
  status: string;
  name: string;
  version?: string | null;
  target?: string;
  summary: string;
  undoable?: boolean;
}

const REGISTRY_ID = /^[a-z0-9][a-z0-9._-]{0,213}(@[0-9A-Za-z.+-]{1,64})?$/;
const GIT_URL =
  /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/[A-Za-z0-9._~/-]+(\.git)?(\?path=[A-Za-z0-9._~/-]+)?(#[A-Za-z0-9._/-]+)?$/;

/** Mirrors PackageManagerBridge.IsAllowedId on the Unity side. */
export function isAllowedPackageId(id: string): boolean {
  return REGISTRY_ID.test(id) || GIT_URL.test(id);
}

const ListShape = {
  includeIndirect: z
    .boolean()
    .optional()
    .describe("Also list transitive dependencies. Default false (direct dependencies only)."),
};

export const unityListPackages: ToolDef<typeof ListShape, PackageListResult> = {
  name: "unity_list_packages",
  description:
    "Lists the project's resolved Unity packages (name, version, source) via the Package Manager — e.g. to check whether com.unity.cloud.gltfast is installed before importing a .glb. Read-only.",
  requires: ["unity_bridge"],
  inputShape: ListShape,
  async run(args, ctx) {
    return bridgeCall<PackageListResult>(ctx.bridge, BRIDGE_METHODS.packageList, {
      includeIndirect: args.includeIndirect ?? false,
    });
  },
};

const AddShape = {
  id: z
    .string()
    .refine(isAllowedPackageId, {
      message: "Use a registry name (com.vendor.pkg, optionally @version) or an https git URL.",
    })
    .describe(
      "Package to add: a registry name ('com.unity.cloud.gltfast'), optionally pinned ('com.unity.cloud.gltfast@6.20.0'), or an https git URL. A bare name that is already installed is left as is."
    ),
  waitMs: z
    .number()
    .int()
    .min(0)
    .max(600_000)
    .optional()
    .describe("How long to wait for Unity to finish resolving the package (default 180000). 0 returns right after the request."),
};

const POLL_MS = 3000;

export const unityAddPackage: ToolDef<typeof AddShape, PackageAddResult> = {
  name: "unity_add_package",
  description:
    "Adds a Unity package through the Package Manager (Client.Add), e.g. com.unity.cloud.gltfast so .glb/.gltf files import. Waits until the package resolves (downloads can take a minute or more), then Unity recompiles — follow with unity_wait_for_compile. Registry names or https git URLs only. Gated by safetyMode (confirm/autopilot; asset target).",
  requires: ["unity_bridge"],
  write: true,
  writeTarget: "asset",
  inputShape: AddShape,
  async run(args, ctx) {
    let step = 0;
    reportProgress(ctx, ++step, undefined, `adding ${args.id}…`);
    const started = await bridgeCall<PackageAddResult>(ctx.bridge, BRIDGE_METHODS.packageAdd, { id: args.id });
    if (!started.ok || started.data.status !== "in_progress") return started;

    // Only a registry id tells us the package name to look for; git URLs resolve to a name we
    // can't predict, so report the pending request as-is.
    const waitMs = args.waitMs ?? 180_000;
    const name = args.id.startsWith("https://") ? null : args.id.split("@")[0];
    if (!name || waitMs === 0) return started;

    const deadline = Date.now() + waitMs;
    let lastProblem: string | undefined;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      reportProgress(ctx, ++step, undefined, `waiting for Unity to resolve ${name}…`);
      // A freshly added package triggers an import + domain reload; bridgeCall rides through
      // UNITY_RELOADING, and any other transient failure just means "poll again".
      const listed = await bridgeCall<PackageListResult>(ctx.bridge, BRIDGE_METHODS.packageList, {
        includeIndirect: false,
      });
      if (!listed.ok) {
        lastProblem = `${listed.error.code}: ${listed.error.message}`;
        continue;
      }
      const hit = listed.data.packages.find((p) => p.name === name);
      if (hit) {
        return ok<PackageAddResult>(
          {
            ...started.data,
            status: "installed",
            name: hit.name,
            version: hit.version,
            summary: `Added ${hit.name}@${hit.version}. Unity imports and recompiles next; call unity_wait_for_compile before using it.`,
          },
          started.meta
        );
      }
    }
    return {
      ...started,
      warnings: [
        ...started.warnings,
        `Still resolving after ${Math.round(waitMs / 1000)}s; check again with unity_list_packages.` +
          (lastProblem ? ` Last poll: ${lastProblem}` : ""),
      ],
    };
  },
};
