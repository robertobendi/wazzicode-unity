// Typed wrappers around Tauri `invoke`. One place to discover the IPC surface;
// later phases extend this as new Rust commands land.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Settings } from "@/types/settings";
import type { ProjectInfo } from "@/types/project";
import type { StagedResource } from "@/types/chat";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) =>
    invoke<Settings>("update_settings", { settings }),
  // Liveness probe used during startup/dev.
  ping: () => invoke<string>("ping"),

  // Project selection / validation.
  validateUnityProject: (path: string) =>
    invoke<ProjectInfo>("validate_unity_project", { path }),
  setCurrentProject: (path: string) =>
    invoke<Settings>("set_current_project", { path }),

  // Chat: returns the runId to subscribe to (claude:stream/done/error:<runId>).
  chatSend: (project: string, prompt: string, resumeSessionId?: string | null) =>
    invoke<string>("chat_send", { project, prompt, resumeSessionId }),
  chatCancel: (runId: string) => invoke<void>("chat_cancel", { runId }),

  // Bridge status poller (emits `status:update`).
  statusStart: (project: string) => invoke<void>("status_start", { project }),
  statusStop: () => invoke<void>("status_stop"),

  // Capture the live game/scene view; returns the on-disk PNG path to render.
  bridgeCapture: (project: string, kind: "game" | "scene" = "game") =>
    invoke<{ pngPath: string }>("bridge_capture", { project, kind }),

  // Resource funnel: copy dropped/pasted files into the project inbox.
  stagePaths: (project: string, paths: string[]) =>
    invoke<StagedResource[]>("stage_paths", { project, paths }),
  pasteClipboard: (project: string) =>
    invoke<StagedResource[]>("paste_clipboard", { project }),
  removeStaged: (path: string) => invoke<void>("remove_staged", { path }),
};

/** Open a native folder picker. Returns null if cancelled. */
export async function pickFolder(title = "Pick your Unity project") {
  const result = await openDialog({ directory: true, multiple: false, title });
  if (typeof result === "string") return result;
  return null;
}

/** Open a URL in the default browser. */
export async function openExternal(url: string) {
  await openUrl(url);
}
