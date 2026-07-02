// Turn raw error text (bridge error codes, CLI stderr) into human-friendly,
// non-technical messages. Returns null when nothing matches so callers can
// fall back to whatever friendly text the backend already provided.

export function mapErrorMessage(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase();

  if (text.includes("unity_not_connected")) {
    return "Unity isn't connected. Open Unity and load your project.";
  }
  if (text.includes("unity_reloading")) {
    return "Unity is busy recompiling. Give it a moment and try again.";
  }
  if (text.includes("project_identity_mismatch")) {
    return "A different Unity project is open. Switch Unity to this project.";
  }
  if (
    text.includes("invalid api key") ||
    text.includes("401") ||
    text.includes("unauthorized") ||
    text.includes("not logged in") ||
    text.includes("authentication")
  ) {
    return "Claude isn't signed in. Ask your admin to pair this app.";
  }
  return null;
}

/** Resolve the best message to show: a mapped one, else the provided fallback. */
export function friendlyError(
  raw: string | undefined | null,
  fallback: string,
): string {
  return mapErrorMessage(raw) ?? fallback;
}
