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
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/5 bg-ink-900 px-4 text-xs text-fg-dim">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor(status.state)}`} />
        <span className="text-fg-muted">{label}</span>
      </div>
      {totalCost > 0 && (
        <span className="tabular-nums">Session ${totalCost.toFixed(4)}</span>
      )}
    </footer>
  );
}

function dotColor(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "bg-success";
    case "reloading":
      return "bg-warning animate-dot-pulse";
    case "identity_mismatch":
      return "bg-warning";
    case "disconnected":
    default:
      return "bg-danger";
  }
}
