import { useEffect, useState } from "react";
import { api } from "@/api";
import { useSettingsStore } from "@/stores/useSettingsStore";
import PairingScreen from "@/components/pairing/PairingScreen";
import type { OnboardingStatus } from "@/types/onboarding";
import type { ProjectInfo } from "@/types/project";
import { Spinner, Stepper } from "./_shared";
import WelcomeStep from "./WelcomeStep";
import ProjectStep from "./ProjectStep";
import SetupStep from "./SetupStep";
import ReadyStep from "./ReadyStep";

const STEP = {
  welcome: 0,
  project: 1,
  setup: 2,
  connect: 3,
  ready: 4,
} as const;

/**
 * First-run wizard. Subsumes the pairing gate + project pick on a fresh install:
 * detect/install the Claude CLI → pick project → prepare it → connect the
 * company account → confirm Unity connects. Completing sets settings.onboarded.
 */
export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const updateSettings = useSettingsStore((s) => s.update);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [step, setStep] = useState<number>(STEP.welcome);
  const [project, setProject] = useState<ProjectInfo | null>(null);

  // Load status once to seed the starting step (skip completed prerequisites).
  useEffect(() => {
    let alive = true;
    void api
      .onboardingStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        if (s.projectReady?.ok) setProject(s.projectReady);
        setStep(startStep(s));
      })
      .catch(() => alive && setStatus(EMPTY_STATUS));
    return () => {
      alive = false;
    };
  }, []);

  async function pickProject(info: ProjectInfo) {
    setProject(info);
    try {
      // Persist so ReadyStep's bridge poll + the post-onboarding app see it.
      const saved = await api.setCurrentProject(info.path);
      setSettings(saved);
    } catch {
      // Non-fatal — setup still runs against the chosen path.
    }
    setStep(STEP.setup);
  }

  if (!status) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-sm text-fg-dim">
        <Spinner /> <span className="ml-2">Getting things ready…</span>
      </div>
    );
  }

  // Connect step: hand off to the full PairingScreen. It check-firsts (already
  // authenticated → "Already connected ✓" and continues) and otherwise runs the
  // copy-link-to-admin flow. Its own stepper replaces the wizard chrome here.
  if (step === STEP.connect) {
    return (
      <PairingScreen
        onDone={() => {
          void updateSettings({ pairedOk: true });
          setStep(STEP.ready);
        }}
      />
    );
  }

  const projectName = project?.name ?? "your project";

  return (
    <div className="flex h-full w-full items-center justify-center bg-ink-950 px-8">
      <div className="w-full max-w-lg animate-appear">
        <Stepper current={step} />

        {step === STEP.welcome && (
          <WelcomeStep
            initial={status.claudeCli}
            onContinue={() => setStep(STEP.project)}
          />
        )}

        {step === STEP.project && (
          <ProjectStep
            initial={project ?? status.projectReady}
            onPicked={(info) => void pickProject(info)}
            onBack={() => setStep(STEP.welcome)}
          />
        )}

        {step === STEP.setup && project && (
          <SetupStep
            project={project.path}
            projectName={projectName}
            onDone={() => setStep(STEP.connect)}
            onBack={() => setStep(STEP.project)}
          />
        )}

        {step === STEP.ready && project && (
          <ReadyStep
            project={project.path}
            projectName={projectName}
            onFinish={onComplete}
          />
        )}
      </div>
    </div>
  );
}

/** Earliest step whose prerequisite isn't already satisfied. */
function startStep(s: OnboardingStatus): number {
  if (!s.claudeCli.found) return STEP.welcome;
  if (!s.projectReady?.ok) return STEP.project;
  return STEP.setup;
}

const EMPTY_STATUS: OnboardingStatus = {
  claudeCli: { found: false, path: null, version: null },
  nodeSidecar: { bundled: false },
  currentProject: null,
  projectReady: null,
  pairedOk: false,
};
