import { useEffect, useState } from "react";
import { api } from "@/api";
import { useOnboardingProgress } from "@/hooks/useOnboarding";
import type { CliStatus } from "@/types/onboarding";
import {
  PrimaryButton,
  ProgressLog,
  Spinner,
  StepHeading,
} from "./_shared";

/**
 * Step 1 — welcome + Claude CLI check. Auto-runs the check on mount. Found → a
 * green confirmation and Continue. Missing → an Install button that streams the
 * official installer's output, with a copy-able manual command on failure.
 */
export default function WelcomeStep({
  initial,
  onContinue,
}: {
  initial: CliStatus | null;
  onContinue: () => void;
}) {
  const [status, setStatus] = useState<CliStatus | null>(initial);
  const [checking, setChecking] = useState(!initial);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lines, reset } = useOnboardingProgress("install_cli");

  useEffect(() => {
    if (initial) return;
    let alive = true;
    void api
      .onboardingCheckCli()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ found: false, path: null, version: null }))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [initial]);

  async function install() {
    setError(null);
    reset();
    setInstalling(true);
    try {
      const s = await api.onboardingInstallCli();
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
        Make Unity changes just by chatting — no terminal needed. First, we need
        the Claude command-line helper on this computer.
      </StepHeading>

      {checking && (
        <div className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner /> Checking for the Claude CLI…
        </div>
      )}

      {!checking && status?.found && (
        <div className="mt-6">
          <div className="rounded-xl border border-success/30 bg-success/5 p-4">
            <div className="text-sm font-medium text-fg">Claude CLI is installed</div>
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
            It&apos;s not installed yet. We can install it for you — this needs an
            internet connection and takes a minute.
          </p>
          <div className="mt-5">
            <PrimaryButton onClick={() => void install()} busy={installing}>
              Install Claude CLI
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
