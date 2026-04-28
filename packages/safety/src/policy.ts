import { ErrorCode } from "@uvibe/core";
import { SafetyMode, UVibeConfig } from "./config.js";

/**
 * Categorize tools as read-only or write. Used to gate write tools by safetyMode.
 * Write tools are NOT exposed in MVP — kept here so safety logic is ready when they ship.
 */
export const WRITE_TOOLS = new Set<string>([
  "unity_create_gameobject",
  "unity_add_component",
  "unity_set_serialized_field",
  "unity_assign_reference",
  "unity_create_scriptable_object",
  "unity_create_material",
  "unity_instantiate_prefab",
  "unity_create_prefab_variant",
  "unity_wire_ui_button",
  "unity_save_scene",
  "unity_clear_console",
  "unity_create_snapshot",
  "unity_restore_snapshot",
  "unity_revert_last_action",
  "unity_build_player",
]);

export interface ToolGateDecision {
  allowed: boolean;
  reason?: string;
  errorCode?: ErrorCode;
}

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function gateTool(config: UVibeConfig, toolName: string): ToolGateDecision {
  if (!isWriteTool(toolName)) return { allowed: true };
  return gateWrite(config, toolName);
}

export function gateWrite(config: UVibeConfig, toolName: string): ToolGateDecision {
  switch (config.safetyMode as SafetyMode) {
    case "read_only":
      return {
        allowed: false,
        errorCode: "SAFETY_MODE_BLOCKED",
        reason: `safetyMode=read_only blocks write tool '${toolName}'. Update .unity-vibe/config.json to suggest/confirm/autopilot.`,
      };
    case "suggest":
      return {
        allowed: false,
        errorCode: "SAFETY_MODE_BLOCKED",
        reason: `safetyMode=suggest only proposes changes; '${toolName}' would mutate state.`,
      };
    case "confirm":
    case "autopilot": {
      // Per-tool flags
      if (toolName.includes("scene") && !config.allowSceneWrites) {
        return {
          allowed: false,
          errorCode: "SAFETY_MODE_BLOCKED",
          reason: `Scene writes are disabled (allowSceneWrites=false).`,
        };
      }
      if (toolName.includes("prefab") && !config.allowPrefabWrites) {
        return {
          allowed: false,
          errorCode: "SAFETY_MODE_BLOCKED",
          reason: `Prefab writes are disabled (allowPrefabWrites=false).`,
        };
      }
      return { allowed: true };
    }
  }
}
