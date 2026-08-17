import { promises as fs } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  BRIDGE_METHODS,
  CapturedFrame,
  FrameCaptureResult,
  ToolEnvelope,
  err,
  isErrorCode,
  ok,
} from "@uvibe/core";
import { bridgeCall } from "./_helpers.js";
import { ToolDef } from "../registry.js";
import { reportProgress } from "../interaction.js";

/**
 * Temporal capture: a short burst of Game-view frames instead of a single still, so motion —
 * animation, movement, timing, a transition that only looks wrong while it plays — is visible.
 * Unity drives the capture session and returns each frame with a perceptual hash; the hashes are
 * what let `returnImages:"changed"` spend context only on frames that actually differ.
 */

const InputShape = {
  frames: z.number().int().min(2).max(16).optional().describe("How many frames to capture (default 8)."),
  intervalMs: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .optional()
    .describe("Target gap between frames in milliseconds (default 250). The editor may drift above this."),
  width: z
    .number()
    .int()
    .min(160)
    .max(1280)
    .optional()
    .describe("Frame width in pixels (default 480); height follows the Game view's aspect ratio."),
  format: z.enum(["png", "jpg"]).optional().describe("Image encoding. Default jpg — far smaller across a sequence."),
  quality: z.number().int().min(1).max(100).optional().describe("JPEG quality (default 70; ignored for png)."),
  save: z.boolean().optional().describe("If true (default), write every captured frame to .unity-vibe/screenshots/."),
  returnImages: z
    .enum(["all", "changed", "none"])
    .optional()
    .describe(
      "Which frames to surface as images. 'changed' (default) returns the first frame plus each visibly different one; 'none' returns only the JSON summary."
    ),
  cameraPath: z
    .string()
    .optional()
    .describe("Optional GameObject path of a Camera to render. Defaults to Camera.main, then any active enabled Camera."),
};

/**
 * Hamming distance (out of 64 bits) above which two frames count as visibly different. Low enough
 * that a moving character registers, high enough that encoder noise on a static scene does not.
 */
const CHANGED_HAMMING_THRESHOLD = 4;

interface BridgeFrame {
  index?: number;
  tMs?: number;
  hash?: string;
  imageBase64?: string;
}

interface BridgeFrameCapture {
  capturing?: boolean;
  capturedFrames?: number;
  playMode?: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  droppedFrames?: number;
  avgIntervalMs?: number;
  frames?: BridgeFrame[];
}

export const unityCaptureFrames: ToolDef<typeof InputShape, FrameCaptureResult> = {
  name: "unity_capture_frames",
  description:
    "Captures a short sequence of Game view frames (default 8 at 250ms) and returns them as an ordered series of multimodal images, so Claude can SEE motion rather than a single instant — is the character actually moving, does the animation play, does the transition land. Works in play mode (the usual case) and in edit mode, where it captures whatever the Game view renders. By default only frames that visibly changed are returned (`returnImages`), and all captured frames are saved to .unity-vibe/screenshots/.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    const requested = {
      frames: args.frames ?? 8,
      intervalMs: args.intervalMs ?? 250,
      width: args.width ?? 480,
      format: args.format ?? ("jpg" as const),
      quality: args.quality ?? 70,
      returnImages: args.returnImages ?? ("changed" as const),
    };
    const started = Date.now();
    // One long-poll window per round: Unity holds the request open while the session collects
    // frames and returns as soon as it is done. A long sequence closes the window mid-flight, so
    // re-issue until the session reports it has stopped capturing.
    const budgetMs = requested.frames * requested.intervalMs + 15_000;
    // Progress must not go backwards, so only report when the frame count has actually advanced.
    let reported = 0;
    reportProgress(ctx, 0, requested.frames, `capturing ${requested.frames} frames…`);

    let last: ToolEnvelope<BridgeFrameCapture> | undefined;
    for (;;) {
      const remaining = budgetMs - (Date.now() - started);
      if (remaining <= 0) break;
      last = await bridgeCall<BridgeFrameCapture>(
        ctx.bridge,
        BRIDGE_METHODS.captureFrames,
        {
          frames: requested.frames,
          intervalMs: requested.intervalMs,
          width: requested.width,
          format: requested.format,
          quality: requested.quality,
          cameraPath: args.cameraPath,
          timeoutMs: Math.min(remaining, AWAIT_WINDOW_MS),
        },
        "normal",
        { reloadTimeoutMs: remaining }
      );
      if (!last.ok) {
        const code = isErrorCode(last.error.code) ? last.error.code : "INTERNAL_ERROR";
        return err(code, last.error.message, last.meta, last.error.details);
      }
      // While a session is still running the bridge withholds the frame payloads but keeps
      // reporting the count, so progress moves across long-poll rounds.
      const done = last.data.capturedFrames ?? last.data.frames?.length ?? 0;
      if (done > reported) {
        reported = done;
        reportProgress(ctx, done, requested.frames, `captured ${done}/${requested.frames} frames…`);
      }
      if (last.data.capturing !== true) break;
    }

    if (!last?.ok) {
      return err(
        "BRIDGE_TIMEOUT",
        `Timed out after ${budgetMs}ms waiting for the frame capture to finish.`,
        { source: ctx.bridge.source, durationMs: Date.now() - started },
        { requested }
      );
    }

    const captured = (last.data.frames ?? []).map(normalizeFrame);
    if (captured.length === 0) {
      return err(
        "MALFORMED_BRIDGE_RESPONSE",
        "The capture session returned no frames.",
        last.meta,
        { requested, method: BRIDGE_METHODS.captureFrames }
      );
    }

    const mimeType = last.data.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    const returnedIndexes = selectReturnedFrames(captured, requested.returnImages);
    const savedPaths = (args.save ?? true)
      ? await saveFrames(ctx.projectPath, captured, mimeType)
      : [];

    const frames: CapturedFrame[] = captured.map((frame, i) => ({
      index: frame.index,
      tMs: frame.tMs,
      hash: frame.hash,
      returned: returnedIndexes.has(i),
      ...(returnedIndexes.has(i) ? { imageBase64: frame.imageBase64 } : {}),
      ...(savedPaths[i] ? { savedPath: savedPaths[i] } : {}),
    }));

    const warnings: string[] = [...last.warnings];
    const dropped = last.data.droppedFrames ?? Math.max(0, requested.frames - captured.length);
    if (dropped > 0) warnings.push(`${dropped} requested frame(s) were dropped by the capture session.`);
    if (last.data.playMode === false) {
      warnings.push("Captured in edit mode — the Game view is not simulating, so frames may be identical.");
    }

    const data: FrameCaptureResult = {
      requested,
      actual: {
        frames: captured.length,
        avgIntervalMs: last.data.avgIntervalMs ?? averageInterval(captured),
        droppedFrames: dropped,
      },
      playMode: last.data.playMode === true,
      width: last.data.width ?? requested.width,
      height: last.data.height ?? Math.round((requested.width * 9) / 16),
      mimeType,
      savedPaths: savedPaths.filter((p): p is string => typeof p === "string"),
      dedup: {
        captured: captured.length,
        returned: returnedIndexes.size,
        skippedUnchanged:
          requested.returnImages === "changed" ? captured.length - returnedIndexes.size : 0,
      },
      frames,
    };
    return ok(data, {
      source: ctx.bridge.source,
      durationMs: Date.now() - started,
      unityVersion: last.meta.unityVersion,
      projectPath: last.meta.projectPath,
    }, warnings);
  },
};

