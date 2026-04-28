import { z, ZodRawShape } from "zod";
import { ToolEnvelope } from "@uvibe/core";
import { BridgeClient } from "./bridgeClient.js";

export interface ToolContext {
  bridge: BridgeClient;
  projectPath: string;
  configMockMode: boolean;
}

export interface ToolDef<TShape extends ZodRawShape = ZodRawShape, TOutput = unknown> {
  name: string;
  description: string;
  inputShape: TShape;
  /** Stable hint of what this tool needs. Used by docs and `uvibe doctor`. */
  requires: Array<"unity_bridge" | "filesystem" | "git" | "project_brain">;
  run: (
    args: z.infer<z.ZodObject<TShape>>,
    ctx: ToolContext
  ) => Promise<ToolEnvelope<TOutput>>;
}

export type AnyToolDef = ToolDef<ZodRawShape, unknown>;
