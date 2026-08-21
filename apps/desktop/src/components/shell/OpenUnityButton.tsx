import { useState } from "react";
import { api } from "@/api";
import { useToastStore } from "@/stores/useToastStore";

/**
 * "Unity isn't open" → one click that opens it.
 *
 * Studio can do nothing while the Editor is closed, and telling the user to go and open Unity
 * themselves is the single most common dead-end in the app. Unity's own CLI can start the right
 * Editor version for the project, so this button does it — and when that CLI isn't installed it
 * says so once, in a toast, instead of failing silently.
 */
export default function OpenUnityButton({
  project,
  alwaysVisible = false,
}: {
  project: string;
  /** Hover-reveal suits the status bar; a banner or empty state needs it visible outright. */
  alwaysVisible?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const toast = useToastStore((s) => s.show);

  async function open() {
    setStarting(true);
    try {
      // Don't wait for the bridge: the status poller flips the pill to "connected" on its own,
      // and a first import can take minutes.
      const result = await api.unityEditorLaunch(project, { wait: false });
      if (result.outcome === "cli_unavailable" || result.outcome === "launch_failed") {
        toast(result.nextAction);
      } else if (result.outcome === "editor_not_installed") {
        toast(result.message);
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={starting}
      className={`rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-60 ${
        alwaysVisible
          ? "border-current/30 text-current hover:bg-white/10"
          : "border-white/10 text-fg-muted hover:border-white/20 hover:text-fg"
      }`}
    >
      {starting ? "Starting Unity…" : "Open Unity"}
    </button>
  );
}
