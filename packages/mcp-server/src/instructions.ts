/**
 * Server instructions. The MCP protocol delivers this string to the client (Claude Code) on
 * connect, so it is the one place that teaches the agent the right workflows *inside the user's
 * Unity project* — where there is no wazzicode CLAUDE.md.
 *
 * Claude Code truncates server instructions at 2KB, and the generated project primer is appended
 * to this string — so the two share one budget and anything past it is silently discarded. Keep
 * the workflow rules only: the tool list is self-describing (name + description + schema are sent
 * separately) and project architecture lives behind unity_query_project_brain.
 */
export const SERVER_INSTRUCTIONS = `Unity Vibe OS — the unity_* tools read and edit the user's OPEN Unity Editor live over a local bridge. Work from real state, never from guessing .unity/.prefab YAML. Tool descriptions are the reference; this is the workflow.

1. Start every task with unity_orient({task:"<the user's request>"}) — live Unity state, git, and task-relevant project-map matches in one call.
2. Before writing C# against any Unity/package API, confirm it exists with unity_reflect (it reads THIS project's loaded assemblies). Trust it over memory.
3. After ANY C# change run unity_verify (refresh → compile → console → tests → one verdict). Never say a change works until it passes.
4. Author game code directly with the script tools — never hand C# back for the user to paste.
5. Send a known multi-step edit as ONE unity_batch call, not many round trips.
6. Captures return real images: unity_capture_game_view for a still, unity_capture_frames for motion (animation, movement, timing). On macOS never call unity_capture_editor_window — it returns FEATURE_UNAVAILABLE.

BRIDGE STATE: UNITY_RELOADING = mid domain reload; recoverable and auto-retried, just proceed. UNITY_NOT_CONNECTED = no Editor open for this project; unity_orient already tries to start one — if it still fails, call unity_launch_editor and only ask the user when that says it cannot. UNITY_EDITOR_STALLED = Unity frozen while unfocused; retrying is USELESS — ask the user to focus Unity or enable Window ▸ Unity Vibe OS ▸ Keep Unity awake. Never retry a stalled or timed-out call more than twice.

Architecture / ownership / "what handles this?" → unity_query_project_brain (or the unity://project-brain resource). unity_manage_tools trims unused tool groups.`;

/** Claude Code truncates the instructions field at 2KB; static text + primer must fit inside it. */
export const INSTRUCTIONS_BUDGET_BYTES = 2000;

const SEPARATOR = "\n\n";
const PRIMER_POINTER = "\nFull map: unity://project-brain.";

/**
 * Joins the static instructions with the generated project primer, trimming the primer (never the
 * workflow rules) so the delivered string stays inside the client's 2KB window. A primer trimmed
 * for space keeps a pointer to the resource that holds the rest.
 */
export function composeInstructions(primer?: string): string {
  const trimmed = primer?.trim();
  if (!trimmed) return SERVER_INSTRUCTIONS;
  const available =
    INSTRUCTIONS_BUDGET_BYTES -
    Buffer.byteLength(SERVER_INSTRUCTIONS) -
    Buffer.byteLength(SEPARATOR);
  if (Buffer.byteLength(trimmed) <= available) return `${SERVER_INSTRUCTIONS}${SEPARATOR}${trimmed}`;
  // Too big to fit whole: a trimmed primer must still have room for its own pointer, otherwise
  // there is nothing useful to say and the workflow rules keep the whole budget.
  const room = available - Buffer.byteLength(PRIMER_POINTER);
  if (room <= 0) return SERVER_INSTRUCTIONS;
  const primerText = truncateToBytes(trimmed, room) + PRIMER_POINTER;
  return `${SERVER_INSTRUCTIONS}${SEPARATOR}${primerText}`;
}

/** Truncates on a UTF-8 boundary so a multi-byte character is never cut in half. */
function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, maxBytes)).replace(/�+$/, "");
}
