// Chat domain types. Shared by the stream mapper, stores, and components.

/** A staged resource attached to a message. Unused in B1; defined for B3. */
export interface Attachment {
  id: string;
  /** Absolute path on disk (staged under <project>/.unity-vibe/inbox). */
  path: string;
  name: string;
  kind: "image" | "model" | "audio" | "text" | "other";
  /** data: URL preview for images, when available. */
  preview?: string;
}

export type ActivityStatus = "running" | "ok" | "error";

/** A single tool invocation, rendered as an inline chip in the assistant turn. */
export interface ToolActivity {
  /** Stable id (the tool_use content-block id). */
  id: string;
  /** Same as `id` — the tool_use_id used to resolve the later tool_result. */
  toolUseId: string;
  /** Raw tool name, e.g. "mcp__unity-vibe-os__unity_orient". */
  name: string;
  /** Human label from toolLabels.ts, e.g. "Getting oriented in Unity". */
  friendlyLabel: string;
  status: ActivityStatus;
  /** Tool input object, when present. */
  input?: unknown;
  /** Short text summary of the tool_result. */
  resultText?: string;
  startedAt: number;
  endedAt?: number;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** True while the assistant turn is still streaming. */
  streaming: boolean;
  attachments: Attachment[];
  activities: ToolActivity[];
  createdAt: number;
  /** Cost of this turn, from the `result` event. */
  costUsd?: number;
  /** Friendly error text when the turn failed. */
  error?: string;
}

export interface ChatSession {
  /** Captured from the `system/init` (or `result`) event; enables --resume. */
  sessionId: string | null;
  /** Non-null while a run is in flight. */
  activeRunId: string | null;
  totalCostUsd: number;
}

/** Payload of `claude:done:<runId>`. */
export interface DoneEvent {
  sessionId: string | null;
  costUsd: number | null;
  isError: boolean;
  resultText: string | null;
  numTurns: number | null;
}

/** Payload of `claude:error:<runId>`. */
export interface ErrorEvent {
  friendly: string;
  raw: string;
}
