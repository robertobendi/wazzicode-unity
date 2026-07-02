import { useChatStore } from "@/stores/useChatStore";
import { useStatusStore } from "@/stores/useStatusStore";
import type { BridgeState } from "@/types/status";

/** Bottom bar: Unity connection pill + running session cost. */
export default function StatusBar() {
  const status = useStatusStore((s) => s.status);
  const totalCost = useChatStore((s) => s.session.totalCostUsd);

  const label = status.compiling
    ? "Unity is recompiling — hang on…"
    : status.playMode
      ? "Playing"
      : status.friendly;

  return (
    <footer className="flex h-8 items-center justify-between border-t border-ink-800 bg-ink-900 px-4 text-xs text-fg-dim">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor(status.state)}`} />
        <span className="text-fg-muted">{label}</span>
      </div>
      {totalCost > 0 && <span>Session ${totalCost.toFixed(4)}</span>}
    </footer>
  );
}

function dotColor(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "bg-emerald-500";
    case "reloading":
      return "bg-amber-500 animate-pulse";
    case "identity_mismatch":
      return "bg-amber-500";
    case "disconnected":
    default:
      return "bg-red-500";
  }
}
