import { z, ZodRawShape } from "zod";
import { ToolEnvelope } from "@uvibe/core";
import { BridgeClient } from "./bridgeClient.js";

export interface ToolContext {
  bridge: BridgeClient;
  projectPath: string;
  configMockMode: boolean;
}

export type WriteTarget = "scene" | "prefab" | "asset" | "script" | "console" | "build" | "safety";

export interface ToolDef<TShape extends ZodRawShape = ZodRawShape, TOutput = unknown> {
  name: string;
  description: string;
  inputShape: TShape;
  /** Stable hint of what this tool needs. Used by docs and `uvibe doctor`. */
  requires: Array<"unity_bridge" | "filesystem" | "git" | "project_brain">;
  /** Mutates project state. The server gates these behind safetyMode and logs them. */
  write?: boolean;
  /** What kind of state a write tool touches; drives per-target safety flags. */
  writeTarget?: WriteTarget;
  run: (
    args: z.infer<z.ZodObject<TShape>>,
    ctx: ToolContext
  ) => Promise<ToolEnvelope<TOutput>>;
}

export type AnyToolDef = ToolDef<ZodRawShape, unknown>;
