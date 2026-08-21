import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import OpenUnityButton from "@/components/shell/OpenUnityButton";
import { useStatusStore } from "@/stores/useStatusStore";
import { PrimaryButton, StepHeading } from "./_shared";

/**
 * Step 5 — the finish line. Polls the Unity bridge live: offers to start Unity (through Unity's
 * own CLI) and flips to a green "All set" the moment it connects.
 * Finish is enabled regardless (Unity can connect later).
 */
export default function ReadyStep({
  project,
  projectName,
  onFinish,
}: {
  project: string;
  projectName: string;
  onFinish: () => void;
}) {
  useBridgeStatus(project);
  const status = useStatusStore((s) => s.status);
  const connected = status.state === "connected";

  return (
    <div>
      <StepHeading title={connected ? "All set" : "Almost there"}>
        {connected
          ? "Unity is connected. You can start chatting to make changes to your game."
          : "One last thing — Unity has to be running. Start it here, or open it yourself."}
      </StepHeading>

      <div
        className={`mt-6 rounded-xl border p-5 transition-colors ${
          connected
            ? "border-success/30 bg-success/5"
            : "border-white/10 bg-ink-900"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
              connected
                ? "bg-success/15 text-success"
                : "bg-ink-800 text-fg-dim"
            }`}
          >
            {connected ? "✓" : "…"}
          </span>
          <div>
            <div className="text-sm font-medium text-fg">
              {connected ? "Unity connected" : `Waiting for Unity — ${projectName}`}
            </div>
            <div className="mt-0.5 text-xs text-fg-dim">{status.friendly}</div>
          </div>
          {!connected && project && (
            <div className="ml-auto">
              <OpenUnityButton project={project} alwaysVisible />
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <PrimaryButton onClick={onFinish}>
          {connected ? "Start chatting" : "Finish"}
        </PrimaryButton>
      </div>
    </div>
  );
}
