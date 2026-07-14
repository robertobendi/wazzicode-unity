import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useChatStore } from "@/stores/useChatStore";
import { useSessionsStore } from "@/stores/useSessionsStore";
import { useDebugStore } from "@/stores/useDebugStore";
import type { DoneEvent, ErrorEvent } from "@/types/chat";

/**
 * Subscribe to the per-run agent events for the active run and feed them into
 * the chat store. The run id lives in the event name (`agent:stream:<runId>`
 * etc.), so we (re)subscribe whenever it changes and tear down on completion.
 *
 * Backend-agnostic: Rust emits the same three event names whichever CLI is
 * driving, and `reduceStream` folds either vocabulary (see `streamMapper.ts`).
 *
 * Race note: `activeRunId` is set right after `chat_send` returns, which is far
 * sooner than the agent child produces its first line (process cold start), so
 * listeners are in place before any event fires.
 */
export function useAgentStream() {
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

    const debug = useDebugStore.getState().push;

    void listen<unknown>(`agent:stream:${activeRunId}`, (e) => {
      debug("stream", e.payload);
      ingest(activeRunId, e.payload);
    }).then(register);
    void listen<DoneEvent>(`agent:done:${activeRunId}`, (e) => {
      debug("done", e.payload);
      finish(activeRunId, e.payload);
      // Persist the conversation once the turn (and its session id) is settled.
      const project = useChatStore.getState().project;
      if (project) void useSessionsStore.getState().autosave(project);
    }).then(register);
    void listen<ErrorEvent>(`agent:error:${activeRunId}`, (e) => {
      debug("error", e.payload);
      fail(activeRunId, e.payload);
    }).then(register);

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, [activeRunId]);
}
