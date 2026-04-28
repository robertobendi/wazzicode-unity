import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, ScreenshotResult } from "@uvibe/core";
import { screenshotCall } from "./_screenshot.js";

const InputShape = {
  width: z.number().int().min(64).max(3840).optional(),
  height: z.number().int().min(64).max(2160).optional(),
  cameraPath: z
    .string()
    .optional()
    .describe("Optional GameObject path of a Camera to render. Defaults to Camera.main, then any active enabled Camera."),
  save: z.boolean().optional().describe("If true (default), persist PNG to .unity-vibe/screenshots/."),
};

export const unityCaptureGameView: ToolDef<typeof InputShape, ScreenshotResult> = {
  name: "unity_capture_game_view",
  description:
    "Captures the Unity Game view (or a specified Camera) as a PNG and returns it as a multimodal image so Claude can SEE the running game. Works in edit mode (renders the main camera off-screen). Auto-saves to .unity-vibe/screenshots/ unless save=false.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    return screenshotCall(
      ctx.bridge,
      BRIDGE_METHODS.screenshotGameView,
      {
        width: args.width ?? 1280,
        height: args.height ?? 720,
        cameraPath: args.cameraPath,
      },
      ctx.projectPath,
      { save: args.save ?? true }
    );
  },
};
