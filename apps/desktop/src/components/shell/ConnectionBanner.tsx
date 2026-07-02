import { useChatStore } from "@/stores/useChatStore";
import { useStatusStore } from "@/stores/useStatusStore";

/**
 * Non-blocking amber banner shown when Unity drops out mid-run. The chat keeps
 * going (Claude retries the bridge), so this is reassurance, not an error.
 */
export default function ConnectionBanner() {
  const running = useChatStore((s) => s.running);
  const state = useStatusStore((s) => s.status.state);

  const show =
    running && (state === "disconnected" || state === "identity_mismatch");
  if (!show) return null;

  return (
    <div className="animate-appear border-b border-warning/20 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
      Unity connection hiccup — the AI will keep trying.
    </div>
  );
}
