import { useState } from "react";
import { useLoopStore } from "@/stores/useLoopStore";
import { isLoopActive, type LoopStatus } from "@/types/loop";
import { BACKENDS } from "@/types/settings";
import { runOptionsSummary } from "@/lib/modelCatalog";
import IterationTimeline from "./IterationTimeline";
import GoalCard from "./GoalCard";

/**
 * Auto-mode surface. Shows the goal form when idle (or when starting a new
 * run after one finished), and the live run view — timeline, "now doing" line,
 * cost ticker, Stop button, and a final status banner — while a loop exists.
 */
export default function LoopPanel() {
  const state = useLoopStore((s) => s.state);
  const [startNew, setStartNew] = useState(false);

  const active = isLoopActive(state?.status);

  if (!state || (!active && startNew)) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <GoalCard />
      </div>
    );
  }

  return <RunView onNewGoal={() => setStartNew(true)} />;
}

function RunView({ onNewGoal }: { onNewGoal: () => void }) {
  const state = useLoopStore((s) => s.state)!;
  const nowDoing = useLoopStore((s) => s.nowDoing);
  const stop = useLoopStore((s) => s.stop);
  const active = isLoopActive(state.status);
  const backend = BACKENDS[state.options.agent.backend];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {/* Goal + cost ticker */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-fg-dim">
                Goal
              </p>
              <p className="mt-0.5 text-sm text-fg">{state.goal}</p>
              <p className="mt-1 text-xs text-fg-dim">
                {backend.label} · {runOptionsSummary(state.options.agent)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs uppercase tracking-wide text-fg-dim">
                {backend.reportsCost ? "Spent" : "Progress"}
              </p>
              <p className="mt-0.5 font-mono text-sm text-fg">
                {backend.reportsCost ? (
                  <>
                    ${state.totalCostUsd.toFixed(2)}
                    <span className="text-fg-dim">
                      {" "}/ ${state.options.maxCostUsd.toFixed(0)}
                    </span>
                  </>
                ) : (
                  <>
                    {state.iterations.length}
                    <span className="text-fg-dim">
                      {" "}/ {state.options.maxIterations} steps
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {state.referenceImages.length > 0 && (
            <p className="text-xs text-fg-dim">
              {state.referenceImages.length} reference image
              {state.referenceImages.length === 1 ? "" : "s"}
            </p>
          )}

          {active ? (
            <NowDoing label={nowDoing} status={state.status} />
          ) : (
            <StatusBanner status={state.status} agentLabel={backend.label} />
          )}

          {state.warnings.map((w) => (
            <p
              key={w}
              className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              {w}
            </p>
          ))}

          {active && <FeedbackComposer />}

          <IterationTimeline iterations={state.iterations} />
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="glass-bar mx-3 mb-3 rounded-2xl border px-6 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="text-xs text-fg-dim">
            Step {state.iterations.length}
            {" · "}
            {state.options.maxIterations} max
          </span>
          {active ? (
            <button
              onClick={() => void stop()}
              disabled={state.status === "stopping"}
              className="rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:brightness-110 disabled:opacity-50"
            >
              {state.status === "stopping" ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              onClick={onNewGoal}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-accent-hover"
            >
              Start another
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackComposer() {
  const state = useLoopStore((s) => s.state)!;
  const addFeedback = useLoopStore((s) => s.addFeedback);
  const sending = useLoopStore((s) => s.feedbackSending);
  const error = useLoopStore((s) => s.feedbackError);
  const [comment, setComment] = useState("");
  const pending = state.feedback.filter(
    (item) => item.appliedAtIteration === null,
  );
  const lastApplied = [...state.feedback]
    .reverse()
    .find((item) => item.appliedAtIteration !== null);
  const accepting = state.currentRunId !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim() || !accepting || sending) return;
    if (await addFeedback(comment.trim())) setComment("");
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="glass-card rounded-xl border px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="loop-feedback"
            className="text-xs font-semibold text-fg-muted"
          >
            Guide the next step
          </label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-dim">
            Add feedback now. It is evaluated after the current agent turn,
            before the next plan.
          </p>
        </div>
        {pending.length > 0 && (
          <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            {pending.length} queued
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea
          id="loop-feedback"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          rows={2}
          disabled={!accepting || sending}
          placeholder={
            accepting
              ? "Example: Keep the layout, but make the player easier to see."
              : "Waiting for the next agent step…"
          }
          className="selectable min-h-[3rem] flex-1 resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-fg placeholder:text-fg-dim focus:border-accent/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!comment.trim() || !accepting || sending}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {sending ? "Adding…" : "Add feedback"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      {pending.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-white/[0.06] pt-2">
          {pending.map((item) => (
            <li
              key={item.id}
              className="truncate text-[11px] text-fg-muted"
              title={item.text}
            >
              Queued: {item.text}
            </li>
          ))}
        </ul>
      )}
      {pending.length === 0 && lastApplied && lastApplied.appliedAtIteration !== null && (
        <p className="mt-2 truncate text-[11px] text-fg-dim" title={lastApplied.text}>
          Applied to step {lastApplied.appliedAtIteration + 1}: {lastApplied.text}
        </p>
      )}
    </form>
  );
}

function NowDoing({
  label,
  status,
}: {
  label: string | null;
  status: LoopStatus;
}) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-xl border px-4 py-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <span className="text-sm text-fg">
        {status === "stopping"
          ? "Stopping…"
          : (label ?? "Working…")}
      </span>
    </div>
  );
}

function StatusBanner({
  status,
  agentLabel,
}: {
  status: LoopStatus;
  agentLabel: string;
}) {
  const map: Record<
    LoopStatus,
    { text: string; cls: string } | undefined
  > = {
    done: {
      text: "Done — the goal is complete.",
      cls: "bg-success/10 text-success",
    },
    stopped: { text: "Stopped.", cls: "bg-ink-800 text-fg-muted" },
    blocked: {
      text: `${agentLabel} got stuck and couldn't continue. Try refining the goal.`,
      cls: "bg-danger/10 text-danger",
    },
    max_iterations: {
      text: "Reached the step limit before finishing.",
      cls: "bg-warning/10 text-warning",
    },
    cost_capped: {
      text: "Reached the budget limit before finishing.",
      cls: "bg-warning/10 text-warning",
    },
    failed: {
      text: `${agentLabel} couldn't start or finish this task. See the detail below.`,
      cls: "bg-danger/10 text-danger",
    },
    running: undefined,
    stopping: undefined,
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <div className={`rounded-xl px-4 py-3 text-sm font-medium ${entry.cls}`}>
      {entry.text}
    </div>
  );
}
