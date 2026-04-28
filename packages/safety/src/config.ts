import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_BRIDGE_PORT, DEFAULT_MCP_PORT } from "@uvibe/core";

export const SafetyModeSchema = z.enum(["read_only", "suggest", "confirm", "autopilot"]);
export type SafetyMode = z.infer<typeof SafetyModeSchema>;

export const UVibeConfigSchema = z.object({
  safetyMode: SafetyModeSchema.default("read_only"),
  maxLoopIterations: z.number().int().min(1).max(50).default(5),
  allowSceneWrites: z.boolean().default(false),
  allowPrefabWrites: z.boolean().default(false),
  allowScriptWrites: z.boolean().default(true),
  autoSnapshot: z.boolean().default(true),
  unityProjectPath: z.string().default("."),
  mcpPort: z.number().int().default(DEFAULT_MCP_PORT),
  bridgePort: z.number().int().default(DEFAULT_BRIDGE_PORT),
  enableDashboard: z.boolean().default(false),
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
