import { Bookmark, MessageSquareText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type BookMarks, type HighlightColor, quoteSpan } from "../../../shared/annotations";
import type { Bookmark as SavedBookmark, PageSummary } from "../../../shared/library";
import { entryIndexFor } from "../lib/contents";
import { arabicNumber, plural } from "../lib/format";
import { keys, midad, useFirstLine, usePagePreview } from "../lib/midad";
import { handleKeys, useKeybindings } from "../lib/use-keybindings";
import { DOT_GAP, markCluster, nextMarkPage, pageAtFraction, stickyMarkPage, pageFraction, previewFirstLine, thinMarks, TICK_GAP, topLevelChapters } from "../lib/scrubber";
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

/** Moving less than this (in px) between press and release counts as a click, not a drag. */
const CLICK_SLOP_PX = 3;

interface Drag {
  /** Where the pointer is along the line, from the right end; the thumb follows it exactly. */
  fraction: number;
  /** The page under the pointer, which the preview names and a release turns to. */
  page: number;
  pointerId: number;
  startX: number;
  /** Whether the pointer has moved since the press; until it does, the press is a click. */
  moved: boolean;
}

/** How long the thumb takes to settle on the page after a drag; it shows as data-settling. */
const SETTLE_MS = 120;

const inPercent = (fraction: number) => `${fraction * 100}%`;

/** The page's printed number, or failing that (front matter and the like) its position in the scans. */
const pageLabel = ({ page, number }: { page: number; number: number | null }) => ({ text: `ص ${arabicNumber(number ?? page)}`, printed: number !== null });

/**
 * The whole book as a line under the page, page 1 at the right like the book
 * itself. Ticks mark the top-level chapters, dots the pages with highlights
 * (above) and notes (below), the accent bars the bookmarked pages, the bookmark icon the last-read page, and the thumb
 * this page. Hovering near a mark previews what it marks; clicking jumps to
 * the page (to the mark's page when near one). Dragging moves the thumb with
 * the pointer, previews every page it crosses, and turns the page on release
 * (Esc cancels). As a slider it takes the arrow keys.
 */
