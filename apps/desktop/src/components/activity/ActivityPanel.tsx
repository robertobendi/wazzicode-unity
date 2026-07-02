import { useChatStore } from "@/stores/useChatStore";
import { useStatusStore } from "@/stores/useStatusStore";
import ToolTimeline from "./ToolTimeline";
import LiveScreenshot from "./LiveScreenshot";

/**
 * Right-hand panel: a live game-view screenshot on top, and a chronological
 * feed of what the AI has been doing below. Collapsed via the TopBar toggle
 * (this component isn't rendered when closed).
 */
export default function ActivityPanel() {
  const project = useChatStore((s) => s.project);
  const connected = useStatusStore((s) => s.status.state === "connected");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-white/5 bg-ink-900">
      <LiveScreenshot project={project} connected={connected} />
      <div className="min-h-0 flex-1">
        <ToolTimeline />
      </div>
    </aside>
  );
}
