import { CircleArrowDown, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useRestartToUpdate, useUpdateStatus } from "../lib/midad";
import { showNotice } from "../lib/updates";
import { Button, cx } from "./ui";

/**
 * "Update ready · Restart to update": shown in the sidebar once an update has downloaded.
 * Dismissing hides it for the rest of this run; it comes back next launch. The reader shows the
 * update on its top bar's status icon instead (see devices.tsx).
 */

let dismissed: string | null = null;
const listeners = new Set<() => void>();
const dismiss = (version: string) => {
  dismissed = version;
  for (const listener of listeners) listener();
};
const useDismissed = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed,
  );

export const RESTART_BLOCKED = "Restart once Claude finishes answering.";

/** Restart, with the reason it's held back when an answer is streaming. */
export const useRestart = () => {
  const restart = useRestartToUpdate();
  return () => restart.mutate(undefined, { onError: (err) => toast.error(err.message) });
};

const ENTER = "animate-in fade-in-0 slide-in-from-bottom-1 duration-pop ease-out motion-reduce:slide-in-from-bottom-0";
const EXIT = "animate-out fade-out-0 duration-pop-exit ease-out fill-mode-forwards";

const RestartButton = ({ blocked }: { blocked: boolean }) => {
  const restart = useRestart();
  return (
    <Button size="sm" disabled={blocked} tooltip={blocked ? RESTART_BLOCKED : undefined} onClick={restart} className="w-full">
      Restart to update
    </Button>
  );
};

export const UpdateNotice = () => {
  const status = useUpdateStatus().data;
  const hidden = useDismissed();
  const [closing, setClosing] = useState(false);
  if (!status || status.phase.kind !== "ready" || !showNotice({ status, dismissed: hidden })) return null;
  const { version } = status.phase;

  return (
    <div
      role="status"
      aria-label={`Midad ${version} is ready to install`}
      data-update-notice="sidebar"
      className={cx("flex flex-col gap-2 rounded-lg bg-accent-soft py-1.5 pr-1.5 pb-2 pl-2.5 text-accent", closing ? EXIT : ENTER)}
      onAnimationEnd={() => closing && dismiss(version)}
    >
      <div className="flex items-center gap-2">
        <CircleArrowDown aria-hidden className="size-4 shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap">Update ready</span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setClosing(true)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-press hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <RestartButton blocked={status.restartBlocked} />
    </div>
  );
};

/** The top of the reader's status popover: which version is ready, and Restart. */
export const UpdateReadySection = ({ version, blocked }: { version: string; blocked: boolean }) => (
  <div className="flex flex-col gap-2 p-1.5" data-update-section>
    <span className="text-overline font-semibold uppercase tracking-widest text-ink-3">Update</span>
    <div className="flex items-center gap-2">
      <CircleArrowDown aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="text-sm font-medium">Midad {version} is ready</span>
    </div>
    <RestartButton blocked={blocked} />
  </div>
);
