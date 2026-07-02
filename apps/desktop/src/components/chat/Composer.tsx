import { useRef, useState } from "react";
import { useChatStore } from "@/stores/useChatStore";
import { useAttachmentsStore } from "@/stores/useAttachmentsStore";
import { useLoopStore } from "@/stores/useLoopStore";
import { useQuickActions } from "@/hooks/useQuickActions";
import { isLoopActive } from "@/types/loop";
import { api } from "@/api";
import AttachmentChip from "./AttachmentChip";

/** Prompt input: Enter to send, Shift+Enter for a newline, Stop while running. */
export default function Composer() {
  const running = useChatStore((s) => s.running);
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const project = useChatStore((s) => s.project);
  const loopRunning = useLoopStore((s) => isLoopActive(s.state?.status));
  const attachments = useAttachmentsStore((s) => s.items);
  const removeAttachment = useAttachmentsStore((s) => s.remove);
  const addAttachments = useAttachmentsStore((s) => s.add);
  const clearAttachments = useAttachmentsStore((s) => s.clear);
  const quickActions = useQuickActions(project);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const canSend =
    (value.trim() || attachments.length > 0) && !running && !loopRunning;

  // A quiet starter-prompt row, only on an empty, idle composer.
  const showQuickActions =
    !value.trim() &&
    attachments.length === 0 &&
    !running &&
    !loopRunning &&
    quickActions.length > 0;

  // Fill (don't send) — the employee can tweak the prompt before hitting Enter.
  function fillPrompt(prompt: string) {
    setValue(prompt);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        autosize(el);
      }
    });
  }

  function submit() {
    if (!canSend) return;
    const text = value.trim();
    setValue("");
    void send(text, attachments);
    clearAttachments(); // detach — the files now belong to the sent message
    requestAnimationFrame(() => autosize(ref.current));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // The webview can't see OS file paths (or reliably image bytes) on paste, so
  // ask Rust to read the OS clipboard. Text still pastes normally into the
  // textarea; files/images are staged as attachments in addition.
  function onPaste() {
    if (!project) return;
    void api
      .pasteClipboard(project)
      .then((staged) => {
        if (staged.length) addAttachments(staged);
      })
      .catch(() => {
        // Text-only clipboards return []; a read failure is non-fatal here.
      });
  }

  return (
    <div className="border-t border-white/5 bg-ink-900 px-4 py-3">
      <div className="mx-auto max-w-2xl">
        {showQuickActions && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                onClick={() => fillPrompt(qa.prompt)}
                className="shrink-0 whitespace-nowrap rounded-full border border-ink-700 bg-ink-850 px-3 py-1 text-xs text-fg-muted transition-colors duration-150 hover:border-ink-600 hover:text-fg"
              >
                {qa.label}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRemove={(id) => void removeAttachment(id)}
              />
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autosize(e.target);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={loopRunning}
            placeholder={
              loopRunning
                ? "Auto mode is running…"
                : "Ask Claude to change your game…"
            }
            className="selectable max-h-40 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim transition-colors duration-150 focus:border-ink-600 focus:outline-none disabled:opacity-50"
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
              disabled={!canSend}
              className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