export const PageScrubber = ({
  bookId,
  pages,
  entries,
  marks,
  position,
  markerAt,
  bookmarks = [],
  onGo,
}: {
  bookId: string;
  pages: PageSummary[];
  entries: Entry[];
  marks: BookMarks | undefined;
  position: number;
  markerAt: number | null;
  bookmarks?: SavedBookmark[];
  onGo: (position: number) => void;
}) => {
  const total = pages.length;
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ page: number; x: number; clientX: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // After a drag the thumb glides from the pointer to its page's own spot, which may not be the current page yet.
  const [settle, setSettle] = useState<{ page: number } | null>(null);
  useEffect(() => {
    if (!settle || settle.page !== position) return;
    const timer = setTimeout(() => setSettle(null), SETTLE_MS + 30);
    return () => clearTimeout(timer);
  }, [settle, position]);

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
      bookmarks: thinMarks({ marks: bookmarks, weight: () => 1, total, width, gap: DOT_GAP }),
    }),
    [marks, bookmarks, total, width],
  );

  const pointerAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return null;
    const fraction = Math.min(Math.max((r.right - clientX) / r.width, 0), 1);
    return { fraction, page: pageAtFraction({ fraction, total }), x: clientX - r.left, clientX };
  };

  // The marks drawn on the line, as the pages a pointer can snap to.
  const markedPages = useMemo(
    () => [
      ...ticks.map((t) => t.position),
      ...dots.highlights.map((h) => h.position),
      ...dots.notes.map((n) => n.position),
      ...dots.bookmarks.map((b) => b.position),
      ...(markerAt !== null && markerAt <= total ? [markerAt] : []),
    ],
    [ticks, dots, markerAt, total],
  );
  // Every marked page, thinned or not, for stepping from mark to mark with the keyboard.
  const allMarkedPages = useMemo(
    () => [
      ...topLevelChapters({ entries, total }).map((c) => c.position),
      ...(marks?.highlights ?? []).map((h) => h.position),
      ...(marks?.notes ?? []),
      ...bookmarks.map((b) => b.position),
      ...(markerAt !== null && markerAt <= total ? [markerAt] : []),
    ],
    [entries, marks, bookmarks, markerAt, total],
  );
  // The mark the pointer has snapped to; it holds against nearby marks so the card doesn't flicker between them.
  const [picked, setPicked] = useState<number | null>(null);
  // The mark reached with Shift+arrow, previewed over the thumb until the pointer or another key takes over.
  const [keyMark, setKeyMark] = useState<number | null>(null);
  const markNear = ({ clientX, current }: { clientX: number; current: number | null }) => {
    const r = bar.current?.getBoundingClientRect();
    return r ? stickyMarkPage({ pages: markedPages, offset: r.right - clientX, total, width: r.width, current }) : null;
  };

  // Set while a drag is under way; events after its release (lost capture, blur) must not treat it as cancelled.
  const dragging = useRef(false);
  const cancelDrag = () => {
    if (!drag || !dragging.current) return;
    dragging.current = false;
    bar.current?.releasePointerCapture(drag.pointerId);
    setDrag(null);
    setSettle({ page: position });
  };

  // Esc during a drag puts the thumb back; nothing else should see that key.
  useKeybindings({
    scope: "popover",
    enabled: drag !== null,
    handlers: {
      "scrubber.cancelDrag": () => {
        dragging.current = false;
        setDrag(null);
        setSettle({ page: position });
      },
    },
  });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const at = pointerAt(e.clientX);
    if (e.button !== 0 || !at) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setHover(at);
    setSettle(null);
    setKeyMark(null);
    dragging.current = true;
    setDrag({ fraction: at.fraction, page: at.page, pointerId: e.pointerId, startX: e.clientX, moved: false });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const at = pointerAt(e.clientX);
    if (!at) return;
    setHover(at);
    setKeyMark(null);
    if (drag) {
      const moved = drag.moved || Math.abs(e.clientX - drag.startX) >= CLICK_SLOP_PX;
      setDrag({ ...drag, fraction: at.fraction, page: at.page, moved });
      if (moved) setPicked(null);
    } else setPicked((current) => markNear({ clientX: e.clientX, current }));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || !dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // The last move before the release may not have rendered yet; the release point is where the thumb is headed.
    const clicked = !drag.moved && Math.abs(e.clientX - drag.startX) < CLICK_SLOP_PX;
    const page = (clicked ? markNear({ clientX: e.clientX, current: picked }) : null) ?? pointerAt(e.clientX)?.page ?? drag.page;
    setDrag(null);
    setSettle({ page });
    onGo(page);
  };

  // Shift+arrow steps from mark to mark; right to left, so the next one is to the left.
  const stepMark = (direction: 1 | -1) => {
    const to = nextMarkPage({ pages: allMarkedPages, from: position, direction });
    if (to === null) return;
    setKeyMark(to);
    onGo(to);
  };
  const goTo = (page: number) => onGo(Math.min(Math.max(page, 1), total));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (handleKeys({ event: e, handlers: { "scrubber.nextMark": () => stepMark(1), "scrubber.previousMark": () => stepMark(-1) } })) return;
    setKeyMark(null);
    // Right to left: the next page is to the left, as with page turns.
    handleKeys({
      event: e,
      handlers: {
        "scrubber.next": () => goTo(position + 1),
        "scrubber.previous": () => goTo(position - 1),
        "scrubber.forward": () => goTo(position + 10),
        "scrubber.back": () => goTo(position - 10),
        "scrubber.first": () => goTo(1),
        "scrubber.last": () => goTo(total),
      },
    });
  };

  const thumbFraction = drag ? drag.fraction : pageFraction({ position: settle?.page ?? position, total });
  const previewPage = drag?.moved ? drag.page : null;
  const pointed = hover && picked !== null && markedPages.includes(picked) ? picked : null;
  const hoveredMark = drag?.moved ? null : (pointed ?? keyMark);
  const numberOf = (page: number) => pages[page - 1]?.number ?? null;
  // A key-stepped mark previews just its page; a pointed one, the marks crowded around it too.
  const cluster = hoveredMark === null ? [] : hoveredMark === pointed ? markCluster({ pages: allMarkedPages, drawn: markedPages, around: hoveredMark, total, width }) : [hoveredMark];
  const markedPage = (page: number): MarkedPage => ({
    page,
    number: numberOf(page),
    contents: entries.filter((e) => e.position === page).map((e) => e.text),
    highlights: (marks?.highlights ?? []).filter((h) => h.position === page).map((h) => h.color),
    hasNotes: (marks?.notes ?? []).includes(page),
    bookmark: bookmarks.find((b) => b.position === page) ?? null,
    lastRead: page === markerAt,
  });
  const chapterOf = (page: number) => entries[entryIndexFor(entries, page)]?.text ?? null;
  const at = (page: number) => inPercent(pageFraction({ position: page, total }));

  return (
    <div className="relative h-full">
      <PagePreview
        bookId={bookId}
        page={previewPage}
        number={previewPage === null ? null : (pages[previewPage - 1]?.number ?? null)}
        chapter={previewPage === null ? null : chapterOf(previewPage)}
        x={clampPreview({ x: hover?.x ?? 0, width })}
      />
      <MarkPreview
        bookId={bookId}
        cluster={cluster.map(markedPage)}
        x={clampPreview({ x: hoveredMark === null ? 0 : width - pageFraction({ position: hoveredMark, total }) * width, width })}
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
        aria-valuetext={[numberOf(position) === null ? `Position ${position} of ${total}` : `Page ${numberOf(position)}`, chapterOf(position)].filter(Boolean).join(", ")}
        data-dragging={drag ? "" : undefined}
        data-settling={settle ? "" : undefined}
        data-key-mark={keyMark !== null ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={cancelDrag}
        onPointerLeave={() => {
          if (drag) return;
          setHover(null);
          setPicked(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          cancelDrag();
          setKeyMark(null);
        }}
        className="group/scrub absolute inset-x-0 bottom-5 h-8 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-accent"
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
          <span key={`h${h.position}`} data-mark="highlight" style={{ right: at(h.position) }} className={cx("absolute top-0.5 size-1.25 translate-x-1/2 rounded-full", MARK_BG[h.color])} />
        ))}
        {dots.notes.map((n) => (
          <span key={`n${n.position}`} data-mark="note" style={{ right: at(n.position) }} className="absolute bottom-0 size-1.25 translate-x-1/2 rounded-full border-[1.5px] border-accent" />
        ))}
        {dots.bookmarks.map((b) => (
          <span
            key={`b${b.position}`}
            data-bookmark-tick={b.position}
            style={{ right: at(b.position) }}
            className="absolute top-2.25 h-3.5 w-0.75 translate-x-1/2 rounded-full bg-accent transition-[scale,opacity] duration-sweep ease-out starting:scale-y-0 starting:opacity-0 group-hover/scrub:scale-y-125 motion-reduce:transition-opacity motion-reduce:starting:scale-y-100"
          />
        ))}
        {markerAt !== null && markerAt <= total && (
          <Bookmark aria-hidden data-mark="last-read" style={{ right: at(markerAt) }} className="absolute -top-3.5 size-3 translate-x-1/2 text-accent" />
        )}
        {drag && <span style={{ right: at(position) }} className="absolute top-2.5 size-3 translate-x-1/2 rounded-full border-2 border-accent opacity-40" />}
        <div
          style={{ translate: `${-thumbFraction * 100}% 0` }}
          className="pointer-events-none absolute inset-0 transition-[translate] duration-slide ease-move group-data-settling/scrub:duration-120 group-data-settling/scrub:ease-out group-data-dragging/scrub:transition-none motion-reduce:transition-none"
        >
          {(() => {
            const label = pageLabel({ page: position, number: numberOf(position) });
            return (
              <span
                aria-hidden
                data-page-label
                className={cx(
                  "ar absolute -top-5 right-0 translate-x-1/2 text-sm leading-none whitespace-nowrap transition-[opacity,translate] duration-pop ease-out motion-reduce:transition-opacity group-hover/scrub:opacity-0 group-hover/scrub:duration-pop-exit group-data-dragging/scrub:opacity-0 group-data-key-mark/scrub:opacity-0",
                  markerAt === position && "-translate-y-3",
                  label.printed ? "text-ink-2" : "text-ink-3",
                )}
              >
                {label.text}
              </span>
            );
          })()}
          <span
            data-thumb
            className="absolute top-2.5 right-0 size-3 translate-x-1/2 rounded-full bg-accent ring-2 ring-bg transition-transform duration-pop-exit ease-out group-hover/scrub:scale-115 group-hover/scrub:duration-pop group-data-dragging/scrub:scale-115"
          />
        </div>
      </div>
    </div>
  );
};

