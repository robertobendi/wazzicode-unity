import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/useChatStore";
import Logo from "@/components/shell/Logo";
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
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-8 text-center">
        <div className="empty-state-card animate-appear">
          <div className="identity-mark mx-auto">
            <Logo size={27} />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-accent/70">
            Studio ready
          </div>
          <h2 className="mt-3 text-xl font-semibold text-fg">
            What should we make?
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">
            Describe a change in plain language. Vibe Studio will handle the
            Unity work and keep you in the loop.
          </p>
          <div className="mt-6 flex flex-col items-stretch gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => void send(ex)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-2.5 text-sm text-fg-muted transition-colors duration-150 hover:border-accent/20 hover:bg-white/[0.05] hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
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
