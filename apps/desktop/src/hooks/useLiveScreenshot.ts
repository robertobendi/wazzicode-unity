import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { friendlyError } from "@/lib/errorMessages";
import { useChatStore } from "@/stores/useChatStore";

/** Tools whose completion means the game view likely changed on screen. */
const REFRESH_RE = /capture|play_mode|step|enter_play|exit_play/;

/** How often to soft-refresh the capture while a run is active + connected. */
const SOFT_INTERVAL_MS = 10_000;

export interface LiveScreenshot {
  pngPath: string | null;
  /** Bumps on each successful capture; used to cache-bust the <img> src. */
  version: number;
  loading: boolean;
  error: string | null;
  capture: (kind?: "game" | "scene") => Promise<void>;
}

/**
 * Owns the latest game-view capture for the activity panel. Refreshes:
 *  - after any capture/play/step tool completes ok (agent changed the view),
 *  - on a soft 10s interval, but only while connected AND a run is active,
 *  - and on demand via the returned `capture()` (manual refresh button).
 */
export function useLiveScreenshot(
  project: string | null,
  connected: boolean,
): LiveScreenshot {
  const [pngPath, setPngPath] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useChatStore((s) => s.running);
  const messages = useChatStore((s) => s.messages);

  const capture = useCallback(
    async (kind: "game" | "scene" = "game") => {
      if (!project) return;
      setLoading(true);
      setError(null);
      try {
        const { pngPath } = await api.bridgeCapture(project, kind);
        setPngPath(pngPath);
        setVersion((v) => v + 1);
      } catch (e) {
        setError(friendlyError(String(e), "Couldn't capture the game view."));
      } finally {
        setLoading(false);
      }
    },
    [project],
  );

  // Timestamp of the most recent view-changing tool completion.
  const triggerTs = useMemo(() => {
    let ts = 0;
    for (const m of messages) {
      for (const a of m.activities) {
        if (a.status === "ok" && a.endedAt && REFRESH_RE.test(a.name)) {
          if (a.endedAt > ts) ts = a.endedAt;
        }
      }
    }
    return ts;
  }, [messages]);

  const lastTrigger = useRef(0);
  useEffect(() => {
    if (triggerTs > lastTrigger.current) {
      lastTrigger.current = triggerTs;
      if (connected) void capture("game");
    }
  }, [triggerTs, connected, capture]);

  // Soft interval — only while it's worth spending the bridge round-trip.
  useEffect(() => {
    if (!connected || !running) return;
    const id = setInterval(() => void capture("game"), SOFT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [connected, running, capture]);

  return { pngPath, version, loading, error, capture };
}
