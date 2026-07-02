import { useEffect, useRef, useState } from "react";
import { useDebugStore } from "@/stores/useDebugStore";
import { useUiStore } from "@/stores/useUiStore";
import { ChevronIcon } from "./icons";

/**
 * Collapsible admin log at the bottom of the shell. Only rendered when
 * settings.debugDrawer is on. Shows the ring-buffered raw event stream.
 */
export default function DebugDrawer() {
  const entries = useDebugStore((s) => s.entries);
  const clear = useDebugStore((s) => s.clear);
  const { debugOpen, toggleDebug } = useUiStore();
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the tail while open.
  useEffect(() => {
    if (debugOpen && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries, debugOpen]);

  async function copyAll() {
    const text = entries
      .map((e) => `${new Date(e.t).toISOString()} [${e.kind}] ${e.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be unavailable; silently ignore.
    }
  }

  return (
    <div className="shrink-0 border-t border-white/5 bg-ink-900">
      <div className="flex h-8 items-center justify-between px-3 text-xs text-fg-dim">
        <button
          onClick={toggleDebug}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-150 hover:text-fg-muted"
        >
          <ChevronIcon
            className={`transition-transform duration-150 ${
              debugOpen ? "" : "-rotate-90"
            }`}
          />
          <span>Debug log</span>
          <span className="text-fg-dim/70">({entries.length})</span>
        </button>
        {debugOpen && (
          <div className="flex items-center gap-1">
            <button
              onClick={copyAll}
              className="rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted"
            >
              {copied ? "Copied" : "Copy all"}
            </button>
            <button
              onClick={clear}
              className="rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {debugOpen && (
        <div
          ref={logRef}
          className="selectable h-48 overflow-y-auto border-t border-white/5 bg-ink-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-muted"
        >
          {entries.length === 0 ? (
            <div className="text-fg-dim">No events yet.</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="whitespace-pre-wrap break-all">
                <span className="text-fg-dim">
                  {new Date(e.t).toLocaleTimeString()}{" "}
                </span>
                <span className="text-accent/80">[{e.kind}]</span> {e.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
