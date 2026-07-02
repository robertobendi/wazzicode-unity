import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OnboardingProgress } from "@/types/onboarding";

/**
 * Subscribe to backend `onboarding:progress` events and accumulate the lines.
 * Optionally filter to a single `step`. Returns the running log plus a reset.
 */
export function useOnboardingProgress(step?: string) {
  const [lines, setLines] = useState<string[]>([]);
  // Latest `step` without re-subscribing on every render.
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void listen<OnboardingProgress>("onboarding:progress", (e) => {
      const want = stepRef.current;
      if (want && e.payload.step !== want) return;
      setLines((prev) => {
        const next = [...prev, e.payload.line];
        // Keep the tail bounded — installers can be chatty.
        return next.length > 200 ? next.slice(-200) : next;
      });
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { lines, reset: () => setLines([]) };
}
