import { z } from "zod";
import { ToolDef, ToolContext } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall, isUnknownMethodError } from "./_helpers.js";
import { PlayModeStatus, ToolEnvelope } from "@uvibe/core";

/** Single long-poll round is capped server-side; re-issue until our own deadline. */
const AWAIT_WINDOW_MS = 25_000;

const EnterShape = {
  /** Poll until play mode is fully entered (rides through the domain reload). */
  waitForReady: z.boolean().optional(),
  timeoutMs: z.number().int().min(500).max(120_000).optional(),
};

export const unityEnterPlayMode: ToolDef<typeof EnterShape, PlayModeStatus> = {
  name: "unity_enter_play_mode",
  description:
    "Enters Unity play mode. Entering play mode reloads the C# domain, so the bridge briefly drops and reconnects automatically. With waitForReady (default true) the tool waits (server-side long-poll) until the game is actually running before returning. Pair with unity_get_console_logs / unity_get_performance_stats / unity_find_runtime_objects to observe runtime behaviour, then unity_exit_play_mode.",
  requires: ["unity_bridge"],
  inputShape: EnterShape,
  async run(args, ctx) {
    const wait = args.waitForReady ?? true;
    const enter = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeEnter);
    if (!enter.ok || !wait || ctx.configMockMode) return enter;
    return waitForPlayState(ctx, "playing", args.timeoutMs ?? 30_000, enter);
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
    return waitForPlayState(ctx, "stopped", args.timeoutMs ?? 30_000, exit);
  },
};

const StepShape = {
  frames: z.number().int().min(1).max(120).optional(),
};

export const unityStepFrame: ToolDef<typeof StepShape, PlayModeStatus> = {
  name: "unity_step_frame",
  description:
    "Advances play mode by one frame (or `frames` frames), pausing the game. Requires play mode to be active. Multi-frame steps run inside the Editor in a single call. Useful to deterministically step through runtime behaviour between inspections.",
  requires: ["unity_bridge"],
  inputShape: StepShape,
  async run(args, ctx) {
    const frames = args.frames ?? 1;
    const first = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStep, { frames });
    if (!first.ok) return first;
    // New bridges report framesStepped (the in-Editor stepper handled all frames in one call).
    if (first.data.framesStepped !== undefined) {
      if (first.data.stepping) {
        first.warnings.push(
          `Step still in progress after the wait window (${first.data.framesStepped}/${frames} frames done).`
        );
      }
      return first;
    }
    // Older Unity package: it stepped exactly one frame per call.
    let last: ToolEnvelope<PlayModeStatus> = first;
    for (let i = 1; i < frames; i++) {
      last = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStep);
      if (!last.ok) return last;
    }
    return last;
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

/**
 * Waits for a play-mode transition to finish. Prefers the playmode.await long-poll (settles
 * within ~50ms of the state flipping, riding through the domain reload via bridgeCall's
 * UNITY_RELOADING retry); falls back to 400ms status polling against older Unity packages.
 */
async function waitForPlayState(
  ctx: ToolContext,
  until: "playing" | "stopped",
  timeoutMs: number,
  fallback: ToolEnvelope<PlayModeStatus>
): Promise<ToolEnvelope<PlayModeStatus>> {
  const start = Date.now();
  const wantPlaying = until === "playing";
  let last = fallback;
  let useAwait = true;
  while (Date.now() - start < timeoutMs) {
    if (useAwait) {
      const remaining = timeoutMs - (Date.now() - start);
      const res = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeAwait, {
        until,
        timeoutMs: Math.min(remaining, AWAIT_WINDOW_MS),
      });
      if (res.ok) {
        last = res;
        if (res.data.settled !== false) return res;
        continue; // window closed while still transitioning — re-issue
      }
      if (isUnknownMethodError(res)) {
        useAwait = false;
        continue;
      }
      // Transient (reload retries already happened inside bridgeCall) — brief pause, retry.
      await sleep(400);
      continue;
    }
    const s = await bridgeCall<PlayModeStatus>(ctx.bridge, BRIDGE_METHODS.playModeStatus);
    if (s.ok) {
      last = s;
      if (s.data.isPlaying === wantPlaying) return s;
    }
    await sleep(400);
  }
  if (last.ok) last.warnings.push(`Timed out after ${timeoutMs}ms waiting for play-mode transition.`);
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
