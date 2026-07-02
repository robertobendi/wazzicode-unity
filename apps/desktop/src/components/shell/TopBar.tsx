import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore, type AppMode } from "@/stores/useUiStore";
import { GearIcon, PanelIcon } from "./icons";
import Logo from "./Logo";
import SettingsPopover from "./SettingsPopover";

/** Slim app header: project name, Chat/Auto toggle, activity-panel, settings. */
export default function TopBar() {
  const project = useChatStore((s) => s.project);
  const update = useSettingsStore((s) => s.update);
  const {
    activityOpen,
    toggleActivity,
    settingsOpen,
    setSettingsOpen,
    mode,
    setMode,
  } = useUiStore();
  const name = project ? project.split(/[\\/]/).pop() || project : "";

  return (
    <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-ink-900 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Logo />
        <span className="text-sm font-medium text-fg">{name}</span>
        <button
          onClick={() => void update({ currentProject: null })}
          className="rounded-md px-1.5 py-0.5 text-xs text-fg-dim transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted"
        >
          Switch
        </button>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2">
        <ModeToggle mode={mode} setMode={setMode} />
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          label={activityOpen ? "Hide activity" : "Show activity"}
          active={activityOpen}
          onClick={toggleActivity}
        >
          <PanelIcon />
        </IconButton>
        <IconButton
          label="Settings"
          active={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <GearIcon />
        </IconButton>
      </div>

      {settingsOpen && <SettingsPopover />}
    </header>
  );
}

/** Quiet segmented control switching between manual chat and auto mode. */
function ModeToggle({
  mode,
  setMode,
}: {
  mode: AppMode;
  setMode: (m: AppMode) => void;
}) {
  const options: { value: AppMode; label: string }[] = [
    { value: "chat", label: "Chat" },
    { value: "auto", label: "Auto" },
  ];
  return (
    <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setMode(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150 ${
            mode === o.value
              ? "bg-ink-700 text-fg"
              : "text-fg-dim hover:text-fg-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 transition-colors duration-150 hover:bg-ink-800 ${
        active ? "text-fg" : "text-fg-dim hover:text-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}
