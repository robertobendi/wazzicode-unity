// Shared building blocks for the onboarding wizard steps. Styled to match
// PairingScreen (numbered progress dots, one card per step, design tokens).

import type { ReactNode } from "react";

export const STEP_LABELS = ["Agent", "Project", "Set up", "Connect", "Ready"];

export function Stepper({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {STEP_LABELS.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors ${
                done
                  ? "bg-accent/20 text-accent"
                  : active
                    ? "bg-accent text-white"
                    : "bg-ink-800 text-fg-dim"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`hidden text-xs sm:inline ${active ? "text-fg" : "text-fg-dim"}`}>
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <span className="ml-1 h-px flex-1 bg-white/5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StepHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 h-1.5 w-10 rounded-full bg-accent/70" />
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      {children && <p className="mt-2 text-sm text-fg-muted">{children}</p>}
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  busy,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {busy ? (
        <>
          <Spinner /> Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-ink-700 px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-600"
    >
      {children}
    </button>
  );
}

/** A quiet mono box that tails process output (installer / setup lines). */
export function ProgressLog({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <pre className="selectable mt-4 max-h-40 overflow-auto rounded-lg border border-white/10 bg-ink-900 p-3 text-[11px] leading-relaxed text-fg-dim">
      {lines.join("\n")}
    </pre>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  const size = large ? "h-8 w-8 border-[3px]" : "h-4 w-4 border-2";
  return (
    <span
      className={`inline-block ${size} animate-spin rounded-full border-white/30 border-t-white`}
      aria-hidden
    />
  );
}

export function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        ok
          ? "border-success/40 text-success"
          : "border-ink-700 text-fg-muted"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-fg-dim"}`} />
      {children}
    </span>
  );
}
