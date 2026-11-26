import { CircleArrowDown, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useRestartToUpdate, useUpdateStatus } from "../lib/midad";
import { showNotice } from "../lib/updates";
import { Button, cx } from "./ui";

/**
 * "Update ready · Restart": shown in the sidebar and the reader's top bar once an update has
 * downloaded. Dismissing hides it for the rest of this run; it comes back next launch.
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

export const UpdateNotice = ({ placement }: { placement: "sidebar" | "toolbar" }) => {
  const status = useUpdateStatus().data;
  const hidden = useDismissed();
  const restart = useRestart();
  const [closing, setClosing] = useState(false);
  if (!status || status.phase.kind !== "ready" || !showNotice({ status, dismissed: hidden })) return null;
  const { version } = status.phase;
  const blocked = status.restartBlocked;

  const close = (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => setClosing(true)}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-press hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <X aria-hidden className="size-3.5" />
    </button>
  );
  const restartButton = (
    <Button size="sm" disabled={blocked} tooltip={blocked ? RESTART_BLOCKED : undefined} onClick={restart} className={placement === "sidebar" ? "w-full" : undefined}>
      {placement === "sidebar" ? "Restart to update" : "Restart"}
    </Button>
  );
  const label = (
    <>
      <CircleArrowDown aria-hidden className="size-4 shrink-0" />
      <span className="text-sm font-medium whitespace-nowrap">Update ready</span>
    </>
  );

  return (
    <div
      role="status"
      aria-label={`Midad ${version} is ready to install`}
      data-update-notice={placement}
      className={cx(
        "bg-accent-soft text-accent",
        placement === "sidebar" ? "flex flex-col gap-2 rounded-lg py-1.5 pr-1.5 pb-2 pl-2.5" : "flex h-8 shrink-0 items-center gap-2 rounded-full pr-1 pl-3",
        closing ? EXIT : ENTER,
      )}
      onAnimationEnd={() => closing && dismiss(version)}
    >
      {placement === "sidebar" ? (
        <>
          <div className="flex items-center gap-2">
            {label}
            <div className="flex-1" />
            {close}
          </div>
          {restartButton}
        </>
      ) : (
        <>
          {label}
          {restartButton}
          {close}
        </>
      )}
    </div>
  );
};
