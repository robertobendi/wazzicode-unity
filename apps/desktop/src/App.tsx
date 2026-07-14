import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { useSessionsStore } from "@/stores/useSessionsStore";
import { useRevertStore } from "@/stores/useRevertStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useDebugCapture } from "@/hooks/useDebugCapture";
import { useLoopEvents } from "@/hooks/useLoopEvents";
import { useCheckpointEvents } from "@/hooks/useCheckpointEvents";
import { useLoopStore } from "@/stores/useLoopStore";
import PairingScreen from "@/components/pairing/PairingScreen";
import CodexAuthScreen from "@/components/codex/CodexAuthScreen";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import ProjectPicker from "@/components/project/ProjectPicker";
import ChatView from "@/components/chat/ChatView";
import SessionRail from "@/components/chat/SessionRail";
import LoopPanel from "@/components/loop/LoopPanel";
import ActivityPanel from "@/components/activity/ActivityPanel";
import StatusBar from "@/components/shell/StatusBar";
import TopBar from "@/components/shell/TopBar";
import ConnectionBanner from "@/components/shell/ConnectionBanner";
import DebugDrawer from "@/components/shell/DebugDrawer";
import ToastHost from "@/components/shell/Toast";

export default function App() {
  const { settings, load } = useSettingsStore();
  const updateSettings = useSettingsStore((s) => s.update);
  const setProject = useChatStore((s) => s.setProject);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const sessionRailOpen = useUiStore((s) => s.sessionRailOpen);
  const mode = useUiStore((s) => s.mode);
  const repairing = useUiStore((s) => s.repairing);
  const setRepairing = useUiStore((s) => s.setRepairing);
  const hydrateLoop = useLoopStore((s) => s.hydrate);

  useEffect(() => {
    void load();
  }, [load]);

  const project = settings?.currentProject ?? null;

  // Keep the chat store's project in sync (resets the conversation on change).
  // On a real switch, autosave the outgoing chat and reload history for the new
  // project; clear the stale revert checkpoint.
  useEffect(() => {
    const prev = useChatStore.getState();
    if (prev.project && prev.project !== project) {
      void useSessionsStore.getState().autosave(prev.project);
      useSessionsStore.getState().reset();
      useRevertStore.getState().clear();
    }
    setProject(project);
    if (project) void useSessionsStore.getState().refresh(project);
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
  useCheckpointEvents();

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

  // Auth gate FIRST (the connection is per-machine, not per-project), routed by
  // backend. Claude: show it when this machine hasn't paired — or on admin
  // re-pair; the persisted `pairedOk` flag decides (PairingScreen re-checks on
  // mount). Codex: there's no such flag — the CLI's own sign-in state is the
  // truth, so we only interrupt when the user explicitly asks to sign in, and
  // CodexAuthScreen probes for itself.
  if (settings.agentBackend === "codex") {
    if (repairing) {
      return <CodexAuthScreen onDone={() => setRepairing(false)} />;
    }
  } else if (!settings.pairedOk || repairing) {
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
            {sessionRailOpen && <SessionRail />}
            <ChatView />
            {activityOpen && <ActivityPanel />}
          </>
        )}
      </div>
      {settings.debugDrawer && <DebugDrawer />}
      <StatusBar />
      <ToastHost />
    </div>
  );
}
