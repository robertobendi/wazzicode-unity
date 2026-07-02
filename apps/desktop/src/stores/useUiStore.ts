import { create } from "zustand";

/** Which top-level surface is showing: manual chat or the autonomous loop. */
export type AppMode = "chat" | "auto";

/** Ephemeral shell UI state (panel/drawer/popover visibility). Not persisted. */
interface UiState {
  /** Active surface: "chat" (manual) or "auto" (loop). */
  mode: AppMode;
  /** Right-hand activity panel open? Defaults open on first run. */
  activityOpen: boolean;
  /** Bottom debug drawer expanded? (Only reachable when settings.debugDrawer.) */
  debugOpen: boolean;
  /** Settings popover open? */
  settingsOpen: boolean;
  /** Admin "Re-pair account" chosen — force the pairing screen back up. */
  repairing: boolean;
  toggleActivity: () => void;
  toggleDebug: () => void;
  setSettingsOpen: (open: boolean) => void;
  setRepairing: (v: boolean) => void;
  setMode: (mode: AppMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "chat",
  activityOpen: true,
  debugOpen: false,
  settingsOpen: false,
  repairing: false,
  toggleActivity: () => set((s) => ({ activityOpen: !s.activityOpen })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setRepairing: (v) => set({ repairing: v }),
  setMode: (mode) => set({ mode }),
}));
