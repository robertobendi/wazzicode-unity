# Unity Vibe Studio

A chat-first desktop app (macOS / Windows / Linux) that lets non-technical
teammates make Unity changes through an AI assistant — no terminal. It drives
Unity via the [Unity Vibe OS](../../README.md) MCP bridge and ships its own Node
runtime + MCP server, so employees never install Node or clone this monorepo.

## Dev quickstart

```bash
pnpm install                              # from the repo root
pnpm --filter @uvibe/desktop tauri dev    # launch the app with hot reload
```

Dev builds use the `dev_uvibe_entry` fallback in `src-tauri/src/mcpconfig.rs`,
so you don't need to bundle the sidecar just to run `tauri dev`.

Other useful commands:

```bash
pnpm --filter @uvibe/desktop typecheck    # tsc --noEmit
pnpm --filter @uvibe/desktop test         # vitest (streamMapper, toolLabels, promptAssembly)
```

## Building a packaged app locally

Packaging needs two artifacts the base Tauri config intentionally omits — the
Node sidecar (`externalBin`) and the bundled `uvibe.cjs` + Unity package
(`resources`). Prepare them, then build with the overlay config:

```bash
pnpm build                                                 # workspace (produces apps/cli/dist)
pnpm --filter @uvibe/desktop bundle:sidecar               # fetch host-triple node binary
pnpm --filter @uvibe/desktop bundle:uvibe                 # bundle CLI + copy Unity package
pnpm --filter @uvibe/desktop exec tauri build \
  --config src-tauri/tauri.bundle.conf.json               # add --target <triple> to cross to a specific arch
```

## Release process (CI)

Releases are built by `.github/workflows/desktop-release.yml` — a 4-target
matrix (macOS arm64 + intel, Windows x86_64, Linux x86_64) that runs the same
`pnpm build → fetch-node-sidecar → bundle-uvibe → tauri build` steps per leg.

```bash
git tag desktop-v0.1.0
git push --tags
```

The workflow then appears in **Actions**; when it finishes, a **draft** GitHub
release named `Unity Vibe Studio desktop-v0.1.0` holds all installers. Review it
and click **Publish** manually. (You can also start it from the Actions tab via
**Run workflow** — `workflow_dispatch`.)

Artifacts per release:

| OS | Files |
|---|---|
| macOS (arm64, intel) | `.dmg` |
| Windows | `.msi`, NSIS `.exe` |
| Linux | `.deb`, `.AppImage` |

These builds are **unsigned and un-notarized** — there are no Apple, minisign,
or auto-updater secrets in the workflow. That is expected for v1; the install
notes below cover the resulting first-launch prompts.

## Install notes (unsigned builds)

- **macOS** — Gatekeeper blocks unsigned apps on first launch. Right-click the
  app in `/Applications` → **Open** → **Open** on the dialog (only needed once).
  Or from a terminal:
  `xattr -d com.apple.quarantine "/Applications/Unity Vibe Studio.app"`.
- **Windows** — SmartScreen shows "Windows protected your PC". Click
  **More info → Run anyway**. The installer downloads the WebView2 runtime
  automatically if it's missing.
- **Linux** — the `.AppImage` is self-contained: `chmod +x` it and run. The
  `.deb` installs with `sudo apt install ./Unity-Vibe-Studio_*.deb`.

## Pairing flow (for the admin)

Employees sign in against the **company Claude account** without ever seeing the
token. The app runs `claude setup-token` in the background and shows the employee
a single **"Copy link for your admin"** screen. As the admin, when an employee
sends you that OAuth link:

1. Open the link **in a browser where you're logged into the company Claude
   account** (the account whose subscription/credits the team should use).
2. Approve the authorization request. The page shows a short **code**.
3. Send that code back to the employee.

The employee pastes the code into the app; it captures the resulting OAuth token,
stores it in the OS keychain (never in project files), and verifies it with a
cheap probe. From then on their chats and auto-loop runs use the company account.
If a pairing gets stuck, the employee can hit **Start over** (there's a 10-minute
timeout) and re-send you a fresh link.
