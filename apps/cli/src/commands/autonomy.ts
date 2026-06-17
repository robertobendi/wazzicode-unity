import { loadConfig, writeConfig, UVibeConfig } from "@uvibe/safety";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";

/**
 * One-command toggle for Claude's write access. Writes are ON by default (autopilot), so this is
 * mainly a kill switch: "off" locks the project to read_only; "on" restores the write-enabled
 * posture (scene/prefab/script/asset edits under autopilot with autoSnapshot as the safety net).
 * Menu-item execution and in-Editor code execution stay off either way (broad escape hatches you
 * opt into explicitly). Every write is still Undo-wrapped and action-logged.
 */
export async function runAutonomy(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const mode = (parsed.positional[0] ?? "status").toLowerCase();
  const current = await loadConfig(g.project);

  if (mode === "status") {
    return report(g, current, "Current autonomy settings");
  }

  let next: UVibeConfig;
  if (mode === "on") {
    next = {
      ...current,
      safetyMode: "autopilot",
      allowSceneWrites: true,
      allowPrefabWrites: true,
      allowScriptWrites: true,
      allowAssetWrites: true,
      autoSnapshot: true,
    };
  } else if (mode === "off") {
    next = { ...current, safetyMode: "read_only" };
  } else {
    return {
      exitCode: 2,
      stderr: `Unknown mode '${mode}'. Use: uvibe autonomy [on|off|status].\n`,
    };
  }

  await writeConfig(g.project, next);
  return report(g, next, mode === "on" ? "Autonomy enabled — Claude can now edit without prompting you" : "Autonomy disabled — back to read-only");
}

function report(g: GlobalOptions, cfg: UVibeConfig, title: string): CommandResult {
  if (g.json) {
    return {
      exitCode: 0,
      stdout:
        JSON.stringify(
          {
            safetyMode: cfg.safetyMode,
            allowSceneWrites: cfg.allowSceneWrites,
            allowPrefabWrites: cfg.allowPrefabWrites,
            allowScriptWrites: cfg.allowScriptWrites,
            allowAssetWrites: cfg.allowAssetWrites,
            allowMenuItems: cfg.allowMenuItems,
            allowCodeExecution: cfg.allowCodeExecution,
            autoSnapshot: cfg.autoSnapshot,
          },
          null,
          2
        ) + "\n",
    };
  }
  const lines = [
    `${title}:`,
    "",
    `  safetyMode:        ${cfg.safetyMode}`,
    `  allowSceneWrites:  ${cfg.allowSceneWrites}`,
    `  allowPrefabWrites: ${cfg.allowPrefabWrites}`,
    `  allowScriptWrites: ${cfg.allowScriptWrites}`,
    `  allowAssetWrites:  ${cfg.allowAssetWrites}`,
    `  allowMenuItems:    ${cfg.allowMenuItems}  (enable separately; needs allowedMenuItems)`,
    `  allowCodeExecution:${cfg.allowCodeExecution}  (enable separately; runs arbitrary C#)`,
    `  autoSnapshot:      ${cfg.autoSnapshot}`,
    "",
    cfg.safetyMode === "read_only"
      ? "Writes are blocked. Run `uvibe autonomy on` to let Claude apply changes (Undo-wrapped + snapshotted)."
      : "Writes are allowed. Every change is wrapped in Unity Undo (Ctrl+Z) and recorded to .unity-vibe/action_log.jsonl. Run `uvibe autonomy off` to lock it down.",
  ];
  return { exitCode: 0, stdout: lines.join("\n") + "\n" };
}
