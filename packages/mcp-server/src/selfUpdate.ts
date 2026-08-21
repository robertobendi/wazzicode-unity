import { loadConfig } from "@uvibe/safety";
import {
  ensureEditorPackageCurrent,
  readEditorPackageStatus,
  type EnsureCurrentResult,
} from "@uvibe/unity-package";
import { refreshAgentInstructions } from "@uvibe/project-brain";

/**
 * Keep the project's Unity Editor package in step with this server.
 *
 * The MCP server and the `com.uvibe.os` Editor package are one product split across two
 * processes: they share a protocol version, and the server calls bridge methods that only exist
 * in a matching package. Historically a drifted copy produced a warning and left the user to run
 * an install command — a manual step for a problem that is a file copy.
 *
 * So: on every server start, if the project's *embedded* copy doesn't match, replace it. Gated by
 * `autoUpdateUnityPackage` (default on), never in mock mode, and never for symlink or `file:`
 * manifest installs, which already resolve to the live source tree.
 */
export async function ensureUnityPackageCurrent(
  projectPath: string,
  opts: { mock?: boolean; log?: (message: string) => void } = {}
): Promise<EnsureCurrentResult | null> {
  if (opts.mock) return null;
  try {
    const config = await loadConfig(projectPath);
    const result = await ensureEditorPackageCurrent(projectPath, {
      enabled: config.autoUpdateUnityPackage,
    });
    if (result.updated) {
      opts.log?.(
        `Unity Vibe OS: updated the Editor package in this project from ${result.previousVersion ?? "an older build"} to ${result.status.version ?? result.status.serverVersion}. Unity will re-import it on next focus.`
      );
    } else if (result.skipped === "failed") {
      opts.log?.(`Unity Vibe OS: could not refresh the Editor package — ${result.error}`);
    }

    // The other half of a stale install, and the one that actually changes behaviour: the
    // CLAUDE.md / AGENTS.md block the agent reads as its standing brief in this project.
    if (config.autoUpdateAgentInstructions) {
      try {
        const refreshed = await refreshAgentInstructions(projectPath);
        const changed = [
          refreshed.claudeMd !== "current" ? `CLAUDE.md (${refreshed.claudeMd})` : null,
          refreshed.agentsMd !== "current" ? `AGENTS.md (${refreshed.agentsMd})` : null,
        ].filter(Boolean);
        if (changed.length > 0) {
          opts.log?.(`Unity Vibe OS: refreshed the agent instructions — ${changed.join(", ")}.`);
        }
      } catch (error) {
        opts.log?.(
          `Unity Vibe OS: could not refresh the agent instructions — ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return result;
  } catch (error) {
    // Never let a self-update problem stop the server from serving.
    opts.log?.(
      `Unity Vibe OS: skipped the Editor-package check — ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Mid-session drift check, for a server that has been running since before a `git pull`.
 *
 * `unityRunning` decides what we're allowed to do about it: with the Editor closed we just fix
 * it, but replacing package files under a *running* Editor triggers an import and a domain
 * reload, which would restart the bridge underneath whatever task is in flight. That is the
 * user's call to make, so we report it instead.
 *
 * Returns a warning to attach to the tool's envelope, or null when there is nothing to say.
 */
export async function syncEditorPackage(
  projectPath: string,
  opts: { mock?: boolean; unityRunning: boolean }
): Promise<string | null> {
  if (opts.mock) return null;
  try {
    const status = await readEditorPackageStatus(projectPath);
    if (!status.needsUpdate) return null;
    if (opts.unityRunning) {
      return `The Unity Editor package in this project is ${status.version ?? "an older build"} but this server is ${status.serverVersion}. Close Unity (or restart this MCP server) to let it update automatically, or run \`uvibe install-unity-package\`.`;
    }
    const config = await loadConfig(projectPath);
    const result = await ensureEditorPackageCurrent(projectPath, {
      enabled: config.autoUpdateUnityPackage,
    });
    if (result.updated) {
      return `Updated the Unity Editor package in this project from ${result.previousVersion ?? "an older build"} to ${result.status.version ?? result.status.serverVersion}.`;
    }
    if (result.skipped === "disabled") {
      return `The Unity Editor package is ${status.version} but this server is ${status.serverVersion} (autoUpdateUnityPackage is off).`;
    }
    return `Could not refresh the Unity Editor package (${result.skipped}${result.error ? `: ${result.error}` : ""}).`;
  } catch {
    // A drift check must never break orientation.
    return null;
  }
}