const clampPreview = ({ x, width }: { x: number; width: number }) =>
  Math.min(Math.max(x, PREVIEW_HALF_WIDTH), Math.max(width - PREVIEW_HALF_WIDTH, PREVIEW_HALF_WIDTH));

const PREVIEW_CARD =
  "pointer-events-none absolute bottom-17 z-10 flex w-70 -translate-x-1/2 origin-bottom flex-col gap-1.5 rounded-xl bg-surface-3 px-3.5 py-3 shadow-float transition-[opacity,scale] duration-pop ease-out data-[state=closed]:scale-96 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity";

/** How many notes or highlights a mark preview lists before summing up the rest. */
const MARK_ITEMS = 2;

const shorten = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** What is marked on one page, as the mark preview lists it. */
export interface MarkedPage {
  page: number;
  number: number | null;
  contents: string[];
  highlights: HighlightColor[];
  hasNotes: boolean;
  bookmark: SavedBookmark | null;
  lastRead: boolean;
}

/** One page's marks in the preview. Notes and highlights load once `load` is set. */
const MarkSection = ({ bookId, marked, load, primary }: { bookId: string; marked: MarkedPage; load: boolean; primary: boolean }) => {
  const enabled = load && (marked.hasNotes || marked.highlights.length > 0);
  const annotations = useQuery({
    queryKey: keys.annotations(bookId, marked.page),
    queryFn: () => midad["annotations.list"]({ bookId, position: marked.page }),
    enabled,
    staleTime: 60_000,
  });
  const stored = usePagePreview({ bookId, position: marked.page, enabled: enabled && marked.highlights.length > 0 });
  const quotes = (annotations.data?.highlights ?? []).flatMap((h) => {
    if (!stored.data) return [];
    try {
      return [{ color: h.color, text: quoteSpan({ page: stored.data.page, span: h.span }) }];
    } catch {
      return [];
    }
  });
  const notes = annotations.data?.notes ?? [];
  const label = pageLabel(marked);
  return (
    <section data-mark-page={marked.page} className={cx("flex flex-col gap-1.5", !primary && "border-t border-line pt-2")}>
      <span dir="rtl" className={cx("ar text-right font-bold", primary ? "text-ar-body leading-7" : "text-ar-small leading-6", label.printed ? "text-ink" : "text-ink-3")}>
        {label.text}
      </span>
      <ul className="flex flex-col gap-1.5">
        {marked.contents.map((heading, i) => (
          <li key={`c${i}`} dir="rtl" className="ar truncate text-right text-ar-small text-accent">
            {heading}
          </li>
        ))}
        {marked.lastRead && (
          <li className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Bookmark aria-hidden className="size-3.5 shrink-0" />
            Last read
          </li>
        )}
        {marked.bookmark && (
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-3.5 w-0.75 shrink-0 rounded-full bg-accent" />
            {marked.bookmark.name ? (
              <span dir="rtl" className="ar flex-1 truncate text-right text-ar-small text-ink">
                {marked.bookmark.name}
              </span>
            ) : (
              <span className="text-xs text-ink-2">Bookmark</span>
            )}
          </li>
        )}
        {marked.highlights.length > 0 &&
          (quotes.length > 0 ? (
            <>
              {quotes.slice(0, MARK_ITEMS).map((q, i) => (
                <li key={`h${i}`} className="flex items-center gap-2">
                  <span aria-hidden className={cx("size-2 shrink-0 rounded-full", MARK_BG[q.color])} />
                  <span dir="rtl" className="ar flex-1 truncate text-right text-ar-small text-ink-2">
                    {shorten(q.text)}
                  </span>
                </li>
              ))}
              {quotes.length > MARK_ITEMS && <li className="text-xs text-ink-3">{plural({ count: quotes.length - MARK_ITEMS, one: "more highlight", many: "more highlights" })}</li>}
            </>
          ) : (
            <li className="flex items-center gap-2">
              <span aria-hidden className={cx("size-2 shrink-0 rounded-full", MARK_BG[marked.highlights[0] ?? "yellow"])} />
              <Skeleton className="h-3 w-40 opacity-60" />
            </li>
          ))}
        {marked.hasNotes &&
          (annotations.data ? (
            <>
              {notes.slice(0, MARK_ITEMS).map((n) => (
                <li key={n.id} className="flex items-start gap-2">
                  <MessageSquareText aria-hidden className="mt-1 size-3.5 shrink-0 text-accent" />
                  <span dir="auto" className="line-clamp-2 flex-1 text-xs leading-5 text-ink-2">
                    {shorten(n.body, 140)}
                  </span>
                </li>
              ))}
              {notes.length > MARK_ITEMS && <li className="text-xs text-ink-3">{plural({ count: notes.length - MARK_ITEMS, one: "more note", many: "more notes" })}</li>}
            </>
          ) : (
            <li className="flex items-center gap-2">
              <MessageSquareText aria-hidden className="size-3.5 shrink-0 text-accent" />
              <Skeleton className="h-3 w-40 opacity-60" />
            </li>
          ))}
      </ul>
    </section>
  );
};

