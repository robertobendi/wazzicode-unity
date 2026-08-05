import { describe, expect, it } from "vitest";
import {
  formatKnowledgeFactValue,
  projectMapConnections,
  projectMapCoveragePercent,
} from "./projectMap";
import type { ProjectMapData } from "@/types/projectMap";

function sampleMap(): ProjectMapData {
  return {
    ageMs: 10,
    manifest: {
      schemaVersion: 1,
      generatedAt: 1,
      project: {
        id: "project:sample",
        path: ".",
        name: "Sample",
        isUnityProject: true,
      },
      coverage: {
        cap: 100,
        discovered: 4,
        scanned: 3,
        complete: false,
        truncated: true,
        errors: [],
        counts: {
          files: 4,
          firstPartyScripts: 1,
          packageScripts: 0,
          scenes: 0,
          prefabs: 0,
          entities: 2,
          relations: 1,
        },
        scopes: {
          firstParty: {
            root: "Assets",
            discovered: 4,
            scanned: 3,
            scripts: 1,
          },
          packages: {
            root: "Packages",
            discovered: 0,
            scanned: 0,
            scripts: 0,
          },
        },
      },
      fingerprint: {
        algorithm: "sha256",
        source: "source",
        content: "content",
      },
      dirty: { value: false, reasons: [] },
    },
    entities: [
      {
        id: "script:player",
        kind: "script",
        name: "Player.cs",
        path: "Assets/Player.cs",
        scope: "first-party",
        facts: [],
      },
      {
        id: "type:player",
        kind: "type",
        name: "Player",
        path: "Assets/Player.cs",
        scope: "first-party",
        facts: [],
      },
    ],
    relations: [
      {
        id: "declares:player",
        kind: "declares",
        from: "script:player",
        to: "type:player",
        provenance: { source: "csharp-text", path: "Assets/Player.cs" },
        observedAt: 1,
      },
    ],
  };
}

describe("project map presentation helpers", () => {
  it("reports bounded scan coverage without hiding truncation", () => {
    expect(projectMapCoveragePercent(sampleMap())).toBe(75);
  });

  it("groups directed relationships around the selected entity", () => {
    const data = sampleMap();
    const script = projectMapConnections(data, "script:player");
    expect(script.inbound).toHaveLength(0);
    expect(script.outbound[0].neighbor?.id).toBe("type:player");

    const type = projectMapConnections(data, "type:player");
    expect(type.inbound[0].neighbor?.id).toBe("script:player");
    expect(type.outbound).toHaveLength(0);
  });

  it("renders structured fact values compactly", () => {
    expect(formatKnowledgeFactValue(["Player", "Mover"])).toBe(
      "Player, Mover",
    );
    expect(formatKnowledgeFactValue(true)).toBe("Yes");
  });
});
