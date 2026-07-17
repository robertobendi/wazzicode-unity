import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/api";
import { useChatStore } from "@/stores/useChatStore";
import { useSessionsStore } from "@/stores/useSessionsStore";
import { useDebugStore } from "@/stores/useDebugStore";
import type {
  ChatTerminalEvent,
  DoneEvent,
  ErrorEvent,
} from "@/types/chat";

/**
 * Subscribe to the per-run agent events for the active run and feed them into
 * the chat store. The run id lives in the event name (`agent:stream:<runId>`
 * etc.), so we (re)subscribe whenever it changes and tear down on completion.
 *
 * Backend-agnostic: Rust emits the same three event names whichever CLI is
 * driving, and `reduceStream` folds either vocabulary (see `streamMapper.ts`).
 *
 * The backend caches a terminal event until `chatSubscribe` confirms all three
 * listeners are registered, closing the fast-failure race around `chat_send`.
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

    const handleDone = (payload: DoneEvent) => {
      if (useChatStore.getState().activeRunId !== activeRunId) return;
      debug("done", payload);
      finish(activeRunId, payload);
      const project = useChatStore.getState().project;
      if (project) void useSessionsStore.getState().autosave(project);
    };
    const handleError = (payload: ErrorEvent) => {
      if (useChatStore.getState().activeRunId !== activeRunId) return;
      debug("error", payload);
      fail(activeRunId, payload);
    };
    const handleTerminal = (event: ChatTerminalEvent) => {
      if (event.kind === "done") handleDone(event.payload);
      else handleError(event.payload);
    };

    const pending = [
      listen<unknown>(`agent:stream:${activeRunId}`, (e) => {
        debug("stream", e.payload);
        ingest(activeRunId, e.payload);
      }),
      listen<DoneEvent>(`agent:done:${activeRunId}`, (e) =>
        handleDone(e.payload),
      ),
      listen<ErrorEvent>(`agent:error:${activeRunId}`, (e) =>
        handleError(e.payload),
      ),
    ];

    void Promise.allSettled(pending).then(async (results) => {
      const listeners = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
        return;
      }
      listeners.forEach(register);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") {
        void api.chatCancel(activeRunId);
        handleError({
          friendly: "The task stream could not be opened. Try again.",
          raw: String(rejected.reason),
        });
        return;
      }
      try {
        const replay = await api.chatSubscribe(activeRunId);
        if (!cancelled && replay) handleTerminal(replay);
      } catch (error) {
        if (!cancelled) {
          void api.chatCancel(activeRunId);
          handleError({
            friendly: "The task stream could not be confirmed. Try again.",
            raw: String(error),
          });
        }
      }
    });

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, [activeRunId]);
}
