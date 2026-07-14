import { useEffect, useState } from "react";
import { api } from "@/api";
import { useOnboardingProgress } from "@/hooks/useOnboarding";
import BackendPicker from "@/components/shell/BackendPicker";
import { BACKENDS, type AgentBackend } from "@/types/settings";
import type { CliStatus } from "@/types/onboarding";
import { PrimaryButton, ProgressLog, Spinner, StepHeading } from "./_shared";

/**
 * Step 1 — pick the agent, then get its CLI onto this machine. The check runs
 * on mount and again on every backend switch (the two CLIs are independent).
 * Found → a green confirmation and Continue. Missing → an Install button that
 * streams the official installer's output.
 */
export default function WelcomeStep({
  backend,
  onBackendChange,
  initial,
  onContinue,
}: {
  backend: AgentBackend;
  onBackendChange: (backend: AgentBackend) => void;
  /** Status from `onboarding_status` for the CURRENT backend, if we have one. */
  initial: CliStatus | null;
  onContinue: () => void;
}) {
  const [status, setStatus] = useState<CliStatus | null>(initial);
  const [checking, setChecking] = useState(!initial);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lines, reset } = useOnboardingProgress("install_cli");

  const meta = BACKENDS[backend];

  // Adopt the seeded status for whichever backend is selected; re-probe only
  // when we don't already know (a switch hands us the other CLI's status).
  useEffect(() => {
    setStatus(initial);
    setError(null);
    if (initial) {
      setChecking(false);
      return;
    }
    let alive = true;
    setChecking(true);
    void api
      .onboardingCheckCli(backend)
      .then((s) => alive && setStatus(s))
      .catch(
        () => alive && setStatus({ found: false, path: null, version: null }),
      )
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [backend, initial]);

  async function install() {
    setError(null);
    reset();
    setInstalling(true);
    try {
      const s = await api.onboardingInstallCli(backend);
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div>
      <StepHeading title="Welcome to Unity Vibe Studio">
        Make Unity changes just by chatting — no terminal needed. First, pick the
        AI agent you want to drive it.
      </StepHeading>

      <div className="mt-6">
        <BackendPicker value={backend} onChange={onBackendChange} showBlurb />
      </div>

      {checking && (
        <div className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner /> Checking for the {meta.label} CLI…
        </div>
      )}

      {!checking && status?.found && (
        <div className="mt-6">
          <div className="rounded-xl border border-success/30 bg-success/5 p-4">
            <div className="text-sm font-medium text-fg">
              {meta.label} CLI is installed
            </div>
            <div className="mt-0.5 text-xs text-fg-dim">
              {status.version ?? "version unknown"}
            </div>
          </div>
          <div className="mt-6">
            <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
          </div>
        </div>
      )}

      {!checking && status && !status.found && (
        <div className="mt-6">
          <p className="text-sm text-fg-muted">
            The <span className="font-mono text-fg">{meta.cli}</span> helper
            isn&apos;t installed yet. We can install it for you — this needs an
            internet connection and takes a minute.
          </p>
          <div className="mt-5">
            <PrimaryButton onClick={() => void install()} busy={installing}>
              Install {meta.label} CLI
            </PrimaryButton>
          </div>
          <ProgressLog lines={lines} />
          {error && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <div className="text-xs text-fg-muted">{error}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
