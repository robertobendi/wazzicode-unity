import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import AgentRunControls from "@/components/agent/AgentRunControls";
import { useCliSetup, useOnboardingProgress } from "@/hooks/useOnboarding";
import { runOptionsFromSettings } from "@/lib/agentOptions";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { usePairingStore } from "@/stores/usePairingStore";
import { useChatStore } from "@/stores/useChatStore";
import { useLoopStore } from "@/stores/useLoopStore";
import { isLoopActive } from "@/types/loop";
import { useUiStore } from "@/stores/useUiStore";
import type { AgentRunOptions } from "@/types/agent";
import { BACKENDS, type AgentBackend } from "@/types/settings";
import BackendPicker from "./BackendPicker";

/**
 * Small settings panel anchored under the gear. The agent picker sits on top
 * (it decides what everything below means), then the everyday toggle (debug
 * drawer) and an "Admin" section (power mode, redo setup) for advanced users.
 *
 * Model override and sign-in are per-backend: we only ever show the selected
 * backend's, so a Claude model id can't be handed to Codex or vice versa.
 */
export default function SettingsPopover() {
  const settings = useSettingsStore((s) => s.settings);
  const saveError = useSettingsStore((s) => s.error);
  const update = useSettingsStore((s) => s.update);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const setRepairing = useUiStore((s) => s.setRepairing);
  const ref = useRef<HTMLDivElement>(null);
  const chatRunning = useChatStore((s) => s.running);
  const loopRunning = useLoopStore((s) => isLoopActive(s.state?.status));
  const taskActive = chatRunning || loopRunning;

  const backend: AgentBackend = settings?.agentBackend ?? "claude";
  const cli = useCliSetup(backend);
  const progress = useOnboardingProgress("install_cli");
  const [codexSignedIn, setCodexSignedIn] = useState<boolean | null>(null);
  const defaults: AgentRunOptions = settings
    ? runOptionsFromSettings(settings, backend)
    : { backend, model: null, effort: null };

  useEffect(() => {
    let alive = true;
    setCodexSignedIn(null);
    if (backend === "codex" && cli.status?.found && !cli.error) {
      void api
        .codexAuthStatus()
        .then((s) => alive && setCodexSignedIn(s.loggedIn))
        .catch(() => alive && setCodexSignedIn(null));
    }

    return () => {
      alive = false;
    };
  }, [backend, cli.error, cli.status?.found, cli.status?.version]);

  function updateDefaults(next: AgentRunOptions) {
    void update(
      backend === "codex"
        ? { codexModel: next.model, codexEffort: next.effort }
        : { model: next.model, effort: next.effort },
    );
  }

  async function installCli() {
    if (taskActive) return;
    progress.reset();
    await cli.install();
  }

  async function repair() {
    if (taskActive) return;
    // Keep the working token until the replacement is verified and promoted.
    await usePairingStore.getState().cancel();
    setOpen(false);
    setRepairing(true);
  }

  // Codex sign-in lives on its own full-screen surface (App routes `repairing`
  // by backend), so the popover just hands off.
  function signInToCodex() {
    if (taskActive) return;
    setOpen(false);
    setRepairing(true);
  }

  // Dismiss on outside click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [setOpen]);

  if (!settings) return null;

  const meta = BACKENDS[backend];

  return (
    <div
      ref={ref}
      className="glass-card absolute right-3 top-14 z-30 max-h-[calc(100vh-5rem)] w-80 animate-appear overflow-y-auto rounded-2xl border p-4"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">
        Agent
      </div>

      <div className="mt-2">
        <BackendPicker
          value={backend}
          onChange={(b) => void update({ agentBackend: b })}
          disabled={cli.installing || taskActive}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-dim">{meta.blurb}</p>
      {taskActive && (
        <p className="mt-2 rounded-lg border border-warning/20 bg-warning/5 px-2.5 py-2 text-xs leading-relaxed text-fg-muted">
          Stop the current task before changing agents, installing a CLI, or reconnecting an account.
        </p>
      )}

      {saveError && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <p className="text-xs leading-relaxed text-danger">
            Settings could not be saved. The visible changes are temporary.
          </p>
          <pre className="selectable mt-1 whitespace-pre-wrap break-words font-sans text-[11px] text-fg-muted">
            {saveError}
          </pre>
          <button
            onClick={() => void update({})}
            className="mt-2 rounded-md border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-danger/60"
          >
            Retry save
          </button>
        </div>
      )}

      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
          New task defaults
        </div>
        <AgentRunControls
          value={defaults}
          onChange={updateDefaults}
          disabled={cli.installing}
          refreshKey={cli.status?.version}
        />
      </div>

      {!cli.checking && (!cli.status?.found || cli.error) && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs leading-relaxed text-fg-muted">
            The <span className="font-mono text-fg">{meta.cli}</span> helper is
            not ready.
          </p>
          {cli.error && (
            <pre className="selectable mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-warning">
              {cli.error}
            </pre>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => void installCli()}
              disabled={cli.installing || taskActive}
              className="rounded-md bg-accent px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {cli.installing ? "Installing…" : "Install CLI"}
            </button>
            <button
              onClick={() => void cli.check()}
              disabled={cli.installing}
              className="rounded-md border border-ink-700 px-2.5 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-ink-600 hover:text-fg disabled:opacity-50"
            >
              Check again
            </button>
          </div>
          {progress.lines.length > 0 && (
            <pre className="selectable mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-ink-950 p-2 text-[10px] leading-relaxed text-fg-dim">
              {progress.lines.join("\n")}
            </pre>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-fg">
            {backend === "codex" ? "ChatGPT account" : "Company account"}
          </span>
          <span className="block truncate text-xs text-fg-dim">
            {backend === "codex"
              ? codexSignedIn === null
                ? "Checking…"
                : codexSignedIn
                  ? "Signed in"
                  : "Not signed in"
              : settings.pairedOk
                ? "Connected"
                : "Not connected"}
          </span>
        </span>
        {backend === "codex" ? (
          <button
            onClick={signInToCodex}
            disabled={
              !cli.status?.found || !!cli.error || cli.installing || taskActive
            }
            className="shrink-0 rounded-md bg-ink-700 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-600 disabled:opacity-50"
          >
            {codexSignedIn ? "Re-sign in" : "Sign in"}
          </button>
        ) : (
          <button
            onClick={() => void repair()}
            disabled={
              !cli.status?.found || !!cli.error || cli.installing || taskActive
            }
            className="shrink-0 rounded-md bg-ink-700 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-600 disabled:opacity-50"
          >
            Re-pair
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">
          Settings
        </div>

        <Toggle
          label="Debug drawer"
          hint="Show the raw event log for troubleshooting."
          checked={settings.debugDrawer}
          onChange={(v) => void update({ debugDrawer: v })}
        />
      </div>

      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">
          Admin
        </div>

        <Toggle
          label="Power mode"
          hint="Let the AI act without per-step approval."
          checked={settings.powerMode}
          onChange={(v) => void update({ powerMode: v })}
        />

        <div className="mt-4 flex items-center justify-between">
          <span>
            <span className="block text-sm text-fg">Redo setup</span>
            <span className="block text-xs text-fg-dim">
              Run the first-run wizard again.
            </span>
          </span>
          <button
            onClick={() => {
              void update({ onboarded: false });
              setOpen(false);
            }}
            disabled={cli.installing || taskActive}
            className="shrink-0 rounded-md bg-ink-700 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Redo
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="mt-3 flex w-full items-start justify-between gap-3 text-left"
    >
      <span>
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-xs text-fg-dim">{hint}</span>
      </span>
      <span
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-150 ${
          checked ? "bg-accent" : "bg-ink-700"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
