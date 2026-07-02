import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePairingStore } from "@/stores/usePairingStore";
import type { PairingState } from "@/types/pairing";

/**
 * Subscribe to backend `pairing:update` events and reconcile with the latest
 * state on mount. Mounted only while the pairing screen is up.
 */
export function usePairing() {
  useEffect(() => {
    const setState = usePairingStore.getState().set;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void listen<PairingState>("pairing:update", (e) => setState(e.payload)).then(
      (u) => {
        if (cancelled) u();
        else unlisten = u;
      },
    );
    void usePairingStore.getState().refresh();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
