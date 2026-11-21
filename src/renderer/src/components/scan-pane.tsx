import { Maximize, X } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortcutLabel } from "../lib/keymap";
import { canPan, clampView, FIT, type ScanBox, type ScanView, wheelScale, zoomAt } from "../lib/scan-view";
import { handleKeys } from "../lib/use-keybindings";
import { IconButton, Skeleton, cx } from "./ui";

/** The image's margin inside the pane at fit. */
const MARGIN = 16;
const DOUBLE_CLICK_SCALE = 2;

/**
 * The page's original scan, beside the text. Fetched from the corpus the first time, then cached.
 * The wheel zooms toward the pointer, dragging pans a zoomed (or taller than the pane) scan,
 * double-click toggles fit and 2x. A new page starts at fit.
 */
export const ScanPane = ({ bookId, fileId, onClose }: { bookId: string; fileId: string; onClose: () => void }) => {
  const [loaded, setLoaded] = useState<{ fileId: string; ok: boolean; aspect: number } | null>(null);
  const [view, setView] = useState<ScanView>(FIT);
  const [eased, setEased] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; from: ScanView } | null>(null);
  const state = loaded?.fileId === fileId ? (loaded.ok ? "ready" : "error") : "loading";
  const src = `midad-scan://scan/${encodeURIComponent(bookId)}/${encodeURIComponent(fileId)}`;
  const box: ScanBox = { width: Math.max(room.width - 2 * MARGIN, 1), height: Math.max(room.height - 2 * MARGIN, 1), aspect: loaded?.fileId === fileId ? loaded.aspect : 1.5 };
  const latest = useRef({ view, box });
  latest.current = { view, box };

  useEffect(() => setView(FIT), [fileId]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const change = ({ next, ease }: { next: ScanView; ease: boolean }) => {
    setEased(ease);
    setView(next);
  };

  /** A point in the pane, relative to where the image's top-left corner sits at fit. */
  const pointIn = (clientX: number, clientY: number) => {
    const r = viewport.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0) - MARGIN, y: clientY - (r?.top ?? 0) - MARGIN };
  };

  // Not passive: the wheel zooms the scan and must neither scroll it nor reach the page's Ctrl+wheel text zoom.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { view: current, box: room } = latest.current;
      const scale = wheelScale({ scale: current.scale, deltaY: e.deltaY, pinch: e.ctrlKey && Math.abs(e.deltaY) < 50 });
      change({ next: zoomAt({ view: current, box: room, scale, at: pointIn(e.clientX, e.clientY) }), ease: !e.ctrlKey });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const shown = clampView({ view, box });
  const pannable = state === "ready" && canPan({ view: shown, box });
  const atFit = shown.scale === 1 && shown.y === 0;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pannable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, from: shown };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== e.pointerId) return;
    change({ next: clampView({ view: { ...start.from, x: start.from.x + e.clientX - start.x, y: start.from.y + e.clientY - start.y }, box }), ease: false });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const reset = () => change({ next: FIT, ease: true });

  // Esc on a scan already at fit is left for the page: closing things, leaving focus mode.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) =>
    handleKeys({
      event: e,
      handlers: {
        "scan.fit": () => {
          if (atFit && e.key === "Escape") return false;
          reset();
        },
      },
    });

  return (
    <section aria-label="Page scan" className="flex min-w-0 flex-1 flex-col border-l border-line bg-surface-2">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-4">
        <h2 className="text-overline font-semibold uppercase tracking-widest text-ink-3">Scan</h2>
        <span className="flex-1" />
        <span aria-live="polite" className={cx("min-w-12 text-right text-xs tabular-nums text-ink-3 transition-opacity duration-pop ease-out", atFit && "opacity-0")}>
          {Math.round(shown.scale * 100)}%
        </span>
        <IconButton icon={Maximize} label={shortcutLabel("scan.fit")} disabled={atFit} onClick={reset} />
        <IconButton icon={X} label="Hide scan" onClick={onClose} />
      </div>
      <div
        ref={viewport}
        data-scan
        tabIndex={0}
        role="img"
        aria-label="Scan of this page. Scroll to zoom, drag to move."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if (state !== "ready") return;
          const at = pointIn(e.clientX, e.clientY);
          change({ next: shown.scale > 1.01 ? FIT : zoomAt({ view: shown, box, scale: DOUBLE_CLICK_SCALE, at }), ease: true });
        }}
        onKeyDown={onKeyDown}
        className={cx(
          "relative min-h-0 flex-1 touch-none overflow-hidden outline-hidden select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
          pannable && (dragging ? "cursor-grabbing" : "cursor-grab"),
        )}
      >
        {state === "loading" && <Skeleton className="absolute inset-x-4 top-4 aspect-[2/3]" />}
        {state === "error" && (
          <p className="px-4 py-12 text-center text-sm text-ink-3">
            Couldn't load this scan. The first time you view a page's scan, Midad needs the corpus connection.
          </p>
        )}
        <img
          key={fileId}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setLoaded({ fileId, ok: true, aspect: e.currentTarget.naturalHeight / Math.max(e.currentTarget.naturalWidth, 1) })}
          onError={() => setLoaded({ fileId, ok: false, aspect: 1.5 })}
          style={{ width: box.width, translate: `${shown.x}px ${shown.y}px`, scale: String(shown.scale) }}
          className={cx(
            "absolute top-4 left-4 h-auto max-w-none origin-top-left rounded-md shadow-sm transition-opacity duration-pop ease-out",
            eased && !dragging && "transition-[opacity,translate,scale] motion-reduce:transition-opacity",
            state === "ready" ? "opacity-100" : "opacity-0",
            state === "error" && "hidden",
          )}
        />
      </div>
    </section>
  );
};

/**
 * Holds the scan pane beside the text. It opens by growing its share of the
 * width from nothing while the pane slides in from its edge, and stays mounted
 * through the reverse on close, so the text column settles instead of jumping.
 */
export const ScanSlot = ({ open, children }: { open: boolean; children: ReactNode }) => {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <div
      data-state={open ? "open" : "closed"}
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && !open) setMounted(false);
      }}
      className="group/scan flex min-w-0 grow basis-0 justify-end overflow-hidden transition-[flex-grow] duration-panel ease-sheet starting:grow-0 data-[state=closed]:grow-0 data-[state=closed]:duration-panel-exit motion-reduce:transition-none"
    >
      <div className="flex w-[50cqw] shrink-0 transition-[translate,opacity] duration-panel ease-sheet starting:translate-x-8 starting:opacity-0 group-data-[state=closed]/scan:translate-x-8 group-data-[state=closed]/scan:opacity-0 group-data-[state=closed]/scan:duration-panel-exit motion-reduce:transition-opacity motion-reduce:starting:translate-x-0 @max-2xl:w-[100cqw]">
        {children}
      </div>
    </div>
  );
};
