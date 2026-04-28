#!/usr/bin/env node
// Unity Vibe OS bootstrap.
//
// Usage:
//   node /path/to/wazzicode-unity/bootstrap.mjs <unity-project-path>
//   node /path/to/wazzicode-unity/bootstrap.mjs            # auto-detect Unity project from cwd
//
// Flags:
//   --rebuild                  Force a rebuild of the TypeScript packages.
//   --skip-install             Skip the dependency install step (use existing node_modules).
//   --skip-build               Skip the TypeScript build (use existing dist/).
//   --skip-unity-install       Skip writing to Packages/manifest.json.
//   --unity-install-mode=...   manifest | symlink | copy (default: manifest).
//
// What it does:
//   1) Detects the Unity project (or uses the path you pass).
//   2) Installs Node deps (pnpm if available, else npm).
//   3) Builds the TypeScript packages in topological order.
//   4) Calls `uvibe setup` against the Unity project, which:
//        a) writes .unity-vibe/{config.json, conventions.md, project_brain.{md,json}, claude_context.md}
//        b) adds com.uvibe.os to Packages/manifest.json
//        c) writes .mcp.json at the Unity project root (Claude Code auto-discovers)
//        d) updates CLAUDE.md with usage rules (marker-delimited; preserves your content)
//        e) runs `uvibe doctor`
//
// Idempotent. Safe to re-run.

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) flags[a.substring(2, eq)] = a.substring(eq + 1);
      else flags[a.substring(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function step(n, total, msg) {
  console.log(`\n[${n}/${total}] ${msg}`);
}

function info(msg) {
  console.log(`    ${msg}`);
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = (r.stdout ?? "").split(/\r?\n/).find((l) => l.trim().length > 0);
  return first ? first.trim() : null;
}

function run(cmd, args, opts = {}) {
  info(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? HERE, env: process.env });
  if (r.status !== 0) {
    fail(`Command failed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
  }
}

function isUnityProject(p) {
  for (const sub of ["Assets", "Packages", "ProjectSettings"]) {
    try {
      const s = statSync(path.join(p, sub));
      if (!s.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function findUnityProject(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 20; i++) {
    if (isUnityProject(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const PACKAGES_BUILD_ORDER = [
  "packages/core",
  "packages/safety",
  "packages/project-brain",
  "packages/mcp-server",
  "apps/cli",
];

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  let project = positional[0] ?? process.env.UVIBE_PROJECT ?? null;
  if (project) {
    project = path.resolve(project);
    if (!isUnityProject(project)) {
      fail(`Path is not a Unity project: ${project}\n   (it must contain Assets/, Packages/, ProjectSettings/)`);
    }
  } else {
    project = findUnityProject(process.cwd());
    if (!project) {
      fail(
        `No Unity project found from ${process.cwd()} upward.\n` +
          `Pass it explicitly:  node ${path.relative(process.cwd(), path.join(HERE, "bootstrap.mjs"))} /path/to/UnityProject`
      );
    }
    console.log(`Auto-detected Unity project: ${project}`);
  }

  const total = 4;

  // Step 1: install deps
  step(1, total, "Installing Node dependencies");
  if (flags["skip-install"]) {
    info("--skip-install set; skipping");
  } else if (existsSync(path.join(HERE, "node_modules")) && !flags.rebuild) {
    info(`node_modules exists at ${path.join(HERE, "node_modules")} — skipping (use --rebuild to force)`);
  } else {
    const pm = which("pnpm") ? "pnpm" : which("npm") ? "npm" : null;
    if (!pm) fail("Neither pnpm nor npm is on PATH. Install one and rerun.");
    info(`using ${pm}`);
    run(pm, ["install"]);
  }

  // Step 2: build
  step(2, total, "Building TypeScript packages");
  const cliDistEntry = path.join(HERE, "apps", "cli", "dist", "index.js");
  if (flags["skip-build"]) {
    info("--skip-build set; skipping");
    if (!existsSync(cliDistEntry)) fail(`Skipped build but ${cliDistEntry} does not exist. Re-run without --skip-build.`);
  } else if (existsSync(cliDistEntry) && !flags.rebuild) {
    info(`${path.relative(HERE, cliDistEntry)} exists — skipping (use --rebuild to force)`);
  } else {
    // Use npx tsc per package so we don't depend on pnpm's recursive build.
    const tsc = path.join(HERE, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (!existsSync(tsc)) fail(`tsc binary missing at ${tsc}. Did the install step complete? Re-run with --rebuild.`);
    for (const pkg of PACKAGES_BUILD_ORDER) {
      const cfg = path.join(HERE, pkg, "tsconfig.json");
      info(`building ${pkg}`);
      run(tsc, ["-p", cfg]);
    }
  }

  // Step 3: bin/uvibe sanity
  step(3, total, "Locating uvibe CLI");
  const uvibeBin = path.join(HERE, "apps", "cli", "bin", "uvibe");
  if (!existsSync(uvibeBin)) fail(`bin/uvibe missing at ${uvibeBin}. Re-run with --rebuild.`);
  info(`found ${uvibeBin}`);

  // Step 4: setup
  step(4, total, `Running uvibe setup against ${project}`);
  run(process.execPath, [uvibeBin, "setup", `--project=${project}`]);

  // Sanity-check the generated .mcp.json so we can give the user concrete next steps.
  const mcpJson = path.join(project, ".mcp.json");
  if (existsSync(mcpJson)) {
    try {
      const cfg = JSON.parse(readFileSync(mcpJson, "utf8"));
      const entry = cfg?.mcpServers?.["unity-vibe-os"];
      if (entry) {
        console.log(`\n.mcp.json sanity check at ${mcpJson}:`);
        console.log(`  command: ${entry.command}`);
        console.log(`  args:    ${(entry.args ?? []).join(" ")}`);
        console.log(`  env:     ${JSON.stringify(entry.env ?? {})}`);
      }
    } catch {
      console.warn(`Warning: .mcp.json exists at ${mcpJson} but failed to parse.`);
    }
  }

  console.log(`
✅ Unity Vibe OS bootstrap complete.

Next steps:
  1. Open the Unity project in Unity Editor:  ${project}
     (the bridge auto-starts at 127.0.0.1:38578)
  2. Restart Claude Code in the project directory:
       cd "${project}"
       claude
     Claude Code reads .mcp.json from the project root and will prompt you to
     approve the unity-vibe-os MCP server.
  3. Verify:  claude mcp list
     or:      node "${uvibeBin}" doctor --project="${project}"

Tip: Claude (the assistant) now has everything it needs in CLAUDE.md and
.unity-vibe/claude_context.md. Just open Claude Code in the project and ask
"what is selected in Unity?" or "show me the game view".
`);
}

main().catch((e) => {
  console.error(`\n❌ ${e?.stack ?? e?.message ?? String(e)}`);
  process.exit(1);
});
