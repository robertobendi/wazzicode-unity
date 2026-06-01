import { ErrorCode } from "@uvibe/core";
import { SafetyMode, UVibeConfig } from "./config.js";

export type WriteTarget = "scene" | "prefab" | "asset" | "script" | "console" | "build" | "safety";

/**
 * Explicit classification of write tools to the kind of state they mutate. Used to gate writes
 * by safetyMode and per-target flags. Mapping by exact tool name (NOT substring matching, which
 * mis-classified e.g. unity_save_scene vs unity_set_serialized_field).
 */
export const WRITE_TOOLS: Record<string, WriteTarget> = {
  unity_set_serialized_field: "scene",
  unity_add_component: "scene",
  unity_create_gameobject: "scene",
  unity_save_scene: "scene",
  unity_assign_reference: "scene",
  unity_instantiate_prefab: "scene",
  unity_create_scriptable_object: "asset",
  unity_create_material: "asset",
  unity_create_prefab_variant: "prefab",
  unity_wire_ui_button: "scene",
  unity_clear_console: "console",
  unity_build_player: "build",
  unity_create_snapshot: "safety",
  unity_restore_snapshot: "safety",
  unity_revert_last_action: "safety",
};

export interface ToolGateDecision {
  allowed: boolean;
  reason?: string;
  errorCode?: ErrorCode;
}

export function isWriteTool(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(WRITE_TOOLS, toolName);
}

export function writeTargetOf(toolName: string): WriteTarget | undefined {
  return WRITE_TOOLS[toolName];
}

/**
 * Gate a tool call. `target` may be supplied by the tool definition (preferred); otherwise it
 * is looked up from the WRITE_TOOLS table. Non-write tools are always allowed.
 */
export function gateTool(config: UVibeConfig, toolName: string, target?: WriteTarget): ToolGateDecision {
  const t = target ?? writeTargetOf(toolName);
  if (!t) return { allowed: true };
  return gateWrite(config, toolName, t);
}

export function gateWrite(config: UVibeConfig, toolName: string, target: WriteTarget): ToolGateDecision {
  switch (config.safetyMode as SafetyMode) {
    case "read_only":
      return {
        allowed: false,
        errorCode: "SAFETY_MODE_BLOCKED",
        reason: `safetyMode=read_only blocks write tool '${toolName}'. Set safetyMode to confirm or autopilot in .unity-vibe/config.json to allow writes.`,
      };
    case "suggest":
      return {
        allowed: false,
        errorCode: "SAFETY_MODE_BLOCKED",
        reason: `safetyMode=suggest only proposes changes; '${toolName}' would mutate ${target} state. Switch to confirm/autopilot to apply.`,
      };
    case "confirm":
    case "autopilot": {
      if (target === "scene" && !config.allowSceneWrites) {
        return {
          allowed: false,
          errorCode: "SAFETY_MODE_BLOCKED",
          reason: `Scene writes are disabled (allowSceneWrites=false in .unity-vibe/config.json).`,
        };
      }
      if (target === "prefab" && !config.allowPrefabWrites) {
        return {
          allowed: false,
          errorCode: "SAFETY_MODE_BLOCKED",
          reason: `Prefab writes are disabled (allowPrefabWrites=false in .unity-vibe/config.json).`,
        };
      }
      if (target === "script" && !config.allowScriptWrites) {
        return {
          allowed: false,
          errorCode: "SAFETY_MODE_BLOCKED",
          reason: `Script writes are disabled (allowScriptWrites=false in .unity-vibe/config.json).`,
        };
      }
      return { allowed: true };
    }
  }
}
