// Mirrors @uvibe/unity-cli's EditorEnvironment / EnsureEditorResult, as returned verbatim by
// `uvibe env --json` and `uvibe launch --json` through the Rust commands in unity_editor.rs.

export interface InstalledEditor {
  version: string;
  architecture?: string;
  location?: string;
  modules?: string;
}

export interface HubProject {
  title: string;
  path: string;
  version?: string;
  renderPipeline?: string;
  lastModified?: number;
}

export interface UnityEnvironment {
  cli: { available: boolean; path?: string; version?: string; error?: string };
  project: {
    path: string;
    isUnityProject: boolean;
    required: { editorVersion?: string; changeset?: string };
  };
  editors: InstalledEditor[];
  match: { installed: boolean; exact?: InstalledEditor; nearby: InstalledEditor[] };
  running: {
    bridgeConnected: boolean;
    editorProcessAlive: boolean;
    lockfilePresent: boolean;
  };
  suggestions: string[];
}

export type LaunchOutcome =
  | "already_running"
  | "became_ready"
  | "launched"
  | "editor_running_without_bridge"
  | "editor_not_installed"
  | "cli_unavailable"
  | "launch_failed"
  | "launch_timeout"
  | "not_a_project";

export interface UnityLaunchResult {
  outcome: LaunchOutcome;
  ready: boolean;
  waitedMs: number;
  message: string;
  nextAction: string;
  environment: UnityEnvironment;
}
