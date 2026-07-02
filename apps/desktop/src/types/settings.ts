// Mirrors the Rust `Settings` struct in
// src-tauri/src/store/settings.rs (serde camelCase). Keep the two in sync.

export interface Settings {
  schemaVersion: number;
  recentProjects: string[];
  currentProject: string | null;
  /** Admin escape hatch: flips Claude spawns to bypassPermissions. */
  powerMode: boolean;
  /** Preferred Claude model id, or null to let the CLI decide. */
  model: string | null;
  /** Show the raw stream / debug drawer in the UI. */
  debugDrawer: boolean;
  /** Set true after the first successful pair/verify (skips the pairing gate). */
  pairedOk: boolean;
  /** Set true once the onboarding wizard completes ("Redo setup" clears it). */
  onboarded: boolean;
}
