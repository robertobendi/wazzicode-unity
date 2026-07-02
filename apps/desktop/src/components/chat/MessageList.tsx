import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/useChatStore";
import MessageBubble from "./MessageBubble";

const EXAMPLES = [
  "Make the coins spin",
  "Add a pause menu",
  "Why is my scene dark?",
];

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as text streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h2 className="text-lg font-medium text-fg">
          Ask for any change to your game
        </h2>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">
          Describe it in plain language — I&rsquo;ll make it happen in Unity for
          you. Try one of these to start:
        </p>
        <div className="mt-5 flex flex-col items-stretch gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => void send(ex)}
              className="rounded-xl border border-white/5 bg-ink-900 px-4 py-2.5 text-sm text-fg-muted transition-colors duration-150 hover:border-white/10 hover:bg-ink-850 hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
