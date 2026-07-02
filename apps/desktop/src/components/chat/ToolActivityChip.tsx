import type { ToolActivity } from "@/types/chat";

/** Inline chip showing one tool invocation with a spinner / check / cross. */
export default function ToolActivityChip({ activity }: { activity: ToolActivity }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-fg-muted"
      title={activity.resultText || activity.name}
    >
      <StatusIcon status={activity.status} />
      <span>{activity.friendlyLabel}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: ToolActivity["status"] }) {
  if (status === "running") {
    return (
      <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-fg-dim border-t-transparent" />
    );
  }
  if (status === "ok") {
    return <span className="text-emerald-400">✓</span>;
  }
  return <span className="text-accent">✕</span>;
}
