import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpConfigShape {
  mcpServers: Record<string, McpServerEntry>;
  /** Unrelated top-level keys of an existing .mcp.json, preserved on merge. */
  [key: string]: unknown;
}

export async function runMcpConfig(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  const target = (typeof parsed.flags.target === "string" ? parsed.flags.target : "claude-code") as
    | "claude-code"
    | "claude-desktop"
    | "codex";
  const bare = parsed.flags.bare === true;
  const write = parsed.flags.write === true;
  const project = path.resolve(g.project);
  const entry = buildEntry({ project, mock: g.mock, bare });
  const config: McpConfigShape = { mcpServers: { "unity-vibe-os": entry } };
  const text = JSON.stringify(config, null, 2);

  // Codex takes TOML, not JSON, and has no per-project config file we can safely
  // merge into without a TOML parser — so we print the block plus the `codex mcp
  // add` one-liner, which lets the CLI write its own config correctly.
  if (target === "codex") {
    if (g.json) return { exitCode: 0, stdout: text + "\n" };
    return { exitCode: 0, stdout: codexSnippet(entry, project) };
  }

  if (write) {
    const file = path.join(project, ".mcp.json");
    let merged: McpConfigShape;
    try {
      merged = await mergeMcpJson(file, entry);
    } catch (e) {
      // A malformed .mcp.json is the user's file, holding their other MCP
      // servers. Overwriting it would delete them silently, so refuse.
      return {
        exitCode: 2,
        stderr: `Refusing to update ${file}: ${e instanceof Error ? e.message : String(e)}\n`,
      };
    }
    await writeJsonAtomically(file, merged);
    if (g.json) {
      return { exitCode: 0, stdout: JSON.stringify({ wrote: file, config: merged }, null, 2) + "\n" };
    }
    return {
      exitCode: 0,
      stdout:
        `Wrote ${file}\n` +
        `Restart Claude Code in ${project} (or run \`claude\` there) and approve the unity-vibe-os server when prompted.\n`,
    };
  }

  if (g.json) return { exitCode: 0, stdout: text + "\n" };

  const banner = [
    `# Unity Vibe OS MCP config (${target})`,
    `# Add this to your Claude config:`,
    `#   - Per-project (recommended): ${path.join(project, ".mcp.json")}  — or run with --write to do it for you`,
    `#   - Per-user (Claude Code):    ~/.claude.json under \`mcpServers\``,
    `#   - Claude Desktop:            ~/Library/Application Support/Claude/claude_desktop_config.json (Mac)`,
    ``,
  ].join("\n");

  return { exitCode: 0, stdout: banner + text + "\n" };
}

/**
 * Codex names MCP servers with a bare TOML key, which cannot contain a hyphen —
 * hence `unity_vibe_os` here where Claude's JSON uses `unity-vibe-os`. The
 * desktop app uses the same name (`agent/codex.rs`), so tool labels line up.
 */
const CODEX_SERVER_NAME = "unity_vibe_os";

/** The `[mcp_servers.…]` block for `~/.codex/config.toml`, plus the CLI one-liner. */
function codexSnippet(entry: McpServerEntry, project: string): string {
  const args = entry.args.map(tomlString).join(", ");
  const envLines = Object.entries(entry.env)
    .map(([k, v]) => `${k} = ${tomlString(v)}`)
    .join("\n");

  const block = [
    `[mcp_servers.${CODEX_SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${args}]`,
    // Unity work is slow (compile + domain reload + tests); the default per-tool
    // timeout will cut `unity_verify` off long before it finishes.
    `startup_timeout_sec = 30`,
    `tool_timeout_sec = 900`,
    ``,
    `[mcp_servers.${CODEX_SERVER_NAME}.env]`,
    envLines,
    ``,
  ].join("\n");

  const banner = [
    `# Unity Vibe OS MCP config (codex)`,
    `#`,
    `# Add this to ~/.codex/config.toml — or let the CLI write it for you:`,
    `#   codex mcp add ${CODEX_SERVER_NAME} --env UVIBE_PROJECT=${project} -- ${entry.command} ${entry.args.join(" ")}`,
    `#`,
    `# Then run \`codex\` from ${project}.`,
    ``,
  ].join("\n");

  return banner + block;
}

/**
 * Render a TOML string value. Prefers a *literal* (single-quoted) string, which
 * has no escape sequences — the only safe way to write a Windows path, since
 * `'C:\Users\x'` is exactly those bytes whereas `"C:\Users\x"` is a parse error
 * (`\U` is not a valid escape). Falls back to an escaped basic string when the
 * value itself contains a single quote.
 */
function tomlString(s: string): string {
  if (!s.includes("'") && !s.includes("\n") && !s.includes("\r")) return `'${s}'`;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function buildEntry(opts: { project: string; mock: boolean; bare: boolean }): McpServerEntry {
  const env: Record<string, string> = { UVIBE_PROJECT: opts.project };
  if (opts.mock) env.UVIBE_MOCK = "1";

  if (opts.bare) {
    return { command: "uvibe", args: ["serve"], env };
  }

  // Resolve absolute paths so the user does not need `uvibe` on PATH.
  const here = fileURLToPath(import.meta.url);
  let dir = path.dirname(here);
  let cliBin: string | null = null;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "apps", "cli", "bin", "uvibe");
    if (existsSync(candidate)) {
      cliBin = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (cliBin === null) {
    // Fallback: bare uvibe (assume PATH).
    return { command: "uvibe", args: ["serve"], env };
  }
  return {
    command: process.execPath,
    args: [cliBin, "serve"],
    env,
  };
}

/**
 * Add our entry to the project's `.mcp.json`, preserving every other server and
 * top-level key. Throws (rather than starting fresh) when the file exists but
 * cannot be understood — the caller turns that into a refusal, because the
 * alternative is deleting MCP servers the user configured by hand.
 */
async function mergeMcpJson(file: string, entry: McpServerEntry): Promise<McpConfigShape> {
  let raw: string | null = null;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`existing file could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let existing: McpConfigShape = { mcpServers: {} };
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`existing file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!isRecord(parsed)) throw new Error("existing file must contain a JSON object");
    if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) {
      throw new Error("existing mcpServers value must be a JSON object");
    }
    existing = parsed as McpConfigShape;
  }

  existing.mcpServers = { ...(existing.mcpServers ?? {}), "unity-vibe-os": entry };
  return existing;
}

/** Write via temp+rename so an interrupted write can't truncate the user's config. */
async function writeJsonAtomically(file: string, value: McpConfigShape): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
