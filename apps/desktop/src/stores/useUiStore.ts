import { create } from "zustand";

/** Ephemeral shell UI state (panel/drawer/popover visibility). Not persisted. */
interface UiState {
  /** Right-hand activity panel open? Defaults open on first run. */
  activityOpen: boolean;
  /** Bottom debug drawer expanded? (Only reachable when settings.debugDrawer.) */
  debugOpen: boolean;
  /** Settings popover open? */
  settingsOpen: boolean;
  toggleActivity: () => void;
  toggleDebug: () => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activityOpen: true,
  debugOpen: false,
  settingsOpen: false,
  toggleActivity: () => set((s) => ({ activityOpen: !s.activityOpen })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
