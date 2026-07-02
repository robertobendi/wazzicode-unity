import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import ProjectPicker from "@/components/project/ProjectPicker";
import ChatView from "@/components/chat/ChatView";
import StatusBar from "@/components/shell/StatusBar";

export default function App() {
  const { settings, load } = useSettingsStore();
  const setProject = useChatStore((s) => s.setProject);

  useEffect(() => {
    void load();
  }, [load]);

  const project = settings?.currentProject ?? null;

  // Keep the chat store's project in sync (resets the conversation on change).
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);

  // Poll the Unity bridge whenever a project is open.
  useBridgeStatus(project);

  if (!settings) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-sm text-fg-dim">
        Loading…
      </div>
    );
  }

  if (!project) {
    return <ProjectPicker />;
  }

  return (
    <div className="flex h-full w-full flex-col bg-ink-950 text-fg">
      <div className="flex min-h-0 flex-1">
        <ChatView />
      </div>
      <StatusBar />
    </div>
  );
}
