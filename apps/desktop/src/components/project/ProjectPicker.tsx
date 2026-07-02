import { useState } from "react";
import { api, pickFolder } from "@/api";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { ProjectInfo } from "@/types/project";

/**
 * First-run / project-switch screen: pick a folder, validate it's a Unity
 * project, and open it. Also lists recent projects for one-click reopening.
 */
export default function ProjectPicker() {
  const { settings, setSettings } = useSettingsStore();
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recents = settings?.recentProjects ?? [];

  async function inspect(path: string) {
    setError(null);
    setChecking(true);
    try {
      const info = await api.validateUnityProject(path);
      if (!info.ok) {
        setCandidate(null);
        setError(
          `That folder doesn't look like a Unity project (missing ${
            info.hasAssets ? "" : "Assets/ "
          }${info.hasProjectSettings ? "" : "ProjectSettings/"}).`.trim(),
        );
      } else {
        setCandidate(info);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }

  async function browse() {
    const path = await pickFolder();
    if (path) await inspect(path);
  }

  async function open(path: string) {
    // Returns the canonical settings (current project + updated recents); adopt
    // it directly so we don't clobber the recents with a stale re-save.
    const saved = await api.setCurrentProject(path);
    setSettings(saved);
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-ink-950 px-8">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          Open a Unity project
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Choose the folder that holds your game — the one with{" "}
          <code className="text-fg-dim">Assets</code> and{" "}
          <code className="text-fg-dim">ProjectSettings</code>.
        </p>

        <button
          onClick={browse}
          disabled={checking}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {checking ? "Checking…" : "Choose folder…"}
        </button>

        {error && <p className="mt-3 text-xs text-accent">{error}</p>}

        {candidate && (
          <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
            <div className="text-sm font-medium text-fg">{candidate.name}</div>
            <div className="mt-0.5 truncate text-xs text-fg-dim">
              {candidate.path}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <Tag>
                Unity {candidate.unityVersion ?? "version unknown"}
              </Tag>
              <Tag ok={candidate.uvibeInitialized}>
                {candidate.uvibeInitialized
                  ? `Vibe OS ready${
                      candidate.safetyMode ? ` · ${candidate.safetyMode}` : ""
                    }`
                  : "Vibe OS not set up"}
              </Tag>
            </div>
            <button
              onClick={() => open(candidate.path)}
              className="mt-3 w-full rounded-md bg-ink-700 px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-ink-600"
            >
              Open project
            </button>
          </div>
        )}

        {recents.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
              Recent
            </div>
            <ul className="space-y-1">
              {recents.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => open(p)}
                    className="w-full truncate rounded-md px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
                    title={p}
                  >
                    {p.split(/[\\/]/).pop() || p}
                    <span className="ml-2 text-xs text-fg-dim">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  const tone =
    ok === undefined
      ? "border-ink-700 text-fg-muted"
      : ok
        ? "border-emerald-700/50 text-emerald-400"
        : "border-amber-700/50 text-amber-400";
  return (
    <span className={`rounded-full border px-2 py-0.5 ${tone}`}>{children}</span>
  );
}
