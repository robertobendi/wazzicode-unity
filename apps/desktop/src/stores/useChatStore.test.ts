import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunOptions } from "@/types/agent";
import type { Settings } from "@/types/settings";

const mocks = vi.hoisted(() => ({
  chatSend: vi.fn(),
  chatCancel: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    chatSend: mocks.chatSend,
    chatCancel: mocks.chatCancel,
  },
}));

import { useChatStore } from "./useChatStore";
import { useSettingsStore } from "./useSettingsStore";

const settings: Settings = {
  schemaVersion: 3,
  recentProjects: [],
  currentProject: "/project",
  agentBackend: "claude",
  model: null,
  codexModel: null,
  effort: null,
  codexEffort: null,
  debugDrawer: false,
  pairedOk: true,
  onboarded: true,
};

let projectNumber = 0;

describe("chat run snapshots", () => {
  beforeEach(() => {
    projectNumber += 1;
    mocks.chatSend.mockReset().mockResolvedValue("run-1");
    mocks.chatCancel.mockReset();
    useSettingsStore.getState().setSettings(settings);
    useChatStore.getState().setProject(`/project-${projectNumber}`);
  });

  it("passes and captures explicit controls for a new task", async () => {
    const options: AgentRunOptions = {
      backend: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    };

    await useChatStore.getState().send("Build it", [], options);

    expect(mocks.chatSend).toHaveBeenCalledWith(
      `/project-${projectNumber}`,
      "Build it",
      null,
      options,
    );
    expect(useChatStore.getState().session).toMatchObject({
      backend: "codex",
      runOptions: options,
    });
  });

  it("keeps a loaded session's backend and controls when defaults change", async () => {
    useChatStore.getState().loadSession({
      sessionId: "claude-session",
      title: "Existing",
      createdAt: 1,
      updatedAt: 2,
      totalCostUsd: 0,
      messages: [],
      agentBackend: "claude",
      runOptions: { backend: "claude", model: "opus", effort: "high" },
    });

    await useChatStore.getState().send("Continue", [], {
      backend: "codex",
      model: "gpt-5.6-sol",
      effort: "low",
    });

    expect(mocks.chatSend).toHaveBeenCalledWith(
      `/project-${projectNumber}`,
      "Continue",
      "claude-session",
      { backend: "claude", model: "opus", effort: "high" },
    );
  });

  it("unfreezes a new conversation when the backend rejects startup", async () => {
    mocks.chatSend.mockRejectedValueOnce(new Error("model unavailable"));
    const options: AgentRunOptions = {
      backend: "codex",
      model: "bad-model",
      effort: "high",
    };

    await useChatStore.getState().send("Try it", [], options);

    expect(useChatStore.getState().session).toMatchObject({
      backend: null,
      runOptions: null,
      sessionId: null,
    });
    expect(useChatStore.getState().running).toBe(false);
  });

  it("maps auth failures using the task backend rather than current settings", async () => {
    mocks.chatSend.mockRejectedValueOnce(new Error("401 Unauthorized"));
    await useChatStore.getState().send("Try Codex", [], {
      backend: "codex",
      model: null,
      effort: null,
    });

    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant");
    expect(assistant?.error).toContain("Codex isn't signed in");
  });

  it("cancels a run when stop is clicked before startup returns its id", async () => {
    let resolveRun: (runId: string) => void = () => undefined;
    mocks.chatSend.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRun = resolve;
      }),
    );

    const send = useChatStore.getState().send("Start slowly");
    await useChatStore.getState().cancel();

    expect(mocks.chatCancel).not.toHaveBeenCalled();
    resolveRun("delayed-run");
    await send;

    expect(mocks.chatCancel).toHaveBeenCalledWith("delayed-run");
  });
});
