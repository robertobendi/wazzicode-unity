import { describe, expect, it } from "vitest";
import { mapErrorMessage, screenshotErrorMessage } from "./errorMessages";

describe("mapErrorMessage", () => {
  it("names the CLI and the PATH trap when the binary can't be found", () => {
    for (const raw of [
      "spawn claude ENOENT",
      "No such file or directory (os error 2)",
      "program not found",
      "The system cannot find the path specified. (os error 3)",
    ]) {
      const msg = mapErrorMessage(raw, "claude");
      expect(msg).toContain("Claude Code CLI wasn't found");
      expect(msg).toContain("not visible to desktop apps");
    }
    expect(mapErrorMessage("spawn codex ENOENT", "codex")).toContain(
      "ChatGPT Codex CLI wasn't found",
    );
  });

  it("still reports an expired session as an auth problem", () => {
    expect(mapErrorMessage("401 Unauthorized", "claude")).toContain("Re-pair");
  });
});

describe("screenshotErrorMessage", () => {
  it("turns verified Unity capture failures into actionable guidance", () => {
    expect(
      screenshotErrorMessage(
        "OBJECT_NOT_FOUND: No GameObject is selected. Select an object in the Hierarchy and retry.",
        "selected",
      ),
    ).toBe("Select a GameObject in Unity's Hierarchy, then try again.");
    expect(
      screenshotErrorMessage("OBJECT_NOT_FOUND: No suitable Camera found.", "game"),
    ).toBe("Add or enable a Camera in the active scene, then try again.");
    expect(
      screenshotErrorMessage(
        "OBJECT_NOT_FOUND: No SceneView is currently open in the editor.",
        "scene",
      ),
    ).toBe("Open Unity's Scene view, then try again.");
  });

  it("keeps shared bridge recovery messages", () => {
    expect(screenshotErrorMessage("UNITY_RELOADING", "game")).toContain(
      "recompiling",
    );
  });
});
