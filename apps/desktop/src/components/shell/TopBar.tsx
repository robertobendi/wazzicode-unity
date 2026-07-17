import { useSettingsStore } from "@/stores/useSettingsStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUiStore, type AppMode } from "@/stores/useUiStore";
import { useLoopStore } from "@/stores/useLoopStore";
import { useStatusStore } from "@/stores/useStatusStore";
import { isLoopActive } from "@/types/loop";
import type { BridgeState } from "@/types/status";
import { formatTokens } from "@/lib/formatTokens";
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
  const totalCost = useChatStore((s) => s.session.totalCostUsd);
  const totalTokens = useChatStore((s) => s.session.totalTokens);
  const loopRunning = useLoopStore((s) => isLoopActive(s.state?.status));
  const bridge = useStatusStore((s) => s.status);
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
  const bridgeLabel = bridge.compiling
    ? "Compiling"
    : bridge.playMode
      ? "Playing"
      : bridge.friendly;
  const usageLabel =
    totalCost > 0
      ? `$${totalCost.toFixed(3)}`
      : totalTokens > 0
        ? formatTokens(totalTokens)
        : null;
  const statusLabel = `Unity: ${bridgeLabel}${usageLabel ? `. Session usage: ${usageLabel}` : ""}`;

  return (
    <header className="glass-bar relative mx-3 mt-3 grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-2xl border px-3">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
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
        <span className="truncate text-sm font-medium text-fg">{name}</span>
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

      <div className="justify-self-center">
        <ModeToggle mode={mode} setMode={setMode} disabled={navigationLocked} />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <div
          className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/20 px-2 py-1 text-[11px] text-fg-dim"
          role="status"
          aria-label={statusLabel}
          title={statusLabel}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${bridgeDot(bridge.state)}`}
          />
          <span className="hidden max-w-24 truncate lg:inline">{bridgeLabel}</span>
        </div>
        {usageLabel && (
          <span className="hidden whitespace-nowrap px-1 text-[11px] tabular-nums text-fg-dim xl:inline">
            {usageLabel}
          </span>
        )}
        <RevertControl />
        {mode === "chat" && (
          <div className="activity-toggle">
            <IconButton
              label={activityOpen ? "Hide activity" : "Show activity"}
              active={activityOpen}
              onClick={toggleActivity}
            >
              <PanelIcon />
            </IconButton>
          </div>
        )}
        <IconButton
          id="settings-trigger"
          label="Settings"
          active={settingsOpen}
          expanded={settingsOpen}
          controls="settings-popover"
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <GearIcon />
        </IconButton>
      </div>

      {settingsOpen && <SettingsPopover key={settingsBackend} />}
    </header>
  );
}

function bridgeDot(state: BridgeState): string {
  switch (state) {
    case "connected":
      return "bg-success";
    case "reloading":
      return "bg-warning animate-dot-pulse";
    case "identity_mismatch":
      return "bg-warning";
    case "disconnected":
    default:
      return "bg-danger";
  }
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
  id,
  label,
  active,
  expanded,
  controls,
  onClick,
}: {
  children: React.ReactNode;
  id?: string;
  label: string;
  active?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`rounded-lg p-1.5 transition-colors duration-150 hover:bg-white/5 ${
        active ? "text-fg" : "text-fg-dim hover:text-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}
