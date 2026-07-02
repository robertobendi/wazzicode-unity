// Typed wrappers around Tauri `invoke`. One place to discover the IPC surface;
// later phases extend this as new Rust commands land.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Settings } from "@/types/settings";
import type { ProjectInfo } from "@/types/project";
import type { StagedResource } from "@/types/chat";
import type { AuthStatus, AuthVerify, PairingState } from "@/types/pairing";
import type { LoopOptions, LoopState } from "@/types/loop";
import type {
  CliStatus,
  OnboardingStatus,
  SetupResult,
} from "@/types/onboarding";

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

  // Pairing: hidden-PTY `claude setup-token` flow. State arrives on the
  // `pairing:update` event; pairingStart returns the pairing id for submitCode.
  pairingStart: () => invoke<string>("pairing_start"),
  pairingSubmitCode: (pairingId: string, code: string) =>
    invoke<void>("pairing_submit_code", { pairingId, code }),
  pairingCancel: () => invoke<void>("pairing_cancel"),
  pairingState: () => invoke<PairingState | null>("pairing_state"),

  // Auth: stored company token status / verification / removal.
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authVerify: () => invoke<AuthVerify>("auth_verify"),
  authClear: () => invoke<void>("auth_clear"),

  // Auto mode: the autonomous dev loop. State arrives on the `loop:update`
  // event; loopStart returns the loop id.
  loopStart: (project: string, goal: string, options: LoopOptions) =>
    invoke<string>("loop_start", { project, goal, options }),
  loopStop: () => invoke<void>("loop_stop"),
  loopState: () => invoke<LoopState | null>("loop_state"),

  // Onboarding wizard. Setup + install stream progress on `onboarding:progress`.
  onboardingStatus: () => invoke<OnboardingStatus>("onboarding_status"),
  onboardingCheckCli: () => invoke<CliStatus>("onboarding_check_cli"),
  onboardingInstallCli: () => invoke<CliStatus>("onboarding_install_cli"),
  onboardingSetupProject: (project: string) =>
    invoke<SetupResult>("onboarding_setup_project", { project }),
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
