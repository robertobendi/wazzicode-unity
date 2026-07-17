import { describe, expect, it } from "vitest";
import type { AgentModelOption } from "@/types/agent";
import {
  CLAUDE_DEFAULT_EFFORTS,
  effortsForModel,
  repairRunOptions,
  runOptionsSummary,
} from "./modelCatalog";

const catalog: AgentModelOption[] = [
  {
    id: "gpt-a",
    label: "GPT A",
    description: null,
    defaultEffort: "medium",
    efforts: ["low", "medium", "high"],
  },
  {
    id: "gpt-b",
    label: "GPT B",
    description: null,
    defaultEffort: "high",
    efforts: ["high", "xhigh", "max"],
  },
];

const claudeCatalog: AgentModelOption[] = [
  {
    id: "opus",
    label: "Opus",
    description: null,
    defaultEffort: null,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "sonnet",
    label: "Sonnet",
    description: null,
    defaultEffort: null,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "fable",
    label: "Fable",
    description: null,
    defaultEffort: null,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "haiku",
    label: "Haiku",
    description: null,
    defaultEffort: null,
    efforts: [],
  },
];

describe("model catalog controls", () => {
  it("uses the exact Codex effort list for the selected model", () => {
    expect(effortsForModel("codex", catalog, "gpt-b")).toEqual([
      "high",
      "xhigh",
      "max",
    ]);
    expect(effortsForModel("codex", catalog, null)).toEqual([]);
    expect(effortsForModel("codex", catalog, "custom-model")).toEqual([]);
  });

  it("uses only the verified Claude efforts for the selected model", () => {
    expect(effortsForModel("claude", claudeCatalog, null)).toEqual(
      CLAUDE_DEFAULT_EFFORTS,
    );
    expect(effortsForModel("claude", claudeCatalog, "opus")).toContain(
      "xhigh",
    );
    expect(effortsForModel("claude", claudeCatalog, "sonnet")).toContain(
      "xhigh",
    );
    expect(effortsForModel("claude", claudeCatalog, "fable")).toContain(
      "xhigh",
    );
    expect(effortsForModel("claude", claudeCatalog, "haiku")).toEqual([]);
    expect(effortsForModel("claude", claudeCatalog, "custom-model")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("repairs an effort that the new model does not support", () => {
    expect(
      repairRunOptions(
        { backend: "codex", model: " gpt-a ", effort: "xhigh" },
        catalog,
      ),
    ).toEqual({ backend: "codex", model: "gpt-a", effort: null });
    expect(
      repairRunOptions(
        { backend: "claude", model: "haiku", effort: "xhigh" },
        claudeCatalog,
      ),
    ).toEqual({ backend: "claude", model: "haiku", effort: null });
    expect(
      repairRunOptions(
        { backend: "claude", model: "claude-opus-future", effort: "xhigh" },
        claudeCatalog,
      ),
    ).toEqual({
      backend: "claude",
      model: "claude-opus-future",
      effort: "xhigh",
    });
  });

  it("summarizes automatic and explicit controls", () => {
    expect(
      runOptionsSummary({ backend: "claude", model: null, effort: null }),
    ).toBe("Default model · Automatic thinking");
    expect(
      runOptionsSummary({ backend: "codex", model: "gpt-a", effort: "high" }),
    ).toBe("gpt-a · High");
  });
});
