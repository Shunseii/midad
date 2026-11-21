import { Bookmark } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookMarks } from "../../../shared/annotations";
import type { PageSummary } from "../../../shared/library";
import { entryIndexFor } from "../lib/contents";
import { arabicNumber } from "../lib/format";
import { useFirstLine } from "../lib/midad";
import { DOT_GAP, pageAtFraction, pageFraction, thinMarks, TICK_GAP, topLevelChapters } from "../lib/scrubber";
import { MARK_BG } from "./page-view";
import { cx, Skeleton } from "./ui";

/** Hovering a page this long fetches its first line, so a quick sweep along the bar doesn't fetch every page it crosses. */
const FIRST_LINE_DELAY_MS = 120;
/** Matches the preview card's w-70, to keep it inside the bar's ends. */
const PREVIEW_HALF_WIDTH = 140;

interface Entry {
  position: number;
  level: number;
  text: string;
}

interface Drag {
  page: number;
  pointerId: number;
}

const inPercent = (fraction: number) => `${fraction * 100}%`;

const pageCount = (n: number) => n.toLocaleString("en");

/**
 * The whole book as a line under the page, page 1 at the right like the book
 * itself. Ticks mark the top-level chapters, dots the pages with highlights
 * (above) and notes (below), the bookmark the last-read page, and the thumb
 * this page. Hovering previews a page; clicking jumps to it; dragging turns
 * the page on release (Esc cancels). As a slider it takes the arrow keys.
 */
