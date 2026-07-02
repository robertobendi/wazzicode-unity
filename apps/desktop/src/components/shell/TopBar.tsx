import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore } from "@/stores/useUiStore";
import { GearIcon, PanelIcon } from "./icons";
import SettingsPopover from "./SettingsPopover";

/** Slim app header: project name, activity-panel toggle, settings. */
export default function TopBar() {
  const project = useChatStore((s) => s.project);
  const update = useSettingsStore((s) => s.update);
  const { activityOpen, toggleActivity, settingsOpen, setSettingsOpen } =
    useUiStore();
  const name = project ? project.split(/[\\/]/).pop() || project : "";

  return (
    <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-ink-900 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-fg">{name}</span>
        <button
          onClick={() => void update({ currentProject: null })}
          className="rounded-md px-1.5 py-0.5 text-xs text-fg-dim transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted"
        >
          Switch
        </button>
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
