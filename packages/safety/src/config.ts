import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_BRIDGE_PORT, DEFAULT_MCP_PORT } from "@uvibe/core";

export const SafetyModeSchema = z.enum(["read_only", "suggest", "confirm", "autopilot"]);
export type SafetyMode = z.infer<typeof SafetyModeSchema>;

export const UVibeConfigSchema = z.object({
  // Write-enabled out of the box: the whole point of Unity Vibe OS is to let Claude edit the
  // project, so the default posture is autopilot with scene/prefab/script/asset writes on.
  // The two genuine escape hatches (allowMenuItems, allowCodeExecution) stay off — they are
  // opt-in by design. Lock everything down with `uvibe autonomy off`.
  safetyMode: SafetyModeSchema.default("autopilot"),
  allowSceneWrites: z.boolean().default(true),
  allowPrefabWrites: z.boolean().default(true),
  allowScriptWrites: z.boolean().default(true),
  /** Asset creation/import (materials, ScriptableObjects, sprites, generated C# files on disk). */
  allowAssetWrites: z.boolean().default(true),
  /** unity_execute_menu_item is a generic Editor escape hatch; off unless explicitly enabled. */
  allowMenuItems: z.boolean().default(false),
  /** unity_execute_code runs arbitrary C# in the Editor; powerful and unsandboxed, so off by default
   * and intentionally NOT flipped on by `autonomy on`. Enable explicitly when you want it. */
  allowCodeExecution: z.boolean().default(false),
  /** Exact menu paths unity_execute_menu_item may run (e.g. "Assets/Refresh"). Empty = none. */
  allowedMenuItems: z.array(z.string()).default([]),
  autoSnapshot: z.boolean().default(true),
  unityProjectPath: z.string().default("."),
  mcpPort: z.number().int().default(DEFAULT_MCP_PORT),
  bridgePort: z.number().int().default(DEFAULT_BRIDGE_PORT),
  mockMode: z.boolean().default(false),
});

export type UVibeConfig = z.infer<typeof UVibeConfigSchema>;

export const DEFAULT_CONFIG: UVibeConfig = UVibeConfigSchema.parse({});

export const CONFIG_PATH_REL = ".unity-vibe/config.json";

export async function loadConfig(projectPath: string): Promise<UVibeConfig> {
  const file = path.join(projectPath, CONFIG_PATH_REL);
  try {
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    return UVibeConfigSchema.parse(json);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfigIfMissing(projectPath: string): Promise<{ written: boolean; path: string }> {
  const file = path.join(projectPath, CONFIG_PATH_REL);
  try {
    await fs.access(file);
    return { written: false, path: file };
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
    return { written: true, path: file };
  }
}

export async function writeConfig(projectPath: string, config: UVibeConfig): Promise<string> {
  const file = path.join(projectPath, CONFIG_PATH_REL);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  return file;
}
