import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useChatStore } from "@/stores/useChatStore";
import type { DoneEvent, ErrorEvent } from "@/types/chat";

/**
 * Subscribe to the per-run Claude events for the active run and feed them into
 * the chat store. The run id lives in the event name (`claude:stream:<runId>`
 * etc.), so we (re)subscribe whenever it changes and tear down on completion.
 *
 * Race note: `activeRunId` is set right after `chat_send` returns, which is far
 * sooner than the Claude child produces its first line (process cold start),
 * so listeners are in place before any event fires.
 */
export function useClaudeStream() {
  const activeRunId = useChatStore((s) => s.activeRunId);

  useEffect(() => {
    if (!activeRunId) return;
    const { ingest, finish, fail } = useChatStore.getState();
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const register = (u: UnlistenFn) => {
      if (cancelled) u();
      else unlisteners.push(u);
    };

    void listen<unknown>(`claude:stream:${activeRunId}`, (e) =>
      ingest(activeRunId, e.payload),
    ).then(register);
    void listen<DoneEvent>(`claude:done:${activeRunId}`, (e) =>
      finish(activeRunId, e.payload),
    ).then(register);
    void listen<ErrorEvent>(`claude:error:${activeRunId}`, (e) =>
      fail(activeRunId, e.payload),
    ).then(register);

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, [activeRunId]);
}
