import { create } from "zustand";
import { api } from "@/api";
import { friendlyError } from "@/lib/errorMessages";
import { isLoopActive, type LoopOptions, type LoopState } from "@/types/loop";

/**
 * Auto-mode state. The Rust driver owns the loop; this store just mirrors the
 * `loop:update` broadcasts and exposes start/stop actions. `nowDoing` is the
 * live friendly label of the current builder/QA turn, fed by `useLoopEvents`
 * from the sub-run's `claude:stream` events.
 */
interface LoopStoreState {
  state: LoopState | null;
  starting: boolean;
  error: string | null;
  /** Live "now doing …" label while a sub-run streams, else null. */
  nowDoing: string | null;

  /** Load any persisted loop state on startup / project switch. */
  hydrate: () => Promise<void>;
  start: (project: string, goal: string, options: LoopOptions) => Promise<void>;
  stop: () => Promise<void>;

  // Called by useLoopEvents — not part of the UI surface.
  applyUpdate: (s: LoopState) => void;
  setNowDoing: (label: string | null) => void;
}

export const useLoopStore = create<LoopStoreState>((set, get) => ({
  state: null,
  starting: false,
  error: null,
  nowDoing: null,

  hydrate: async () => {
    try {
      const s = await api.loopState();
      set({ state: s });
    } catch {
      // No loop yet, or backend not ready — leave as null.
    }
  },

  start: async (project, goal, options) => {
    if (get().starting) return;
    set({ starting: true, error: null });
    try {
      await api.loopStart(project, goal, options);
      // The first `loop:update` (status "running") arrives via the event; no
      // need to set state here.
    } catch (e) {
      const raw = String(e);
      const friendly = raw.startsWith("busy")
        ? "Something is already running for this project."
        : friendlyError(raw, "Couldn't start Auto mode.");
      set({ error: friendly });
    } finally {
      set({ starting: false });
    }
  },

  stop: async () => {
    try {
      await api.loopStop();
    } catch {
      // The driver still emits a terminal `loop:update`; nothing to do here.
    }
  },

  applyUpdate: (s) =>
    set((prev) => ({
      state: s,
      // Clear the live label once the loop is no longer active.
      nowDoing: isLoopActive(s.status) ? prev.nowDoing : null,
    })),

  setNowDoing: (label) => set({ nowDoing: label }),
}));
