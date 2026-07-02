import { useEffect, useRef } from "react";
import { api } from "@/api";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useUiStore } from "@/stores/useUiStore";

/**
 * Small settings panel anchored under the gear. Everyday toggle (debug drawer)
 * plus an "Admin" section (power mode, model override, account pairing) for
 * advanced users.
 */
export default function SettingsPopover() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const setRepairing = useUiStore((s) => s.setRepairing);
  const ref = useRef<HTMLDivElement>(null);

  async function repair() {
    // Clear only OUR connection flag (the CLI keeps its own credentials); the
    // re-pair screen re-probes and re-pairs if needed.
    await api.authClear();
    await update({ pairedOk: false });
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

  return (
    <div
      ref={ref}
      className="absolute right-3 top-12 z-30 w-72 animate-appear rounded-xl border border-white/10 bg-ink-850 p-4 shadow-xl shadow-black/30"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">
        Settings
      </div>

      <Toggle
        label="Debug drawer"
        hint="Show the raw event log for troubleshooting."
        checked={settings.debugDrawer}
        onChange={(v) => void update({ debugDrawer: v })}
      />

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

        <label className="mt-3 block">
          <span className="text-sm text-fg-muted">Model</span>
          <input
            type="text"
            value={settings.model ?? ""}
            placeholder="Default"
            spellCheck={false}
            onChange={(e) =>
              void update({ model: e.target.value.trim() || null })
            }
            className="selectable mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-dim focus:border-ink-600 focus:outline-none"
          />
        </label>

        <div className="mt-4 flex items-center justify-between">
          <span>
            <span className="block text-sm text-fg">Company account</span>
            <span className="block text-xs text-fg-dim">
              {settings.pairedOk ? "Connected" : "Not connected"}
            </span>
          </span>
          <button
            onClick={() => void repair()}
            className="shrink-0 rounded-md bg-ink-700 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-600"
          >
            Re-pair
          </button>
        </div>

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
            className="shrink-0 rounded-md bg-ink-700 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-600"
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
