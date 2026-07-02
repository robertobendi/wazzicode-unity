import { describe, it, expect } from "vitest";
import { toolLabel } from "./toolLabels";

describe("toolLabel", () => {
  it("labels standard Claude Code tools", () => {
    expect(toolLabel("Read")).toBe("Reading a file");
    expect(toolLabel("Edit")).toBe("Editing game code");
    expect(toolLabel("Grep")).toBe("Searching the project");
    expect(toolLabel("TodoWrite")).toBe("Planning steps");
  });

  it("labels known unity tools", () => {
    expect(toolLabel("mcp__unity-vibe-os__unity_orient")).toBe(
      "Getting oriented in Unity",
    );
    expect(toolLabel("mcp__unity-vibe-os__unity_verify")).toBe(
      "Checking everything compiles and tests pass",
    );
    expect(toolLabel("mcp__unity-vibe-os__unity_capture_game_view")).toBe(
      "Taking a screenshot of the game",
    );
    expect(toolLabel("mcp__unity-vibe-os__unity_create_gameobject")).toBe(
      "Creating a new object",
    );
  });

  it("falls back to a sentence-cased, de-prefixed label for unknown unity tools", () => {
    expect(toolLabel("mcp__unity-vibe-os__unity_some_new_tool")).toBe(
      "Some new tool",
    );
  });

  it("falls back for unity tools without the unity_ segment", () => {
    expect(toolLabel("mcp__unity-vibe-os__future_thing")).toBe("Future thing");
  });

  it("falls back for wholly unknown tool names", () => {
    expect(toolLabel("mcp__other-server__do_stuff")).toBe(
      "Other-server do stuff",
    );
    expect(toolLabel("MysteryTool")).toBe("MysteryTool");
  });
});
