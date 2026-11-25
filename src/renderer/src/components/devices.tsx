import { ClockExclamationPoint, CloudCheck, CloudOff, KeyRound, type LucideIcon, RefreshCw } from "lucide-react";
import { type ButtonHTMLAttributes, type Ref, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { SyncStatus } from "../../../shared/sync";
import { type DevicesView, devicesView, isProblem } from "../lib/devices";
import { timeAgo } from "../lib/format";
import { useSyncStatus } from "../lib/midad";
import type { BookReturn, SettingsState } from "../routes/settings";
import { Button, cx } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * Device sync, called "Devices" in the app so it never reads like a book's corpus Sync. The
 * indicator shows only while sync is on; it opens a popover with the status and a way to Settings.
 */

type Tone = "quiet" | "ok" | "warn" | "danger";

/** `label` is the indicator's; the popover's title is `title` when it says more. */
export const DEVICES_COPY: Record<DevicesView, { icon: LucideIcon; tone: Tone; label: string; title?: string; body: string | null }> = {
  connecting: { icon: RefreshCw, tone: "quiet", label: "Connecting…", body: null },
  synced: { icon: CloudCheck, tone: "ok", label: "Up to date", body: "Your highlights, notes, bookmarks and places match your other devices." },
  offline: {
    icon: CloudOff,
    tone: "warn",
    label: "Offline",
    title: "Offline · retrying",
    body: "Can't reach the server. Changes stay on this device and go out when it's back.",
  },
  refused: { icon: KeyRound, tone: "danger", label: "Sign-in refused", body: "The server didn't accept this device's token. Enter a new one in Settings." },
  clockWarning: {
    icon: ClockExclamationPoint,
    tone: "warn",
    label: "Check clocks",
    body: "One of your devices has the wrong clock. Edits still arrive, but may land out of order until it's fixed.",
  },
};

const ICON_TONES: Record<Tone, string> = { quiet: "text-ink-3", ok: "text-ok", warn: "text-warn", danger: "text-danger" };
const DOT_TONES: Record<Tone, string> = { quiet: "bg-ink-3", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" };

/** Re-renders every so often, so "just now" ages without anything else changing. */
export const useNow = (everyMs = 30_000) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
};

export const lastUpToDate = ({ status, now }: { status: SyncStatus; now: number }) =>
  status.lastSyncedAt === null ? "Not up to date yet" : `Last up to date ${timeAgo(Math.min(status.lastSyncedAt, now), now)}`;

/** The state's icon; it crossfades in when the state changes, and spins while connecting. Tinted only in the popover. */
const StatusIcon = ({ view, tinted, className }: { view: DevicesView; tinted: boolean; className?: string }) => {
  const { icon: Icon, tone } = DEVICES_COPY[view];
  return (
    <Icon
      key={view}
      aria-hidden
      className={cx(
        "shrink-0 animate-in fade-in-0 zoom-in-90 duration-pop ease-out",
        tinted && ICON_TONES[tone],
        view === "connecting" && "animate-spin [animation-duration:1.2s] motion-reduce:animate-none",
        className,
      )}
    />
  );
};

/** A small dot on the glyph's corner, in the state's tone, for states that need attention. */
const ProblemDot = ({ view, ring }: { view: DevicesView; ring: string }) =>
  isProblem(view) ? (
    <span
      key={view}
      aria-hidden
      data-devices-dot
      className={cx("absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 animate-in zoom-in-0 fade-in-0 duration-pop ease-out", DOT_TONES[DEVICES_COPY[view].tone], ring)}
    />
  ) : null;

const DevicesPopover = ({ view, status, onSettings }: { view: DevicesView; status: SyncStatus; onSettings: () => void }) => {
  const now = useNow();
  const { label, title, body } = DEVICES_COPY[view];
  return (
    <div className="flex flex-col gap-2 p-1.5" data-devices-popover={view}>
      <span className="text-overline font-semibold uppercase tracking-widest text-ink-3">Devices</span>
      <div className="flex items-center gap-2">
        <StatusIcon view={view} tinted className="size-4" />
        <span className="text-sm font-medium">{title ?? label}</span>
      </div>
      {body && <p className="text-small text-ink-2">{body}</p>}
      <div className="mt-1 flex items-center gap-3">
        <span className="flex-1 text-xs text-ink-3">{lastUpToDate({ status, now })}</span>
        <Button variant={view === "refused" ? "primary" : "secondary"} size="sm" onClick={onSettings}>
          Settings…
        </Button>
      </div>
    </div>
  );
};

/** The top bar's icon button: takes the popover trigger's props, and shows the state as its tooltip. */
const ToolbarTrigger = ({ label, view, tooltip, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; view: DevicesView; tooltip: boolean; ref?: Ref<HTMLButtonElement> }) => (
  <Tooltip open={tooltip ? undefined : false}>
    <TooltipTrigger
      render={
        <button
          type="button"
          aria-label={`Devices: ${label}`}
          data-devices-indicator={view}
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors duration-press hover:bg-ink/4 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent data-popup-open:bg-accent-soft"
          {...props}
        />
      }
    >
      {children}
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/**
 * `sidebar`: a full-width row at the foot of the Library and Settings sidebar, opening upward.
 * `toolbar`: an icon in the reader's top bar, opening downward, with a dot for problems.
 */
export const DevicesIndicator = ({ placement, bookReturn }: { placement: "sidebar" | "toolbar"; bookReturn?: () => BookReturn | undefined }) => {
  const status = useSyncStatus().data;
  const view = devicesView(status);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  if (!view || !status) return null;
  const { label } = DEVICES_COPY[view];

  const toSettings = () => {
    setOpen(false);
    const from = bookReturn?.();
    void navigate("/settings", { state: { section: "devices", ...(from ? { from } : {}) } satisfies SettingsState, viewTransition: true });
  };

  const icon = (
    <span className="relative flex">
      <StatusIcon view={view} tinted={false} className={placement === "sidebar" ? "size-4" : "size-4.5"} />
      <ProblemDot view={view} ring={placement === "sidebar" ? "ring-surface-2" : "ring-bg"} />
    </span>
  );

  const trigger =
    placement === "sidebar" ? (
      <button
        type="button"
        aria-label={`Devices: ${label}`}
        data-devices-indicator={view}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-small text-ink-2 transition-colors duration-press hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent data-popup-open:bg-surface"
      >
        {icon}
        <span key={view} className="animate-in fade-in-0 duration-pop ease-out">
          {label}
        </span>
      </button>
    ) : (
      <ToolbarTrigger label={label} view={view} tooltip={!open}>
        {icon}
      </ToolbarTrigger>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent side={placement === "sidebar" ? "top" : "bottom"} align={placement === "sidebar" ? "start" : "end"} sideOffset={8} className="w-75">
        <DevicesPopover view={view} status={status} onSettings={toSettings} />
      </PopoverContent>
    </Popover>
  );
};
