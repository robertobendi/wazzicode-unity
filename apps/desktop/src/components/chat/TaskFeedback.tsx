import { useChatStore } from "@/stores/useChatStore";
import { BACKENDS } from "@/types/settings";

/**
 * A compact, always-visible explanation of what the active task is doing.
 * The detailed activity panel can stay closed; this still answers the basic
 * "did my click work?" and "what is it doing now?" questions.
 */
export default function TaskFeedback() {
  const running = useChatStore((s) => s.running);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const cancelRequested = useChatStore((s) => s.cancelRequested);
  const draft = useChatStore((s) => s.draft);
  const backend = useChatStore((s) => s.session.backend ?? "claude");

  if (!running) return null;

  const activities = draft?.activities ?? [];
  const complete = activities.filter((a) => a.status !== "running").length;
  const current = [...activities].reverse().find((a) => a.status === "running");

  let label: string;
  let detail: string;
  if (cancelRequested) {
    label = "Stopping safely…";
    detail = "Finishing the current operation";
  } else if (!activeRunId) {
    label = "Starting your task…";
    detail = `Connecting ${BACKENDS[backend].label} to the project`;
  } else if (current) {
    label = current.friendlyLabel;
    detail = complete > 0 ? `${complete} ${complete === 1 ? "step" : "steps"} complete` : "Working in your project";
  } else if (draft?.text.trim()) {
    label = "Writing up the result…";
    detail = complete > 0 ? `${complete} ${complete === 1 ? "step" : "steps"} complete` : "Almost done";
  } else {
    label = "Planning the next step…";
    detail = complete > 0 ? `${complete} ${complete === 1 ? "step" : "steps"} complete` : "Your task is running";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-xl border border-accent/20 bg-accent/[0.07] px-3.5 py-2"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-35" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-fg">{label}</div>
        <div className="truncate text-[11px] text-fg-dim">{detail}</div>
      </div>
    </div>
  );
}
