import type { AgentBackend, AgentRunOptions } from "@/types/agent";
import type { Settings } from "@/types/settings";

function isBackend(value: unknown): value is AgentBackend {
  return value === "claude" || value === "codex";
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function automaticRunOptions(
  backend: AgentBackend = "claude",
): AgentRunOptions {
  return { backend, model: null, effort: null };
}

/** Normalize values crossing the persisted-session boundary. */
export function normalizeAgentRunOptions(
  value: unknown,
  fallbackBackend: AgentBackend = "claude",
): AgentRunOptions {
  if (!value || typeof value !== "object") {
    return automaticRunOptions(fallbackBackend);
  }
  const raw = value as Record<string, unknown>;
  return {
    backend: isBackend(raw.backend) ? raw.backend : fallbackBackend,
    model: optionalString(raw.model),
    effort: optionalString(raw.effort),
  };
}

export function runOptionsFromSettings(
  settings: Settings,
  backend: AgentBackend = settings.agentBackend,
): AgentRunOptions {
  return normalizeAgentRunOptions(
    {
      backend,
      model: backend === "codex" ? settings.codexModel : settings.model,
      effort: backend === "codex" ? settings.codexEffort : settings.effort,
    },
    backend,
  );
}

interface PersistedSessionSource {
  agentBackend?: unknown;
  runOptions?: unknown;
  messages?: readonly { tokens?: unknown }[];
}

/**
 * Recover the frozen controls from a saved session. New snapshots win; older
 * Codex sessions are identifiable by their token-bearing assistant messages.
 * All earlier sessions predate Codex support and therefore safely default to
 * Claude rather than whichever backend happens to be selected today.
 */
export function inferSessionRunOptions(
  source: PersistedSessionSource,
): AgentRunOptions {
  const rawOptions =
    source.runOptions && typeof source.runOptions === "object"
      ? (source.runOptions as Record<string, unknown>)
      : null;
  const backend = isBackend(rawOptions?.backend)
    ? rawOptions.backend
    : isBackend(source.agentBackend)
      ? source.agentBackend
      : source.messages?.some((message) => typeof message.tokens === "number")
        ? "codex"
        : "claude";
  return normalizeAgentRunOptions(rawOptions, backend);
}

interface ResolveRunOptionsInput {
  sessionRunOptions: AgentRunOptions | null;
  sessionBackend: AgentBackend | null;
  requested?: AgentRunOptions;
  settings: Settings | null;
}

/**
 * What a turn actually runs with.
 *
 * Model and effort are per *message*: you can change them at any point, including while a task is
 * in flight — the running turn keeps what it started with (its options were already resolved and
 * handed to the CLI), and the change takes effect from your next message. That mirrors how the
 * underlying CLIs behave: both accept `-m` per invocation, and Claude Code lets you switch models
 * mid-conversation too.
 *
 * The backend is not per-message. A CLI session id is only meaningful to the backend that created
 * it, so swapping Claude↔Codex mid-conversation would silently drop the conversation's context;
 * an existing conversation keeps the backend it started on.
 */
export function resolveChatRunOptions({
  sessionRunOptions,
  sessionBackend,
  requested,
  settings,
}: ResolveRunOptionsInput): AgentRunOptions {
  if (sessionRunOptions) {
    const current = normalizeAgentRunOptions(
      sessionRunOptions,
      sessionBackend ?? sessionRunOptions.backend,
    );
    if (!requested) return current;
    const wanted = normalizeAgentRunOptions(requested, current.backend);
    return { backend: current.backend, model: wanted.model, effort: wanted.effort };
  }
  if (sessionBackend) return automaticRunOptions(sessionBackend);
  if (requested) return normalizeAgentRunOptions(requested);
  if (settings) return runOptionsFromSettings(settings);
  return automaticRunOptions();
}

/** A CLI session id is meaningful only to the backend that created it. */
export function compatibleResumeSessionId(
  sessionId: string | null,
  sessionBackend: AgentBackend | null,
  options: AgentRunOptions,
): string | null {
  return sessionId && sessionBackend === options.backend ? sessionId : null;
}
