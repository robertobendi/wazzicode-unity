import { z } from "zod";
import { loadConfig } from "@uvibe/safety";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall, err } from "./_helpers.js";

/**
 * Generic Editor escape hatch: run a menu command by its path. This can do almost anything, so it
 * is doubly gated — the server's safety gate blocks it unless allowMenuItems is on, and this tool
 * additionally requires the exact path to be present in `allowedMenuItems`. The allowlist lives in
 * .unity-vibe/config.json (TS side), so it is enforced here rather than in Unity. Skipped in mock
 * mode for deterministic verification.
 */

const ExecuteMenuItemShape = {
  menuItem: z
    .string()
    .describe("Exact menu path, e.g. 'Assets/Refresh' or 'GameObject/Align With View'. Must be in allowedMenuItems."),
};

export const unityExecuteMenuItem: ToolDef<typeof ExecuteMenuItemShape, unknown> = {
  name: "unity_execute_menu_item",
  description:
    "Runs an Editor menu command by path (EditorApplication.ExecuteMenuItem) — a generic escape hatch for any Editor command without a dedicated tool. Doubly gated: needs allowMenuItems=true AND the exact path listed in allowedMenuItems in .unity-vibe/config.json, else returns MENU_ITEM_NOT_ALLOWED.",
  requires: ["unity_bridge"],
  write: true,
  writeTarget: "editor",
  inputShape: ExecuteMenuItemShape,
  async run(args, ctx) {
    if (!ctx.configMockMode) {
      const config = await loadConfig(ctx.projectPath);
      const allowed = new Set(config.allowedMenuItems ?? []);
      if (!config.allowMenuItems || !allowed.has(args.menuItem)) {
        return err(
          "MENU_ITEM_NOT_ALLOWED",
          `Menu item '${args.menuItem}' is not allowed. Add it to allowedMenuItems (and set allowMenuItems:true) in .unity-vibe/config.json.`,
          { source: ctx.bridge.source },
          { menuItem: args.menuItem, allowed: [...allowed] }
        );
      }
    }
    return bridgeCall(ctx.bridge, BRIDGE_METHODS.editorExecuteMenuItem, { menuItem: args.menuItem });
  },
};
