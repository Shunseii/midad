import { CircleArrowDown, ClockExclamationPoint, CloudCheck, CloudDownload, CloudOff, KeyRound, type LucideIcon, RefreshCw } from "lucide-react";
import { type ButtonHTMLAttributes, type Ref, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { SyncStatus } from "../../../shared/sync";
import { type DevicesView, devicesView, isProblem, type ToolbarDot, type ToolbarGlyph, toolbarIndicator, toolbarLabel } from "../lib/devices";
import { timeAgo } from "../lib/format";
import { useSyncStatus, useUpdateStatus } from "../lib/midad";
import type { BookReturn, SettingsState } from "../routes/settings";
import { Button, cx } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { UpdateReadySection } from "./updates";

/**
 * Device sync, called "Devices" in the app so it never reads like a book's corpus Sync. The
 * indicator shows only while sync is on; it opens a popover with the status and a way to Settings.
 * In the reader's top bar it also carries a downloaded update: a download glyph with a dot, and
 * Restart at the top of the popover, even when sync is off.
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

const UPDATE_ICONS: Record<Extract<ToolbarGlyph, "updateWithDevices" | "updateOnly">, LucideIcon> = { updateWithDevices: CloudDownload, updateOnly: CircleArrowDown };

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

/** The glyph; it crossfades in when it changes, and spins while connecting. Tinted only in the popover. */
const StatusIcon = ({ glyph, tinted, className }: { glyph: ToolbarGlyph; tinted: boolean; className?: string }) => {
  const isUpdate = glyph === "updateWithDevices" || glyph === "updateOnly";
  const Icon = isUpdate ? UPDATE_ICONS[glyph] : DEVICES_COPY[glyph].icon;
  return (
    <Icon
      key={glyph}
      aria-hidden
      className={cx(
        "shrink-0 animate-in fade-in-0 zoom-in-90 duration-pop ease-out",
        tinted && !isUpdate && ICON_TONES[DEVICES_COPY[glyph].tone],
        glyph === "connecting" && "animate-spin [animation-duration:1.2s] motion-reduce:animate-none",
        className,
      )}
    />
  );
};

/** A small dot on the glyph's corner: the state's tone for a sync problem, else accent while an update waits. */
const CornerDot = ({ dot, view, ring }: { dot: ToolbarDot; view: DevicesView | null; ring: string }) => {
  if (!dot) return null;
  const problem = dot === "problem" && view;
  return (
    <span
      key={problem ? view : dot}
      aria-hidden
      data-devices-dot={problem ? "" : undefined}
      data-update-dot={problem ? undefined : ""}
      className={cx(
        "absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 animate-in zoom-in-0 fade-in-0 duration-pop ease-out",
        problem ? DOT_TONES[DEVICES_COPY[view].tone] : "bg-accent",
        ring,
      )}
    />
  );
};

const DevicesPopover = ({ view, status, onSettings }: { view: DevicesView; status: SyncStatus; onSettings: () => void }) => {
  const now = useNow();
  const { label, title, body } = DEVICES_COPY[view];
  return (
    <div className="flex flex-col gap-2 p-1.5" data-devices-popover={view}>
      <span className="text-overline font-semibold uppercase tracking-widest text-ink-3">Devices</span>
      <div className="flex items-center gap-2">
        <StatusIcon glyph={view} tinted className="size-4" />
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

/** The top bar's icon button: takes the popover trigger's props, and shows `label` as its tooltip. */
const ToolbarTrigger = ({ label, tooltip, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tooltip: boolean; ref?: Ref<HTMLButtonElement> }) => (
  <Tooltip open={tooltip ? undefined : false}>
    <TooltipTrigger
      render={
        <button
          type="button"
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

const useToSettings = ({ close, bookReturn }: { close: () => void; bookReturn?: () => BookReturn | undefined }) => {
  const navigate = useNavigate();
  return () => {
    close();
    const from = bookReturn?.();
    void navigate("/settings", { state: { section: "devices", ...(from ? { from } : {}) } satisfies SettingsState, viewTransition: true });
  };
};

/** A full-width row at the foot of the Library and Settings sidebar, opening upward. */
const SidebarIndicator = () => {
  const status = useSyncStatus().data;
  const view = devicesView(status);
  const [open, setOpen] = useState(false);
  const toSettings = useToSettings({ close: () => setOpen(false) });
  if (!view || !status) return null;
  const { label } = DEVICES_COPY[view];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Devices: ${label}`}
            data-devices-indicator={view}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-small text-ink-2 transition-colors duration-press hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent data-popup-open:bg-surface"
          >
            <span className="relative flex">
              <StatusIcon glyph={view} tinted={false} className="size-4" />
              <CornerDot dot={isProblem(view) ? "problem" : null} view={view} ring="ring-surface-2" />
            </span>
            <span key={view} className="animate-in fade-in-0 duration-pop ease-out">
              {label}
            </span>
          </button>
        }
      />
      <PopoverContent side="top" align="start" sideOffset={8} className="w-75">
        <DevicesPopover view={view} status={status} onSettings={toSettings} />
      </PopoverContent>
    </Popover>
  );
};

/** An icon in the reader's top bar, opening downward: sync's state and a waiting update, each with its dot. */
const ToolbarIndicator = ({ bookReturn }: { bookReturn?: () => BookReturn | undefined }) => {
  const status = useSyncStatus().data;
  const update = useUpdateStatus().data;
  const view = devicesView(status);
  const ready = update?.phase.kind === "ready" ? { version: update.phase.version, blocked: update.restartBlocked } : null;
  const [open, setOpen] = useState(false);
  const toSettings = useToSettings({ close: () => setOpen(false), bookReturn });
  const indicator = toolbarIndicator({ view, updateReady: ready !== null });
  if (!indicator) return null;
  const label = toolbarLabel({ devicesLabel: view ? DEVICES_COPY[view].label : null, updateReady: ready !== null });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ToolbarTrigger
            label={label}
            tooltip={!open}
            aria-label={view ? `Devices: ${label}` : label}
            data-devices-indicator={view ?? undefined}
            data-update-indicator={ready ? "" : undefined}
          >
            <span className="relative flex">
              <StatusIcon glyph={indicator.glyph} tinted={false} className="size-4.5" />
              <CornerDot dot={indicator.dot} view={view} ring="ring-bg" />
            </span>
          </ToolbarTrigger>
        }
      />
      <PopoverContent side="bottom" align="end" sideOffset={8} className="w-75">
        {ready && <UpdateReadySection version={ready.version} blocked={ready.blocked} />}
        {ready && view && <div aria-hidden className="-mx-2.5 h-px shrink-0 bg-line" />}
        {view && status && <DevicesPopover view={view} status={status} onSettings={toSettings} />}
      </PopoverContent>
    </Popover>
  );
};

export const DevicesIndicator = ({ placement, bookReturn }: { placement: "sidebar" | "toolbar"; bookReturn?: () => BookReturn | undefined }) =>
  placement === "sidebar" ? <SidebarIndicator /> : <ToolbarIndicator bookReturn={bookReturn} />;
