import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { confirmWithUser } from "../interaction.js";

/**
 * Scene navigation. These are intentionally NOT write tools: opening a scene is how Claude
 * traverses the project independently, so it remains a non-mutating operation. The bridge
 * still refuses to discard unsaved changes unless `discardUnsavedChanges` is set, so navigating
 * can never silently lose work (it returns UNSAVED_CHANGES with the dirty scene list instead).
 */

const OpenSceneShape = {
  scenePath: z.string().describe("Project-relative scene path, e.g. 'Assets/Scenes/Level1.unity'."),
  discardUnsavedChanges: z
    .boolean()
    .optional()
    .describe("Abandon unsaved changes in currently open scenes. Default false → refuses with UNSAVED_CHANGES if anything is dirty."),
};

export const unityOpenScene: ToolDef<typeof OpenSceneShape, unknown> = {
  name: "unity_open_scene",
  description:
    "Opens a scene in single mode (closing the current scenes), so Claude can traverse the project without you switching scenes by hand. Refuses to discard unsaved changes unless discardUnsavedChanges:true (returns UNSAVED_CHANGES listing the dirty scenes). Returns the resulting open-scenes summary. Not gated — works in read_only.",
  requires: ["unity_bridge"],
  inputShape: OpenSceneShape,
  async run(args, ctx) {
    const discard = args.discardUnsavedChanges ?? false;
    const opened = await bridgeCall(ctx.bridge, BRIDGE_METHODS.sceneOpen, {
      scenePath: args.scenePath,
      discardUnsavedChanges: discard,
    });
    if (opened.ok || discard || opened.error.code !== "UNSAVED_CHANGES") return opened;

    // The dirty scenes are the user's unsaved work, so only the user can authorise discarding
    // them. Ask when the client can ask; otherwise the UNSAVED_CHANGES envelope stands unchanged.
    const dirty = dirtySceneList(opened.error.details);
    const decision = await confirmWithUser(ctx, {
      message: `Opening ${args.scenePath} would discard unsaved changes in ${dirty}. Discard and open it?`,
      field: "discard",
      fieldTitle: "Discard unsaved changes",
      fieldDescription: `Unsaved edits in ${dirty} will be lost. Choose no to keep them and cancel the scene switch.`,
    });
    if (decision !== "accept") return opened;

    return bridgeCall(ctx.bridge, BRIDGE_METHODS.sceneOpen, {
      scenePath: args.scenePath,
      discardUnsavedChanges: true,
    });
  },
};

function dirtySceneList(details: Record<string, unknown> | undefined): string {
  const scenes = details?.dirtyScenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return "the open scene(s)";
  return scenes.map(String).join(", ");
}

const LoadAdditiveShape = {
  scenePath: z.string().describe("Project-relative scene path to load additively alongside the open scenes."),
};

export const unityLoadSceneAdditive: ToolDef<typeof LoadAdditiveShape, unknown> = {
  name: "unity_load_scene_additive",
  description:
    "Loads a scene additively (kept open alongside the current scenes) — useful for multi-scene setups or comparing two scenes. Additive loading never discards unsaved work. Returns the resulting open-scenes summary. Not gated — works in read_only.",
  requires: ["unity_bridge"],
  inputShape: LoadAdditiveShape,
  async run(args, ctx) {
    return bridgeCall(ctx.bridge, BRIDGE_METHODS.sceneLoadAdditive, {
      scenePath: args.scenePath,
    });
  },
};
