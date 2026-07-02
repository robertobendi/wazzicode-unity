import { useEffect, useState } from "react";
import { api } from "@/api";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useDebugCapture } from "@/hooks/useDebugCapture";
import PairingScreen from "@/components/pairing/PairingScreen";
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
  const repairing = useUiStore((s) => s.repairing);
  const setRepairing = useUiStore((s) => s.setRepairing);

  // Pairing gate: is a company token actually present on this machine?
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api
      .authStatus()
      .then((s) => setHasToken(s.hasToken))
      .catch(() => setHasToken(false));
  }, []);

  const project = settings?.currentProject ?? null;

  // Keep the chat store's project in sync (resets the conversation on change).
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);

  // Poll the Unity bridge whenever a project is open; capture raw debug events.
  useBridgeStatus(project);
  useDebugCapture();

  if (!settings || hasToken === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-sm text-fg-dim">
        Loading…
      </div>
    );
  }

  // Pairing gate FIRST (a paired app is per-machine, not per-project): show it
  // when there's no stored token and we've never paired — or on admin re-pair.
  const needsPairing = (!hasToken && !settings.pairedOk) || repairing;
  if (needsPairing) {
    return (
      <PairingScreen
        onDone={() => {
          setHasToken(true);
          setRepairing(false);
        }}
      />
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
