import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useDebugCapture } from "@/hooks/useDebugCapture";
import { useLoopEvents } from "@/hooks/useLoopEvents";
import { useLoopStore } from "@/stores/useLoopStore";
import PairingScreen from "@/components/pairing/PairingScreen";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import ProjectPicker from "@/components/project/ProjectPicker";
import ChatView from "@/components/chat/ChatView";
import LoopPanel from "@/components/loop/LoopPanel";
import ActivityPanel from "@/components/activity/ActivityPanel";
import StatusBar from "@/components/shell/StatusBar";
import TopBar from "@/components/shell/TopBar";
import ConnectionBanner from "@/components/shell/ConnectionBanner";
import DebugDrawer from "@/components/shell/DebugDrawer";

export default function App() {
  const { settings, load } = useSettingsStore();
  const updateSettings = useSettingsStore((s) => s.update);
  const setProject = useChatStore((s) => s.setProject);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const mode = useUiStore((s) => s.mode);
  const repairing = useUiStore((s) => s.repairing);
  const setRepairing = useUiStore((s) => s.setRepairing);
  const hydrateLoop = useLoopStore((s) => s.hydrate);

  useEffect(() => {
    void load();
  }, [load]);

  const project = settings?.currentProject ?? null;

  // Keep the chat store's project in sync (resets the conversation on change).
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);

  // Load any persisted auto-mode loop for the open project.
  useEffect(() => {
    if (project) void hydrateLoop();
  }, [project, hydrateLoop]);

  // Poll the Unity bridge whenever a project is open; capture raw debug events;
  // mirror the auto-loop broadcasts (kept mounted in both modes).
  useBridgeStatus(project);
  useDebugCapture();
  useLoopEvents();

  if (!settings) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-sm text-fg-dim">
        Loading…
      </div>
    );
  }

  // First run: the onboarding wizard subsumes the pairing gate + project pick.
  if (!settings.onboarded) {
    return (
      <OnboardingWizard
        onComplete={() => void updateSettings({ onboarded: true })}
      />
    );
  }

  // Pairing gate FIRST (connection is per-machine, not per-project): show it
  // when this machine hasn't connected — or on admin re-pair. Uses the persisted
  // flag only (no per-launch probe); PairingScreen itself re-checks on mount.
  const needsPairing = !settings.pairedOk || repairing;
  if (needsPairing) {
    return (
      <PairingScreen
        onDone={() => {
          void updateSettings({ pairedOk: true });
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
        {mode === "auto" ? (
          <LoopPanel />
        ) : (
          <>
            <ChatView />
            {activityOpen && <ActivityPanel />}
          </>
        )}
      </div>
      {settings.debugDrawer && <DebugDrawer />}
      <StatusBar />
    </div>
  );
}