/** Single long-poll round is capped server-side; re-issue until our own deadline. */
const AWAIT_WINDOW_MS = 25_000;

interface NormalizedFrame {
  index: number;
  tMs: number;
  hash: string;
  imageBase64: string;
}

function normalizeFrame(frame: BridgeFrame, i: number): NormalizedFrame {
  return {
    index: typeof frame.index === "number" ? frame.index : i + 1,
    tMs: typeof frame.tMs === "number" ? frame.tMs : 0,
    hash: typeof frame.hash === "string" ? frame.hash : "",
    imageBase64: typeof frame.imageBase64 === "string" ? frame.imageBase64 : "",
  };
}

/**
 * Which frames get an image block. "changed" always keeps the first frame (the baseline the rest
 * are read against) and then each frame far enough from the last one *returned* — comparing
 * against the last returned frame rather than the previous captured frame stops slow drift from
 * being dropped one imperceptible step at a time.
 */
export function selectReturnedFrames(
  frames: Array<{ hash: string; imageBase64: string }>,
  mode: "all" | "changed" | "none"
): Set<number> {
  const selected = new Set<number>();
  if (mode === "none") return selected;
  const usable = frames.map((f, i) => ({ i, f })).filter(({ f }) => f.imageBase64.length > 0);
  if (usable.length === 0) return selected;
  if (mode === "all") {
    for (const { i } of usable) selected.add(i);
    return selected;
  }
  let reference = usable[0].f.hash;
  selected.add(usable[0].i);
  for (const { i, f } of usable.slice(1)) {
    if (hammingDistance(reference, f.hash) <= CHANGED_HAMMING_THRESHOLD) continue;
    selected.add(i);
    reference = f.hash;
  }
  return selected;
}

/** Bit distance between two hex hashes. Unequal or unparseable hashes count as fully different. */
export function hammingDistance(a: string, b: string): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = Number.parseInt(a[i], 16);
    const xb = Number.parseInt(b[i], 16);
    if (Number.isNaN(xa) || Number.isNaN(xb)) return Number.MAX_SAFE_INTEGER;
    distance += popcount4(xa ^ xb);
  }
  return distance;
}

function popcount4(nibble: number): number {
  let n = nibble & 0xf;
  let bits = 0;
  while (n) {
    bits += n & 1;
    n >>= 1;
  }
  return bits;
}

function averageInterval(frames: NormalizedFrame[]): number {
  if (frames.length < 2) return 0;
  return (frames[frames.length - 1].tMs - frames[0].tMs) / (frames.length - 1);
}

/**
 * Writes every captured frame (not just the returned ones) under a single timestamped prefix, so
 * a sequence stays grouped and ordered on disk the way the existing capture tools save stills.
 */
async function saveFrames(
  projectPath: string,
  frames: NormalizedFrame[],
  mimeType: string
): Promise<Array<string | undefined>> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(projectPath, ".unity-vibe", "screenshots");
    await fs.mkdir(dir, { recursive: true });
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const width = String(frames.length).length;
    return await Promise.all(
      frames.map(async (frame) => {
        if (frame.imageBase64.length === 0) return undefined;
        const name = `${stamp}_frames_${String(frame.index).padStart(width, "0")}.${ext}`;
        const file = path.join(dir, name);
        await fs.writeFile(file, Buffer.from(frame.imageBase64, "base64"));
        return file;
      })
    );
  } catch {
    // Saving is best-effort; never fail the capture because of it.
    return [];
  }
}
