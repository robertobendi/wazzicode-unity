import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore, type AppMode } from "@/stores/useUiStore";
import { useLoopStore } from "@/stores/useLoopStore";
import { isLoopActive } from "@/types/loop";
import { useCliInstallActive } from "@/hooks/useOnboarding";
import { GearIcon, PanelIcon, SidebarIcon } from "./icons";
import Logo from "./Logo";
import RevertControl from "./RevertControl";
import SettingsPopover from "./SettingsPopover";

/** Slim app header: project name, Chat/Auto toggle, activity-panel, settings. */
export default function TopBar() {
  const project = useChatStore((s) => s.project);
  const update = useSettingsStore((s) => s.update);
  const settingsBackend = useSettingsStore((s) => s.settings?.agentBackend);
  const chatRunning = useChatStore((s) => s.running);
  const loopRunning = useLoopStore((s) => isLoopActive(s.state?.status));
  const cliInstalling = useCliInstallActive();
  const taskActive = chatRunning || loopRunning;
  const navigationLocked = taskActive || cliInstalling;
  const {
    activityOpen,
    toggleActivity,
    sessionRailOpen,
    toggleSessionRail,
    settingsOpen,
    setSettingsOpen,
    mode,
    setMode,
  } = useUiStore();
  const name = project ? project.split(/[\\/]/).pop() || project : "";

  return (
    <header className="glass-bar relative mx-3 mt-3 flex h-12 shrink-0 items-center justify-between rounded-2xl border px-4">
      <div className="flex min-w-0 items-center gap-2">
        {mode === "chat" && (
          <IconButton
            label={sessionRailOpen ? "Hide chats" : "Show chats"}
            active={sessionRailOpen}
            onClick={toggleSessionRail}
          >
            <SidebarIcon />
          </IconButton>
        )}
        <Logo />
        <span className="text-sm font-medium text-fg">{name}</span>
        <button
          onClick={() => void update({ currentProject: null })}
          disabled={navigationLocked}
          title={
            navigationLocked
              ? "Wait for the current task or CLI install before switching projects"
              : undefined
          }
          className="rounded-md px-1.5 py-0.5 text-xs text-fg-dim transition-colors duration-150 hover:bg-ink-800 hover:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Switch
        </button>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2">
        <ModeToggle mode={mode} setMode={setMode} disabled={navigationLocked} />
      </div>

      <div className="flex items-center gap-1">
        <RevertControl />
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

      {settingsOpen && <SettingsPopover key={settingsBackend} />}
    </header>
  );
}

/** Quiet segmented control switching between manual chat and auto mode. */
function ModeToggle({
  mode,
  setMode,
  disabled,
}: {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  disabled: boolean;
}) {
  const options: { value: AppMode; label: string }[] = [
    { value: "chat", label: "Chat" },
    { value: "auto", label: "Auto" },
  ];
  return (
    <div className="flex rounded-xl border border-white/10 bg-black/20 p-0.5 shadow-inner shadow-black/30">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setMode(o.value)}
          disabled={disabled}
          title={
            disabled
              ? "Wait for the current task or CLI install before changing modes"
              : undefined
          }
          className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === o.value
              ? "bg-white/10 text-fg shadow-sm shadow-black/30"
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
      className={`rounded-lg p-1.5 transition-colors duration-150 hover:bg-white/5 ${
        active ? "text-fg" : "text-fg-dim hover:text-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}
