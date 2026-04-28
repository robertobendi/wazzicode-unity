import { generateBrain } from "@uvibe/project-brain";
import { CommandResult, GlobalOptions } from "../options.js";

export async function runBrain(g: GlobalOptions): Promise<CommandResult> {
  const result = await generateBrain({ projectPath: g.project, write: true });
  if (g.json) {
    return { exitCode: 0, stdout: JSON.stringify(result, null, 2) + "\n" };
  }
  const lines: string[] = [];
  lines.push("Unity Vibe OS — brain");
  lines.push(`project: ${g.project}`);
  lines.push(`unity:   ${result.brain.engine.unityVersion ?? "(unknown)"}`);
  lines.push(`pipeline:${result.brain.engine.renderPipeline ?? "(unknown)"}  input:${result.brain.engine.inputSystem ?? "(unknown)"}`);
  lines.push(`scenes:  ${result.brain.assets.scenes.length}  prefabs:${result.brain.assets.prefabs.length}  scripts:${result.brain.assets.scripts.length}`);
  lines.push("written:");
  for (const w of result.written) lines.push(`  - ${w}`);
  return { exitCode: 0, stdout: lines.join("\n") + "\n" };
}
