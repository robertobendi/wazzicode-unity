import { create } from "zustand";

/** One line in the admin debug log. */
export interface DebugEntry {
  id: number;
  /** Wall-clock time captured. */
  t: number;
  /** Source channel: "stream" | "done" | "error" | "raw". */
  kind: string;
  /** Compact one-line payload (usually JSON.stringify of the event). */
  text: string;
}

/** Cap so a chatty run can't grow the buffer without bound. */
const MAX_ENTRIES = 2000;

interface DebugState {
  entries: DebugEntry[];
  push: (kind: string, text: string) => void;
  clear: () => void;
}

let seq = 0;

export const useDebugStore = create<DebugState>((set) => ({
  entries: [],
  push: (kind, text) =>
    set((s) => {
      const entry: DebugEntry = { id: seq++, t: Date.now(), kind, text };
      const next = s.entries.length >= MAX_ENTRIES ? s.entries.slice(1) : s.entries;
      return { entries: [...next, entry] };
    }),
  clear: () => set({ entries: [] }),
}));

/** Compactly stringify an arbitrary event payload for the debug log. */
export function compact(payload: unknown): string {
  try {
    return typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
