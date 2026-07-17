import type {
  AgentBackend,
  AgentModelOption,
  AgentRunOptions,
} from "@/types/agent";

export const CLAUDE_DEFAULT_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function effortsForModel(
  backend: AgentBackend,
  catalog: AgentModelOption[],
  model: string | null,
): string[] {
  if (!model) return backend === "claude" ? CLAUDE_DEFAULT_EFFORTS : [];
  const listed = catalog.find((option) => option.id === model);
  if (listed) return listed.efforts;
  return backend === "claude"
    ? ["low", "medium", "high", "xhigh", "max"]
    : [];
}

export function repairRunOptions(
  options: AgentRunOptions,
  catalog: AgentModelOption[],
): AgentRunOptions {
  const model = options.model?.trim() || null;
  const efforts = effortsForModel(options.backend, catalog, model);
  const effort = options.effort?.trim() || null;
  return {
    backend: options.backend,
    model,
    effort: effort && efforts.includes(effort) ? effort : null,
  };
}

export function effortLabel(effort: string): string {
  const labels: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
    ultra: "Ultra",
  };
  return labels[effort] ?? effort.replaceAll("_", " ");
}

export function runOptionsSummary(options: AgentRunOptions): string {
  const model = options.model || "Default model";
  const effort = options.effort ? effortLabel(options.effort) : "Automatic thinking";
  return `${model} · ${effort}`;
}
