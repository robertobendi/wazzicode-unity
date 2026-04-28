/**
 * Stable error codes used across the bridge protocol and the MCP tool envelope.
 * Codes are stable identifiers; do not rename without bumping protocol version.
 */
export type ErrorCode =
  | "UNITY_NOT_CONNECTED"
  | "UNITY_COMPILING"
  | "OBJECT_NOT_FOUND"
  | "ASSET_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "SAFETY_MODE_BLOCKED"
  | "WRITE_REQUIRES_SNAPSHOT"
  | "UNSUPPORTED_UNITY_VERSION"
  | "INTERNAL_ERROR"
  | "MOCK_MODE_ACTIVE"
  | "BRIDGE_TIMEOUT"
  | "MALFORMED_BRIDGE_RESPONSE"
  | "TOOL_NOT_IMPLEMENTED"
  | "PROJECT_NOT_FOUND"
  | "GIT_NOT_AVAILABLE";

export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  suggestedAction: string;
  details?: Record<string, unknown>;
}

interface ErrorMeta {
  recoverable: boolean;
  suggestedAction: string;
  defaultMessage: string;
}

const ERROR_META: Record<ErrorCode, ErrorMeta> = {
  UNITY_NOT_CONNECTED: {
    recoverable: true,
    suggestedAction:
      "Open the Unity Editor with the UnityVibeOS package installed. The bridge auto-starts on editor load. Run `uvibe doctor` to confirm.",
    defaultMessage: "The Unity bridge is not reachable.",
  },
  UNITY_COMPILING: {
    recoverable: true,
    suggestedAction: "Wait for compilation to finish. Use `unity_wait_for_compile`.",
    defaultMessage: "Unity is compiling.",
  },
  OBJECT_NOT_FOUND: {
    recoverable: true,
    suggestedAction: "Verify the object path/name exists in the active scene or any loaded scene.",
    defaultMessage: "GameObject not found.",
  },
  ASSET_NOT_FOUND: {
    recoverable: true,
    suggestedAction: "Confirm the asset path is correct and the asset exists in the AssetDatabase.",
    defaultMessage: "Asset not found.",
  },
  INVALID_ARGUMENT: {
    recoverable: true,
    suggestedAction: "Inspect the tool's input schema and correct the argument.",
    defaultMessage: "Invalid argument.",
  },
  SAFETY_MODE_BLOCKED: {
    recoverable: true,
    suggestedAction:
      "Update `.unity-vibe/config.json` to a less restrictive safety mode (suggest/confirm/autopilot) before retrying.",
    defaultMessage: "Operation blocked by safety mode.",
  },
  WRITE_REQUIRES_SNAPSHOT: {
    recoverable: true,
    suggestedAction:
      "Enable autoSnapshot in `.unity-vibe/config.json` or commit pending changes before retrying.",
    defaultMessage: "Write operation requires a snapshot but none was created.",
  },
  UNSUPPORTED_UNITY_VERSION: {
    recoverable: false,
    suggestedAction: "Upgrade Unity to a supported version (2021.3 LTS or newer is recommended).",
    defaultMessage: "Unity version is not supported.",
  },
  INTERNAL_ERROR: {
    recoverable: false,
    suggestedAction: "Inspect the message/details. File an issue with reproduction steps if persistent.",
    defaultMessage: "Internal error.",
  },
  MOCK_MODE_ACTIVE: {
    recoverable: true,
    suggestedAction: "This response was synthesized in mock mode. Disable UVIBE_MOCK to use the real bridge.",
    defaultMessage: "Running in mock mode.",
  },
  BRIDGE_TIMEOUT: {
    recoverable: true,
    suggestedAction: "Increase timeout, or check that Unity is responsive (it may be in a long compile or import).",
    defaultMessage: "Bridge request timed out.",
  },
  MALFORMED_BRIDGE_RESPONSE: {
    recoverable: false,
    suggestedAction: "Bridge returned a non-JSON or schema-invalid payload. Check Unity console for errors.",
    defaultMessage: "Malformed bridge response.",
  },
  TOOL_NOT_IMPLEMENTED: {
    recoverable: false,
    suggestedAction: "This tool is planned but not yet implemented in this build.",
    defaultMessage: "Tool not implemented.",
  },
  PROJECT_NOT_FOUND: {
    recoverable: true,
    suggestedAction:
      "Point the CLI at a Unity project directory (the one containing Assets/, Packages/, ProjectSettings/) using --project or UVIBE_PROJECT.",
    defaultMessage: "No Unity project found at the given path.",
  },
  GIT_NOT_AVAILABLE: {
    recoverable: true,
    suggestedAction: "Install git, or run from a directory inside a git repository.",
    defaultMessage: "git is unavailable or this directory is not a git repository.",
  },
};

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_META, value);
}

export function makeError(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>
): ErrorDetail {
  const meta = ERROR_META[code];
  return {
    code,
    message: message ?? meta.defaultMessage,
    recoverable: meta.recoverable,
    suggestedAction: meta.suggestedAction,
    ...(details !== undefined ? { details } : {}),
  };
}

export class UVibeError extends Error {
  readonly detail: ErrorDetail;
  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    const detail = makeError(code, message, details);
    super(detail.message);
    this.name = "UVibeError";
    this.detail = detail;
  }
}
