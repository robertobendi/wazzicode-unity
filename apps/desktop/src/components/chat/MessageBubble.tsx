import type { ChatMessage } from "@/types/chat";
import ToolActivityChip from "./ToolActivityChip";

/** One chat turn: user (right-accented) or assistant (left) with tool chips. */
export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/90 px-4 py-2.5 text-sm text-white">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {message.activities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.activities.map((a) => (
              <ToolActivityChip key={a.id} activity={a} />
            ))}
          </div>
        )}

        {message.text && (
          <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-ink-800 px-4 py-2.5 text-sm text-fg">
            {message.text}
            {message.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-fg-dim align-middle" />
            )}
          </div>
        )}

        {message.streaming && !message.text && message.activities.length === 0 && (
          <div className="flex items-center gap-2 px-1 text-sm text-fg-dim">
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-fg-dim border-t-transparent" />
            Thinking…
          </div>
        )}

        {message.error && (
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
            {message.error}
          </div>
        )}

        {typeof message.costUsd === "number" && (
          <div className="px-1 text-[11px] text-fg-dim">
            ${message.costUsd.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}
