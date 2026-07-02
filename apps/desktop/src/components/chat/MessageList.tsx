import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/useChatStore";
import MessageBubble from "./MessageBubble";

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as text streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h2 className="text-lg font-medium text-fg">What should we build?</h2>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">
          Ask in plain language — e.g. “make the cube red”, “add a jump to the
          player”, or “why is my scene dark?”. I’ll work in Unity for you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
