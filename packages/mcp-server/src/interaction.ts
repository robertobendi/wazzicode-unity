/**
 * Per-call client interaction channels (MCP progress notifications and elicitation), kept out of
 * the tool signatures. `createServer` builds these from the request's `extra` and puts them on a
 * per-call copy of the ToolContext; tools reach them through the helpers below, which no-op when
 * the client didn't ask for progress or doesn't support elicitation. Direct/test contexts that
 * omit them keep working unchanged.
 */

/** Reports one phase boundary of a long-running tool. Fire-and-forget: never throws, never awaited. */
export type ProgressReporter = (update: {
  progress: number;
  total?: number;
  message: string;
}) => void;

/**
 * "unsupported" means the client declared no elicitation capability (e.g. Codex CLI) or the
 * request failed — callers must fall back to their normal non-interactive behaviour rather than
 * treating it as a decline.
 */
export type ElicitDecision = "unsupported" | "accept" | "decline" | "cancel";

/** Asks the user a single yes/no question. Returns "unsupported" when the client can't ask. */
export type ConfirmElicitor = (request: {
  message: string;
  /** Property name of the boolean field in the requested schema. */
  field: string;
  fieldTitle: string;
  fieldDescription: string;
}) => Promise<ElicitDecision>;

export interface InteractionContext {
  onProgress?: ProgressReporter;
  confirmWithUser?: ConfirmElicitor;
}

export function reportProgress(
  ctx: InteractionContext,
  progress: number,
  total: number | undefined,
  message: string
): void {
  ctx.onProgress?.({ progress, ...(total !== undefined ? { total } : {}), message });
}

/**
 * Context for a nested tool call whose progress messages should flow through the parent's own
 * counter. Progress must increase monotonically per token, so a composite tool cannot just hand
 * its context down and let each sub-tool restart its numbering at 1.
 */
export function withRelayedProgress<T extends InteractionContext>(
  ctx: T,
  relay: (message: string) => void
): T {
  if (!ctx.onProgress) return ctx;
  return { ...ctx, onProgress: (update) => relay(update.message) };
}

export async function confirmWithUser(
  ctx: InteractionContext,
  request: Parameters<ConfirmElicitor>[0]
): Promise<ElicitDecision> {
  if (!ctx.confirmWithUser) return "unsupported";
  return ctx.confirmWithUser(request);
}
