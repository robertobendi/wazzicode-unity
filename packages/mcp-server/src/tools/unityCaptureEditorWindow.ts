import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, ScreenshotResult } from "@uvibe/core";
import { screenshotCall } from "./_screenshot.js";

const InputShape = {
  maxWidth: z
    .number()
    .int()
    .min(64)
    .max(7680)
    .optional()
    .describe(
      "If set, downscale so the window's longest side is at most this many pixels (preserves aspect). Omit/0 to capture at native resolution."
    ),
  save: z.boolean().optional().describe("If true (default), persist PNG to .unity-vibe/screenshots/."),
};

export const unityCaptureEditorWindow: ToolDef<typeof InputShape, ScreenshotResult> = {
  name: "unity_capture_editor_window",
  description:
    "Captures the WHOLE Unity Editor main window — every docked panel (toolbar, Hierarchy, Scene/Game view, Inspector, Project, Console) exactly as it appears on screen — as a PNG and returns it as a multimodal image so Claude can SEE the editor itself. Unlike unity_capture_game_view/scene_view (which render a camera off-screen), this reads the OS framebuffer. Auto-saves to .unity-vibe/screenshots/ unless save=false.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    return screenshotCall(
      ctx.bridge,
      BRIDGE_METHODS.screenshotEditorWindow,
      {
        maxWidth: args.maxWidth ?? 0,
      },
      ctx.projectPath,
      { save: args.save ?? true }
    );
  },
};
