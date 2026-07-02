import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useClaudeStream } from "@/hooks/useClaudeStream";
import MessageList from "./MessageList";
import Composer from "./Composer";

/** The main chat surface. Wires the Claude event stream into the store. */
export default function ChatView() {
  useClaudeStream();
  const project = useChatStore((s) => s.project);
  const update = useSettingsStore((s) => s.update);
  const name = project ? project.split(/[\\/]/).pop() || project : "";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{name}</div>
        </div>
        <button
          onClick={() => void update({ currentProject: null })}
          className="rounded-md px-2 py-1 text-xs text-fg-dim transition-colors hover:bg-ink-800 hover:text-fg"
        >
          Switch project
        </button>
      </header>

      <MessageList />
      <Composer />
    </div>
  );
}
