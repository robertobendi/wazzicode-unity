import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useDebugCapture } from "@/hooks/useDebugCapture";
import ProjectPicker from "@/components/project/ProjectPicker";
import ChatView from "@/components/chat/ChatView";
import ActivityPanel from "@/components/activity/ActivityPanel";
import StatusBar from "@/components/shell/StatusBar";
import TopBar from "@/components/shell/TopBar";
import ConnectionBanner from "@/components/shell/ConnectionBanner";
import DebugDrawer from "@/components/shell/DebugDrawer";

export default function App() {
  const { settings, load } = useSettingsStore();
  const setProject = useChatStore((s) => s.setProject);
  const activityOpen = useUiStore((s) => s.activityOpen);

  useEffect(() => {
    void load();
  }, [load]);

  const project = settings?.currentProject ?? null;

  // Keep the chat store's project in sync (resets the conversation on change).
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);

  // Poll the Unity bridge whenever a project is open; capture raw debug events.
  useBridgeStatus(project);
  useDebugCapture();

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
      <TopBar />
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <ChatView />
        {activityOpen && <ActivityPanel />}
      </div>
      {settings.debugDrawer && <DebugDrawer />}
      <StatusBar />
    </div>
  );
}
