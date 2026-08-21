import {
  installUnityPackage,
  readEditorPackageStatus,
  type InstallModeRequest,
} from "@uvibe/unity-package";
import { CommandResult, GlobalOptions, ParsedArgs } from "../options.js";

/**
 * Thin wrapper over `@uvibe/unity-package`. The mechanics (source resolution, manifest
 * rewriting, embedding) live in the package so the MCP server can run exactly the same code when
 * it self-heals a stale install; this file only turns flags into options and results into text.
 */
export async function runInstallUnityPackage(g: GlobalOptions, parsed: ParsedArgs): Promise<CommandResult> {
  // Default to an embedded copy: portable across machines (no absolute paths, no GitHub auth),
  // auto-discovered by Unity. "embed" is an alias of "copy". manifest/symlink remain available.
  const modeRaw = typeof parsed.flags.mode === "string" ? parsed.flags.mode : "copy";
  const mode = (modeRaw === "embed" ? "copy" : modeRaw) as InstallModeRequest;
  if (mode !== "copy" && mode !== "manifest" && mode !== "symlink") {
    return { exitCode: 2, stderr: `unknown --mode=${modeRaw}. Use copy|manifest|symlink (copy is default).\n` };
  }
  // Prefer an explicit --source (how the desktop app points at its bundled copy,
  // which lives outside the monorepo tree); only auto-locate when it's absent.
  const explicitSource = typeof parsed.flags.source === "string" ? parsed.flags.source : null;

  let result;
  try {
    result = await installUnityPackage(g.project, { mode, source: explicitSource });
  } catch (error) {
    // Every failure here is a user-fixable setup problem (no source tree, not a Unity project,
    // unreadable manifest), so report the message and exit non-zero rather than throwing.
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }

  const status = await readEditorPackageStatus(g.project);
  if (g.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ...result, version: status.version }, null, 2) + "\n",
    };
  }

  const lines: string[] = [
    `Source:  ${result.source}`,
    `Target:  ${result.target}`,
    `Mode:    ${result.mode}`,
    "",
  ];
  if (result.mode === "manifest") {
    lines.push(`Wrote Packages/manifest.json`);
    lines.push(`  "com.uvibe.os": "${result.manifestRef}"`);
    if (result.absoluteRef) {
      lines.push("");
      lines.push("WARNING: emitted an ABSOLUTE path (source is on a different drive than the project).");
      lines.push("It will NOT resolve on other machines. For a shared/team project use the default");
      lines.push("--mode=copy, which embeds a portable copy under Packages/.");
    }
  } else if (result.mode === "symlink") {
    lines.push(`symlinked Packages/com.uvibe.os → ${result.source}`);
    lines.push("(symlink targets this machine only; use --mode=copy for a shareable project.)");
  } else {
    lines.push(`Embedded a portable copy at Packages/com.uvibe.os (version ${status.version ?? "unknown"})`);
    lines.push(`  (copied from ${result.source}; commit Packages/com.uvibe.os/ with your project).`);
  }
  if (result.removedManifestEntry) {
    lines.push(`Removed stale manifest entry "com.uvibe.os": "${result.removedManifestEntry}".`);
    lines.push("  (That absolute path is why the package failed to resolve on other machines.)");
  }
  lines.push("");
  lines.push("Next: open the Unity project. The bridge auto-starts at 127.0.0.1:38578.");
  lines.push(`Verify with: uvibe doctor --project=${g.project}`);
  return { exitCode: 0, stdout: lines.join("\n") + "\n" };
}