export const PageScrubber = ({
  bookId,
  pages,
  entries,
  marks,
  position,
  markerAt,
  onGo,
}: {
  bookId: string;
  pages: PageSummary[];
  entries: Entry[];
  marks: BookMarks | undefined;
  position: number;
  markerAt: number | null;
  onGo: (position: number) => void;
}) => {
  const total = pages.length;
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ page: number; x: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ticks = useMemo(
    () => thinMarks({ marks: topLevelChapters({ entries, total }), weight: (c) => c.pages, total, width, gap: TICK_GAP }),
    [entries, total, width],
  );
  const dots = useMemo(
    () => ({
      highlights: thinMarks({ marks: marks?.highlights ?? [], weight: () => 1, total, width, gap: DOT_GAP }),
      notes: thinMarks({ marks: (marks?.notes ?? []).map((p) => ({ position: p })), weight: () => 1, total, width, gap: DOT_GAP }),
    }),
    [marks, total, width],
  );

  const pointerAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return null;
    return { page: pageAtFraction({ fraction: (r.right - clientX) / r.width, total }), x: clientX - r.left };
  };

  const cancelDrag = () => {
    if (drag) bar.current?.releasePointerCapture(drag.pointerId);
    setDrag(null);
  };

  // Esc during a drag puts the thumb back; nothing else should see that key.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setDrag(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [drag]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const at = pointerAt(e.clientX);
    if (e.button !== 0 || !at) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setHover(at);
    setDrag({ page: at.page, pointerId: e.pointerId });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const at = pointerAt(e.clientX);
    if (!at) return;
    setHover(at);
    if (drag) setDrag({ ...drag, page: at.page });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    onGo(drag.page);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Right to left: the next page is to the left, as with page turns.
    const steps: Record<string, number> = { ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1, PageDown: 10, PageUp: -10 };
    const to = e.key === "Home" ? 1 : e.key === "End" ? total : steps[e.key] !== undefined ? position + (steps[e.key] ?? 0) : null;
    if (to === null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onGo(Math.min(Math.max(to, 1), total));
  };

  const shownPage = drag?.page ?? position;
  const previewPage = drag?.page ?? hover?.page ?? null;
  const chapterOf = (page: number) => entries[entryIndexFor(entries, page)]?.text ?? null;
  const at = (page: number) => inPercent(pageFraction({ position: page, total }));

  return (
    <div className="relative h-full">
      <PagePreview
        bookId={bookId}
        page={previewPage}
        total={total}
        folio={previewPage === null ? null : (pages[previewPage - 1]?.number ?? previewPage)}
        chapter={previewPage === null ? null : chapterOf(previewPage)}
        x={Math.min(Math.max(hover?.x ?? 0, PREVIEW_HALF_WIDTH), Math.max(width - PREVIEW_HALF_WIDTH, PREVIEW_HALF_WIDTH))}
      />
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        dir="rtl"
        aria-label="Page"
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={position}
        aria-valuetext={[`Page ${position} of ${pageCount(total)}`, chapterOf(position)].filter(Boolean).join(", ")}
        data-dragging={drag ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={() => drag && setDrag(null)}
        onPointerLeave={() => !drag && setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={cancelDrag}
        className="group/scrub peer absolute inset-x-0 bottom-5 h-8 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-accent"
      >
        <div className="absolute inset-x-0 top-3.5 h-1 origin-center rounded-full bg-line transition-transform duration-pop-exit ease-out group-hover/scrub:scale-y-200 group-hover/scrub:duration-pop group-data-dragging/scrub:scale-y-200 motion-reduce:transition-none">
          <div
            style={{ transform: `scaleX(${pageFraction({ position, total })})` }}
            className="absolute inset-0 origin-right rounded-full bg-accent/35 transition-transform duration-slide ease-move motion-reduce:transition-none"
          />
        </div>
        {ticks.map((t) => (
          <span
            key={t.position}
            data-tick={t.position}
            style={{ right: at(t.position) }}
            className="absolute top-2.75 h-2.5 w-px translate-x-1/2 bg-ink-3/50 transition-transform duration-pop-exit ease-out group-hover/scrub:scale-y-160 group-hover/scrub:duration-pop motion-reduce:transition-none"
          />
        ))}
        {dots.highlights.map((h) => (
          <span key={`h${h.position}`} style={{ right: at(h.position) }} className={cx("absolute top-0.5 size-1.25 translate-x-1/2 rounded-full", MARK_BG[h.color])} />
        ))}
        {dots.notes.map((n) => (
          <span key={`n${n.position}`} style={{ right: at(n.position) }} className="absolute bottom-0 size-1.25 translate-x-1/2 rounded-full border-[1.5px] border-accent" />
        ))}
        {markerAt !== null && markerAt <= total && (
          <Bookmark aria-hidden style={{ right: at(markerAt) }} className="absolute -top-3.5 size-3 translate-x-1/2 text-accent" />
        )}
        {drag && <span style={{ right: at(position) }} className="absolute top-2.5 size-3 translate-x-1/2 rounded-full border-2 border-accent opacity-40" />}
        <div
          style={{ translate: `${-pageFraction({ position: shownPage, total }) * 100}% 0` }}
          className="pointer-events-none absolute inset-0 transition-[translate] duration-slide ease-move group-data-dragging/scrub:transition-none motion-reduce:transition-none"
        >
          <span
            data-thumb
            className="absolute top-2.5 right-0 size-3 translate-x-1/2 rounded-full bg-accent ring-2 ring-bg transition-transform duration-pop-exit ease-out group-hover/scrub:scale-115 group-hover/scrub:duration-pop group-data-dragging/scrub:scale-115"
          />
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-17 left-1/2 -translate-x-1/2 rounded-full bg-surface-2 px-2.5 py-1 text-xs whitespace-nowrap text-ink-3 opacity-0 transition-opacity duration-pop-exit ease-out peer-focus-visible:opacity-100 peer-focus-visible:duration-pop peer-hover:opacity-0!">
        ← → a page · PgUp PgDn ten · Home End
      </p>
    </div>
  );
};

/** The card above the bar while the pointer is on it: the page's printed number, chapter or section, and first line. */
const PagePreview = ({
  bookId,
  page,
  total,
  folio,
  chapter,
  x,
}: {
  bookId: string;
  page: number | null;
  total: number;
  folio: number | null;
  chapter: string | null;
  x: number;
}) => {
  // Keep the last page shown so the card can fade out with its content.
  const last = useRef<{ page: number; folio: number | null; chapter: string | null } | null>(null);
  if (page !== null) last.current = { page, folio, chapter };
  const shown = last.current;
  const [settled, setSettled] = useState<number | null>(null);
  useEffect(() => {
    if (page === null) return;
    const timer = setTimeout(() => setSettled(page), FIRST_LINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [page]);
  const line = useFirstLine({ bookId, position: shown?.page ?? 1, enabled: shown !== null && settled === shown.page });
  return (
    <div
      aria-hidden
      data-state={page === null ? "closed" : "open"}
      style={{ left: x }}
      className="pointer-events-none absolute bottom-17 z-10 flex w-70 -translate-x-1/2 origin-bottom flex-col gap-1.5 rounded-xl bg-surface-3 px-3.5 py-3 shadow-float transition-[opacity,scale] duration-pop ease-out data-[state=closed]:scale-96 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity"
    >
      {shown && (
        <>
          <div dir="rtl" className="flex items-baseline justify-between">
            <span className="ar text-ar-display font-bold leading-8 text-ink">{arabicNumber(shown.folio ?? shown.page)}</span>
            <span dir="ltr" className="text-xs tabular-nums text-ink-3">
              {pageCount(shown.page)} of {pageCount(total)}
            </span>
          </div>
          {shown.chapter && <span dir="rtl" className="ar truncate text-right text-ar-small text-accent">{shown.chapter}</span>}
          <div dir="rtl" className="ar h-7 truncate text-ar-small leading-7 text-ink-2">
            {line.data !== undefined ? line.data : <Skeleton className="mt-2 h-3 w-40 opacity-60" />}
          </div>
        </>
      )}
    </div>
  );
};
