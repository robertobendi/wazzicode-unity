import { convertFileSrc } from "@tauri-apps/api/core";
import { useLiveScreenshot } from "@/hooks/useLiveScreenshot";
import { RefreshIcon } from "@/components/shell/icons";

/** Latest Unity game-view capture, with a manual refresh and friendly states. */
export default function LiveScreenshot({
  project,
  connected,
}: {
  project: string | null;
  connected: boolean;
}) {
  const { pngPath, version, loading, error, capture } = useLiveScreenshot(
    project,
    connected,
  );
  // Cache-bust so the webview reloads the overwritten file each capture.
  const src = pngPath ? `${convertFileSrc(pngPath)}?v=${version}` : null;

  return (
    <div className="border-b border-white/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">
          Game view
        </span>
        <button
          onClick={() => void capture("game")}
          disabled={!connected || loading}
          title="Refresh"
          aria-label="Refresh screenshot"
          className="rounded-md p-1 text-fg-dim transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted disabled:opacity-40"
        >
          <RefreshIcon className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="aspect-video overflow-hidden rounded-lg border border-white/5 bg-ink-950">
        {src ? (
          <img
            src={src}
            alt="Live game view"
            className="h-full w-full animate-appear object-contain"
          />
        ) : (
          <Placeholder connected={connected} error={error} />
        )}
      </div>
    </div>
  );
}

function Placeholder({
  connected,
  error,
}: {
  connected: boolean;
  error: string | null;
}) {
  const text = error
    ? error
    : connected
      ? "Press refresh to see your game."
      : "Open Unity to see your game here.";
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-fg-dim">
      {text}
    </div>
  );
}
