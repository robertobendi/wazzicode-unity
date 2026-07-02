// Mirrors the Rust `PairingState` in src-tauri/src/pairing/mod.rs (serde
// camelCase) and the auth command payloads in commands/pairing.rs.

export type PairingPhase =
  | "idle"
  | "starting"
  | "awaiting_admin"
  | "submitting"
  | "verifying"
  | "paired"
  | "failed";

export interface PairingState {
  phase: PairingPhase;
  /** OAuth URL to forward to the admin (present at awaiting_admin). */
  oauthUrl: string | null;
  /** "token" | "cli_managed" — how the account got connected (at paired). */
  mode: string | null;
  /** Friendly failure message (at failed). */
  error: string | null;
  /** Last ~2KB of stripped output, for the failure "Show details" pane. */
  rawTail: string | null;
  /** The CLI has prompted for the code — helps enable the input. */
  promptSeen: boolean;
  /** Id of the active pairing, needed by pairingSubmitCode. */
  pairingId: string | null;
}

export interface AuthStatus {
  hasToken: boolean;
  /** "keychain" | "file" | "env" | null. */
  source: string | null;
}

export interface AuthVerify {
  ok: boolean;
  error: string | null;
}
