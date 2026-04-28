import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, ScreenshotResult } from "@uvibe/core";
import { screenshotCall } from "./_screenshot.js";

const InputShape = {
  width: z.number().int().min(64).max(3840).optional(),
  height: z.number().int().min(64).max(2160).optional(),
  save: z.boolean().optional(),
};

export const unityCaptureSceneView: ToolDef<typeof InputShape, ScreenshotResult> = {
  name: "unity_capture_scene_view",
  description:
    "Captures the Unity Scene view (the editor's authoring camera) as a PNG and returns it as a multimodal image. Useful when the user is arranging objects in the editor and asks 'how does this look?'. Returns OBJECT_NOT_FOUND if no SceneView is open.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    return screenshotCall(
      ctx.bridge,
      BRIDGE_METHODS.screenshotSceneView,
      {
        width: args.width ?? 1024,
        height: args.height ?? 640,
      },
      ctx.projectPath,
      { save: args.save ?? true }
    );
  },
};
