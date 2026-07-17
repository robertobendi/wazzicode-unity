import { useEffect, useState } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { useSessionsStore } from "@/stores/useSessionsStore";
import { useRevertStore } from "@/stores/useRevertStore";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useDebugCapture } from "@/hooks/useDebugCapture";
import { useLoopEvents } from "@/hooks/useLoopEvents";
import { useCheckpointEvents } from "@/hooks/useCheckpointEvents";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useLoopStore } from "@/stores/useLoopStore";
import PairingScreen from "@/components/pairing/PairingScreen";
import CodexAuthScreen from "@/components/codex/CodexAuthScreen";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import ProjectPicker from "@/components/project/ProjectPicker";
import ChatView from "@/components/chat/ChatView";
import SessionRail from "@/components/chat/SessionRail";
import LoopPanel from "@/components/loop/LoopPanel";
import ActivityPanel from "@/components/activity/ActivityPanel";
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
  const [codexReady, setCodexReady] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const project = settings?.currentProject ?? null;

  function chooseAgent() {
    setCodexReady(false);
    setRepairing(false);
    void updateSettings({ onboarded: false });
  }

  useEffect(() => {
    if (settings?.agentBackend !== "codex") setCodexReady(false);
  }, [settings?.agentBackend]);

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
  useAgentStream();
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
        onComplete={() => {
          if (settings.agentBackend === "codex") setCodexReady(true);
          void updateSettings({ onboarded: true });
        }}
      />
    );
  }

  // Auth gate FIRST (the connection is per-machine, not per-project), routed by
  // backend. Claude uses the app's persisted pairing flag; Codex probes the
  // CLI's ChatGPT login once per app/backend selection. Explicit reconnects
  // force the corresponding browser/setup-token flow.
  if (settings.agentBackend === "codex") {
    if (!codexReady || repairing) {
      return (
        <CodexAuthScreen
          onDone={() => {
            setCodexReady(true);
            setRepairing(false);
          }}
          onChooseAgent={chooseAgent}
          forceSignIn={repairing}
        />
      );
    }
  } else if (!settings.pairedOk || repairing) {
    return (
      <PairingScreen
        onDone={() => {
          void updateSettings({ pairedOk: true });
          setRepairing(false);
        }}
        onChooseAgent={chooseAgent}
        forcePair={repairing || !settings.pairedOk}
      />
    );
  }

  if (!project) {
    return <ProjectPicker />;
  }

  return (
    <div className="app-shell flex h-full w-full flex-col bg-ink-950 text-fg">
      <TopBar />
      <ConnectionBanner />
      <div className="relative flex min-h-0 flex-1">
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
      <ToastHost />
    </div>
  );
}
