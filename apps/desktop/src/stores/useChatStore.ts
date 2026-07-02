import { create } from "zustand";
import { api } from "@/api";
import {
  initialDraft,
  reduceStream,
  type StreamDraft,
} from "@/lib/streamMapper";
import { friendlyError } from "@/lib/errorMessages";
import type {
  ChatMessage,
  ChatSession,
  DoneEvent,
  ErrorEvent,
} from "@/types/chat";

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptySession(): ChatSession {
  return { sessionId: null, activeRunId: null, totalCostUsd: 0 };
}

interface ChatState {
  project: string | null;
  messages: ChatMessage[];
  session: ChatSession;
  running: boolean;
  activeRunId: string | null;

  /** Assistant message currently being streamed + its running draft. */
  assistantId: string | null;
  draft: StreamDraft | null;

  /** Point the store at a project; resets the conversation if it changed. */
  setProject: (project: string | null) => void;
  send: (prompt: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;

  // Called by useClaudeStream — not part of the public UI surface.
  ingest: (runId: string, raw: unknown) => void;
  finish: (runId: string, done: DoneEvent) => void;
  fail: (runId: string, err: ErrorEvent) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  project: null,
  messages: [],
  session: emptySession(),
  running: false,
  activeRunId: null,
  assistantId: null,
  draft: null,

  setProject: (project) => {
    if (get().project === project) return;
    set({
      project,
      messages: [],
      session: emptySession(),
      running: false,
      activeRunId: null,
      assistantId: null,
      draft: null,
    });
  },

  reset: () =>
    set({
      messages: [],
      session: emptySession(),
      running: false,
      activeRunId: null,
      assistantId: null,
      draft: null,
    }),

  send: async (prompt) => {
    const state = get();
    const text = prompt.trim();
    if (!text || state.running || !state.project) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      streaming: false,
      attachments: [],
      activities: [],
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: "assistant",
      text: "",
      streaming: true,
      attachments: [],
      activities: [],
      createdAt: Date.now(),
    };
    set({
      messages: [...state.messages, userMsg, assistantMsg],
      assistantId: assistantMsg.id,
      draft: initialDraft(),
      running: true,
    });

    try {
      const runId = await api.chatSend(
        state.project,
        text,
        state.session.sessionId,
      );
      set((s) => ({
        activeRunId: runId,
        session: { ...s.session, activeRunId: runId },
      }));
    } catch (e) {
      const raw = String(e);
      const friendly =
        raw === "busy"
          ? "Claude is still working on the last message."
          : friendlyError(raw, "Couldn't start Claude.");
      get().fail("", { friendly, raw });
    }
  },

  cancel: async () => {
    const runId = get().activeRunId;
    if (!runId) return;
    try {
      await api.chatCancel(runId);
    } catch {
      // The reader task still emits an error/done event; nothing to do here.
    }
  },

  ingest: (runId, raw) =>
    set((state) => {
      if (runId !== state.activeRunId || !state.draft || !state.assistantId) {
        return {};
      }
      const draft = reduceStream(state.draft, raw);
      const messages = state.messages.map((m) =>
        m.id === state.assistantId
          ? { ...m, text: draft.text, activities: draft.activities }
          : m,
      );
      return { draft, messages };
    }),

  finish: (runId, done) =>
    set((state) => {
      if (runId !== state.activeRunId) return {};
      const messages = state.messages.map((m) =>
        m.id === state.assistantId
          ? {
              ...m,
              streaming: false,
              text: m.text || done.resultText || "",
              costUsd: done.costUsd ?? undefined,
              error:
                done.isError && !m.text
                  ? "Claude ran into a problem."
                  : m.error,
            }
          : m,
      );
      return {
        messages,
        running: false,
        activeRunId: null,
        assistantId: null,
        draft: null,
        session: {
          sessionId: done.sessionId ?? state.session.sessionId,
          activeRunId: null,
          totalCostUsd: state.session.totalCostUsd + (done.costUsd ?? 0),
        },
      };
    }),

  fail: (runId, err) =>
    set((state) => {
      // Accept the pre-run failure case (runId "") or a matching active run.
      if (runId !== "" && runId !== state.activeRunId) return {};
      const message = friendlyError(err.raw, err.friendly);
      const messages = state.messages.map((m) =>
        m.id === state.assistantId
          ? { ...m, streaming: false, error: message, errorRaw: err.raw }
          : m,
      );
      return {
        messages,
        running: false,
        activeRunId: null,
        assistantId: null,
        draft: null,
        session: { ...state.session, activeRunId: null },
      };
    }),
}));
