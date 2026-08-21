import { useChatStore } from "@/stores/useChatStore";
import { useStatusStore } from "@/stores/useStatusStore";
import OpenUnityButton from "./OpenUnityButton";

/**
 * Non-blocking amber banner shown when Unity drops out mid-run. Disconnection
 * can recover; a project identity mismatch needs the user to switch Unity.
 */
export default function ConnectionBanner() {
  const running = useChatStore((s) => s.running);
  const project = useChatStore((s) => s.project);
  const state = useStatusStore((s) => s.status.state);

  if (!running) return null;

  const message =
    state === "identity_mismatch"
      ? "A different Unity project is open in the Editor, so the task can't continue."
      : state === "disconnected"
        ? "Unity isn't running. The task retries as soon as it reconnects."
        : null;
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-3 mt-2 animate-appear rounded-xl border border-warning/20 bg-warning/10 px-4 py-2 text-center text-xs text-warning backdrop-blur-xl"
    >
      {message}
      {/* Naming the fix without offering it is what made this banner a dead end. */}
      {state === "disconnected" && project && (
        <span className="ml-2 inline-flex align-middle">
          <OpenUnityButton project={project} alwaysVisible />
        </span>
      )}
    </div>
  );
}