/**
 * The card above a mark the pointer is near (or the keyboard stepped to): the
 * page and everything marked on it. Where marks crowd too close to point at
 * one, the pages beside it follow in the same card.
 */
const MarkPreview = ({ bookId, cluster, x }: { bookId: string; cluster: MarkedPage[]; x: number }) => {
  // Keep the last pages shown so the card can fade out with its content.
  const last = useRef<MarkedPage[]>([]);
  if (cluster.length > 0) last.current = cluster;
  const shown = last.current;
  const open = cluster.length > 0;
  // And where it was, so it fades out in place rather than at the bar's end.
  const lastX = useRef(x);
  if (open) lastX.current = x;
  const key = cluster.map((m) => m.page).join(",");
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => setSettled(key), FIRST_LINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return (
    <div aria-hidden data-mark-preview data-state={open ? "open" : "closed"} style={{ left: lastX.current }} className={cx(PREVIEW_CARD, "max-h-96 overflow-hidden")}>
      {shown.map((marked, i) => (
        <MarkSection key={marked.page} bookId={bookId} marked={marked} load={open && settled === key} primary={i === 0} />
      ))}
    </div>
  );
};

/** The card above the bar while dragging: the page's printed number, chapter or section, and first line. */
const PagePreview = ({
  bookId,
  page,
  number,
  chapter,
  x,
}: {
  bookId: string;
  page: number | null;
  /** The printed page number, when the page has one. */
  number: number | null;
  chapter: string | null;
  x: number;
}) => {
  // Keep the last page shown so the card can fade out with its content.
  const last = useRef<{ page: number; number: number | null; chapter: string | null } | null>(null);
  if (page !== null) last.current = { page, number, chapter };
  const shown = last.current;
  const lastX = useRef(x);
  if (page !== null) lastX.current = x;
  const [settled, setSettled] = useState<number | null>(null);
  useEffect(() => {
    if (page === null) return;
    const timer = setTimeout(() => setSettled(page), FIRST_LINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [page]);
  const line = useFirstLine({ bookId, position: shown?.page ?? 1, enabled: shown !== null && settled === shown.page });
  const repeatsHeading = line.data != null && previewFirstLine({ chapter: shown?.chapter ?? null, firstLine: line.data }) === null;
  return (
    <div
      aria-hidden
      data-state={page === null ? "closed" : "open"}
      style={{ left: lastX.current }}
      data-page-preview
      className={PREVIEW_CARD}
    >
      {shown && (
        <>
          {(() => {
            const label = pageLabel(shown);
            return (
              <span dir="rtl" className={cx("ar text-right text-ar-display font-bold leading-8", label.printed ? "text-ink" : "text-ink-3")}>
                {label.text}
              </span>
            );
          })()}
          {shown.chapter && <span dir="rtl" className="ar truncate text-right text-ar-small text-accent">{shown.chapter}</span>}
          {!repeatsHeading && (
            <div dir="rtl" className="ar h-7 truncate text-ar-small leading-7 text-ink-2">
              {line.data !== undefined ? line.data : <Skeleton className="mt-2 h-3 w-40 opacity-60" />}
            </div>
          )}
        </>
      )}
    </div>
  );
};
