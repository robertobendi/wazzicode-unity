import { useRef, useState } from "react";
import { useChatStore } from "@/stores/useChatStore";

/** Prompt input: Enter to send, Shift+Enter for a newline, Stop while running. */
export default function Composer() {
  const running = useChatStore((s) => s.running);
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || running) return;
    setValue("");
    void send(text);
    // Reset the textarea height after clearing.
    requestAnimationFrame(() => autosize(ref.current));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-white/5 bg-ink-900 px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask Claude to change your game…"
          className="selectable max-h-40 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim transition-colors duration-150 focus:border-ink-600 focus:outline-none"
        />
        {running ? (
          <button
            onClick={() => void cancel()}
            className="shrink-0 rounded-xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-ink-700"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
