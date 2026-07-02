import { create } from "zustand";
import { api } from "@/api";
import type { PairingState } from "@/types/pairing";

const IDLE: PairingState = {
  phase: "idle",
  oauthUrl: null,
  mode: null,
  error: null,
  rawTail: null,
  promptSeen: false,
  pairingId: null,
};

interface PairingStore {
  state: PairingState;
  /** Optimistic local flag between clicking Start and the first backend event. */
  starting: boolean;
  /** Optimistic local flag while a submitted code is in flight. */
  submitting: boolean;
  /** Adopt a backend-published state (from the `pairing:update` event). */
  set: (s: PairingState) => void;
  /** Begin pairing (spawns the hidden PTY). */
  start: () => Promise<void>;
  /** Send the admin's one-time code. */
  submitCode: (code: string) => Promise<void>;
  /** Cancel / start over. */
  cancel: () => Promise<void>;
  /** Reconcile with the backend's latest state (UI reload safety). */
  refresh: () => Promise<void>;
}

export const usePairingStore = create<PairingStore>((set, get) => ({
  state: IDLE,
  starting: false,
  submitting: false,

  set: (state) => set({ state, starting: false, submitting: false }),

  start: async () => {
    set({ starting: true, state: IDLE });
    try {
      await api.pairingStart();
    } catch (e) {
      set({
        starting: false,
        state: { ...IDLE, phase: "failed", error: String(e) },
      });
    }
  },

  submitCode: async (code) => {
    const { state } = get();
    if (!state.pairingId || !code.trim()) return;
    set({ submitting: true });
    try {
      await api.pairingSubmitCode(state.pairingId, code.trim());
    } catch (e) {
      set({ submitting: false, state: { ...state, phase: "failed", error: String(e) } });
    }
  },

  cancel: async () => {
    set({ starting: false, submitting: false, state: IDLE });
    try {
      await api.pairingCancel();
    } catch {
      // Best-effort — nothing to do if there's no active pairing.
    }
  },

  refresh: async () => {
    try {
      const s = await api.pairingState();
      if (s) set({ state: s });
    } catch {
      // Ignore — the screen stays on its current (default idle) state.
    }
  },
}));
