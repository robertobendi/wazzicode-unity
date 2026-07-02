import { create } from "zustand";
import { api } from "@/api";
import type { Settings } from "@/types/settings";

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  /** Load settings from the Rust backend. Safe to call more than once. */
  load: () => Promise<void>;
  /** Persist a partial update and reflect the returned canonical settings. */
  update: (patch: Partial<Settings>) => Promise<void>;
  /** Adopt canonical settings returned by a backend command (no extra save). */
  setSettings: (settings: Settings) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await api.getSettings();
      set({ settings, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  update: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    try {
      const saved = await api.updateSettings(next);
      set({ settings: saved });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setSettings: (settings) => set({ settings }),
}));
