import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { PlayModeStatus, ToolEnvelope } from "@uvibe/core";

const EnterShape = {
  /** Poll until play mode is fully entered (rides through the domain reload). */
  waitForReady: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(120_000).optional(),
};

export const unityEnterPlayMode: ToolDef<typeof EnterShape, PlayModeStatus> = {
  name: "unity_enter_play_mode",
  description:
    "Enters Unity play mode. Entering play mode reloads the C# domain, so the bridge briefly drops and reconnects automatically. With waitForReady (default true) the tool polls until the game is actually running before returning. Pair with unity_get_console_logs / unity_get_performance_stats / unity_find_runtime_objects to observe runtime behaviour, then unity_exit_play_mode.",
  requires: ["unity_bridge"],
  inputShape: EnterShape,
  async run(args, ctx) {
    const wait = args.waitForReady ?? true;
    const enter = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeEnter);
    if (!enter.ok || !wait || ctx.configMockMode) return enter;
    return pollUntil(ctx, (s) => s.isPlaying === true, args.timeoutMs ?? 30_000, enter);
  },
};

const ExitShape = {
  waitForReady: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(120_000).optional(),
};

export const unityExitPlayMode: ToolDef<typeof ExitShape, PlayModeStatus> = {
  name: "unity_exit_play_mode",
  description:
    "Exits Unity play mode and returns to edit mode. Like entering, this reloads the domain; with waitForReady (default true) the tool waits until play mode has fully stopped.",
  requires: ["unity_bridge"],
  inputShape: ExitShape,
  async run(args, ctx) {
    const wait = args.waitForReady ?? true;
    const exit = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeExit);
    if (!exit.ok || !wait || ctx.configMockMode) return exit;
    return pollUntil(ctx, (s) => s.isPlaying === false, args.timeoutMs ?? 30_000, exit);
  },
};

const StepShape = {
  frames: z.number().int().min(1).max(120).optional(),
};

export const unityStepFrame: ToolDef<typeof StepShape, PlayModeStatus> = {
  name: "unity_step_frame",
  description:
    "Advances play mode by one frame (or `frames` frames), pausing the game. Requires play mode to be active. Useful to deterministically step through runtime behaviour between inspections.",
  requires: ["unity_bridge"],
  inputShape: StepShape,
  async run(args, ctx) {
    const frames = args.frames ?? 1;
    let last: ToolEnvelope<PlayModeStatus> | undefined;
    for (let i = 0; i < frames; i++) {
      last = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStep);
      if (!last.ok) return last;
    }
    return last!;
  },
};

const StatusShape = {};

export const unityGetPlayModeStatus: ToolDef<typeof StatusShape, PlayModeStatus> = {
  name: "unity_get_play_mode_status",
  description:
    "Returns whether the Editor is currently in play mode, paused, or transitioning, plus the current frame count when running.",
  requires: ["unity_bridge"],
  inputShape: StatusShape,
  async run(_args, ctx) {
    return bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStatus);
  },
};

async function pollUntil(
  ctx: Parameters<ToolDef<typeof EnterShape, PlayModeStatus>["run"]>[1],
  predicate: (s: PlayModeStatus) => boolean,
  timeoutMs: number,
  fallback: ToolEnvelope<PlayModeStatus>
): Promise<ToolEnvelope<PlayModeStatus>> {
  const start = Date.now();
  let last = fallback;
  while (Date.now() - start < timeoutMs) {
    const s = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStatus);
    if (s.ok) {
      last = s;
      if (predicate(s.data)) return s;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (last.ok) last.warnings.push(`Timed out after ${timeoutMs}ms waiting for play-mode transition.`);
  return last;
}
