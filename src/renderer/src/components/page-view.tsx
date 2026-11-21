import { Bookmark, BookmarkPlus, MessageSquareText } from "lucide-react";
import { type CSSProperties, createContext, Fragment, type ReactNode, type MouseEvent as ReactMouseEvent, type RefObject, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  type Highlight,
  type HighlightColor,
  type LetterRef,
  type Note,
  type PageAnnotations,
  type Part,
  type Span,
  spanContains,
  tokenize,
  type WordRef,
} from "../../../shared/annotations";
import { stripHarakat } from "../../../shared/arabic";
import { displayMarks, inContext, isMark, lettersOf } from "../../../shared/harakat";
import type { StoredPage } from "../../../shared/library";
import type { Gloss } from "../../../shared/page";
import type { HighlightStyle, NoteIcons, PageWidth } from "../lib/appearance";
import { arabicNumber } from "../lib/format";
import { footnotesByMarker, splitFootnoteRef } from "../lib/footnotes";
import { type Sweep, sweepOrder, sweepTiming } from "../lib/sweep";
import { cx } from "./ui";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export const MARK_BG: Record<HighlightColor, string> = {
  yellow: "bg-mark-1",
  green: "bg-mark-2",
  pink: "bg-mark-3",
  blue: "bg-mark-4",
};

/** Highlighted text: a band of the colour under the letters, or behind the whole word (see .mark-band). */
export const MARK_BAND: Record<HighlightColor, string> = {
  yellow: "mark-band mark-yellow",
  green: "mark-band mark-green",
  pink: "mark-band mark-pink",
  blue: "mark-band mark-blue",
};

/** The page's footnotes by marker, for the superscript references in the text to peek at. */
const Footnotes = createContext<Map<string, string>>(new Map());

/**
 * A footnote reference such as (١), set as a superscript that shows the footnote on hover.
 * Inline-block: as a plain inline child it lifts the word's own box above its neighbours',
 * and the highlight band and reveal tint drawn from that box would step out of line.
 */
const FootnoteRef = ({ marker }: { marker: string }) => {
  const footnote = useContext(Footnotes).get(marker);
  const sup = <sup className="mx-px inline-block cursor-default align-super text-[0.6em] font-bold text-accent transition-colors duration-press hover:text-ink">{marker}</sup>;
  if (!footnote) return <span data-sel-box>{sup}</span>;
  return (
    <span data-sel-box>
      <Tooltip>
        <TooltipTrigger render={sup} />
        <TooltipContent side="bottom" sideOffset={6} arrow={false} className="block w-max max-w-96 rounded-xl bg-surface-3 px-3.5 py-2.5 text-ink shadow-float">
          <span dir="rtl" className="ar block text-right text-ar-small text-ink-2">
            ({marker}) {footnote}
          </span>
        </TooltipContent>
      </Tooltip>
    </span>
  );
};

/**
 * The browser paints a selection only behind text at the text's own size, which leaves holes
 * at the small inline-block footnote refs and at the gloss rings. Their full-height boxes
 * (data-sel-box) take the selection colour instead while the selection covers them.
 */
/** Whether a selection runs to the end of the glossed word a ring box follows, so the ring goes with it. */
const endsWordBefore = ({ range, box }: { range: Range; box: HTMLElement }) => {
  const word = box.previousElementSibling;
  return word instanceof HTMLElement && word.dataset.w !== undefined && range.intersectsNode(word) && range.comparePoint(word, word.childNodes.length) === 0;
};

const useSelectionBoxes = (root: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const update = () => {
      const el = root.current;
      if (!el) return;
      const selection = window.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      for (const box of el.querySelectorAll<HTMLElement>("[data-sel-box]")) {
        box.toggleAttribute("data-in-selection", !!range && (range.intersectsNode(box) || endsWordBefore({ range, box })));
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [root]);
};

/**
 * Plain word text with any footnote reference in it raised as a superscript. With the
 * markers hidden the reference takes no room at all, but stays in the text for copying.
 */
const withFootnoteRefs = ({ text, shown }: { text: string; shown: boolean }): ReactNode => {
  const ref = splitFootnoteRef(text);
  if (!ref) return text;
  const marker = shown ? <FootnoteRef key="ref" marker={ref.marker} /> : <span key="ref" className="sr-only">{ref.marker}</span>;
  return [ref.before, marker, withFootnoteRefs({ text: ref.after, shown })];
};

/** Overlapping glosses on a line, merged so each base gets one marker. */
const glossRuns = (glosses: Gloss[]): { from: number; to: number; texts: string[] }[] =>
  [...glosses]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .reduce<{ from: number; to: number; texts: string[] }[]>((runs, g) => {
      const last = runs.at(-1);
      if (last && g.from <= last.to) {
        last.to = Math.max(last.to, g.to);
        last.texts.push(g.text);
      } else runs.push({ from: g.from, to: g.to, texts: [g.text] });
      return runs;
    }, []);

const stopPageHandlers = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * The marker after an interlinear gloss's base: a small drawn ring. The base words stay
 * undecorated, so notes and highlights keep the text to themselves; only the ring opens the
 * gloss (hover, click or Enter), above the line where an interlinear gloss is written.
 * The ring is an inline-block inside an inline box that takes its word's highlight, sweep and
 * note tint, so they run on under it level.
 */
const GlossMarker = ({
  texts,
  showHarakat,
  band,
  onActive,
}: {
  texts: string[];
  showHarakat: boolean;
  band: { className: string; style?: CSSProperties };
  /** Hovered, focused or open: the base words take the gloss tint. */
  onActive: (active: boolean) => void;
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = open || hovered || focused;
  const report = useRef(onActive);
  report.current = onActive;
  useEffect(() => report.current(active), [active]);
  const shown = texts.map((t) => (showHarakat ? t : stripHarakat(t))).join("\n");
  return (
    <span
      data-sel-box
      className={band.className}
      style={band.style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          // Not while the reader drags a selection across it.
          const pressed = details.event instanceof MouseEvent && details.event.buttons !== 0 && details.event.type !== "click";
          if (next && pressed) return;
          setOpen(next);
        }}
      >
        <PopoverTrigger
          openOnHover
          delay={150}
          closeDelay={200}
          nativeButton={false}
          aria-label="Interlinear gloss"
          aria-describedby={id}
          onClick={stopPageHandlers}
          render={<span data-gloss className="gloss-ring" />}
        >
          <span id={id} hidden>
            {shown}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={6}
          initialFocus={false}
          onMouseDown={stopPageHandlers}
          onMouseUp={stopPageHandlers}
          onClick={stopPageHandlers}
          className="w-max max-w-96 gap-0 bg-surface-3 p-0 text-ink"
        >
          <div dir="rtl" className="gloss-scroll ar max-h-48 overflow-y-auto overscroll-contain px-3.5 py-2.5 text-right text-ar-small whitespace-pre-line text-ink-2">
            {shown}
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
};

export interface WordTarget {
  part: Part;
  ref: WordRef;
  element: HTMLElement;
  /** The letter under the pointer, when known. */
  letter: number | null;
}

export interface Display {
  showHarakat: boolean;
  showMine: boolean;
  lineNumbers: boolean;
  /** How much larger than normal the page text is drawn; 1 is the normal size. */
  textScale: number;
  /** The letter the reader is typing harakat on. */
  target: LetterRef | null;
  /** The rings after interlinear glosses' bases. */
  glossMarkers: boolean;
  /** The superscript footnote references in the text. */
  hashiyaMarkers: boolean;
  noteIcons: NoteIcons;
}

/** The style that times one word's (or the gap after it's) part of the sweep. */
const sweepStyle = ({ sweep, at }: { sweep: Sweep; at: number }): CSSProperties => {
  const { delay, duration } = sweepTiming({ count: sweep.count, at });
  return { "--sweep-delay": `${delay}ms`, "--sweep-duration": `${duration}ms` } as CSSProperties;
};

interface LineProps {
  part: Part;
  line: number;
  text: string;
  /** The page's interlinear glosses; the line picks out its own. */
  glosses: Gloss[];
  annotations: PageAnnotations;
  sweep: Sweep | null;
  display: Display;
  /** Notes whose words are tinted, while their peek or margin mark is hovered. */
  tinted: ReadonlySet<string>;
  /** Focus mode fades the note icons on the words, like the margin marks. */
  dimNoteIcons: boolean;
  onWordHover: (target: WordTarget, note: Note | null) => void;
  onWordClick: (target: WordTarget, highlight: Highlight | null) => void;
}

/** The newest highlight wins where two overlap. */
const highlightAt = (highlights: Highlight[], part: Part, ref: WordRef) =>
  highlights.reduce<Highlight | null>(
    (found, h) => (spanContains({ span: h.span, part, ref }) && (!found || h.createdAt > found.createdAt) ? h : found),
    null,
  );

const noteAt = (notes: Note[], part: Part, ref: WordRef) =>
  notes.find((n) => spanContains({ span: n.span, part, ref })) ?? null;

const tintedAt = ({ notes, tinted, part, ref }: { notes: Note[]; tinted: ReadonlySet<string>; part: Part; ref: WordRef }) =>
  notes.filter((n) => tinted.has(n.id) && spanContains({ span: n.span, part, ref }));

/** A short tick under the targeted letter, below where a kasra sits. */
const TARGET_TICK = "pointer-events-none absolute inset-x-px bottom-1 h-0.5 select-none rounded-full bg-accent";

/**
 * A word's letters with the reader's marks drawn in their own colour. Letters
 * without anything special stay in one text run so the word shapes normally.
 */
const WordText = ({ text, mine, display, targetLetter }: { text: string; mine: Map<number, string>; display: Display; targetLetter: number | null }) => {
  const { showHarakat, showMine, hashiyaMarkers } = display;
  const showingMine = showHarakat && showMine && mine.size > 0;
  if (!showingMine && targetLetter === null) return withFootnoteRefs({ text: showHarakat ? text : stripHarakat(text), shown: hashiyaMarkers });

  const nodes: ReactNode[] = [];
  let run = "";
  const flush = (key: string) => {
    if (run) nodes.push(<Fragment key={key}>{withFootnoteRefs({ text: run, shown: hashiyaMarkers })}</Fragment>);
    run = "";
  };
  const letters = lettersOf(text);
  letters.forEach((l, i) => {
    const letter = i + 1;
    const marks = displayMarks({ corpus: showHarakat ? l.marks : "", mine: showingMine ? (mine.get(letter) ?? "") : "" });
    if (!marks.mine && letter !== targetLetter) {
      run += l.base + marks.corpus;
      return;
    }
    flush(`run-${letter}`);
    // Chromium paints a mark in its letter's colour, so the reader's marks are drawn
    // on a red copy of the letter underneath; the letter itself covers the red base.
    const { before, after } = inContext({ letters, index: i });
    nodes.push(
      <span key={letter} className={cx("relative isolate", letter === targetLetter && "text-accent")}>
        {letter === targetLetter && <span data-overlay aria-hidden className={TARGET_TICK} />}
        {l.base}
        {marks.corpus}
        {marks.mine && (
          <span data-overlay aria-hidden className="pointer-events-none absolute right-0 top-0 -z-10 select-none leading-[normal] text-ink-added">
            {before}
            {l.base}
            {marks.corpus}
            {marks.mine}
            {after}
          </span>
        )}
      </span>,
    );
  });
  flush("run-end");
  return nodes;
};

/**
 * A small note icon raised past the end of a note's last word, like a superscript. It is an
 * overlay: it takes no room, so line breaks and justification stay as they were, and it is
 * left out of hit tests, selection and copying.
 */
const NoteIcon = ({ active, dim }: { active: boolean; dim: boolean }) => (
  <MessageSquareText
    data-overlay
    aria-hidden
    className={cx(
      "pointer-events-none absolute -right-0.5 top-0 size-2.5 translate-x-full -translate-y-1/2 select-none transition-[color,opacity] duration-press ease-out",
      active ? "text-accent" : "text-accent/55",
      dim && !active && "opacity-30",
    )}
  />
);

const Line = ({ part, line, text, glosses, annotations, sweep, display, tinted, dimNoteIcons, onWordHover, onWordClick }: LineProps) => {
  const sweepAt = (h: Highlight | null, ref: WordRef) => (sweep && h?.id === sweep.id ? sweep.order.get(`${part}:${ref.line}:${ref.word}`) : undefined);
  const tokens = tokenize(text);
  const wordAt = (i: number) => {
    const t = tokens[i];
    return t?.kind === "word" ? { line, word: t.word } : null;
  };

  const runs = display.glossMarkers ? glossRuns(glosses.filter((g) => g.part === part && g.line === line)) : [];
  const [activeGloss, setActiveGloss] = useState<number | null>(null);
  const glossActiveFor = (to: number) => (active: boolean) => setActiveGloss((current) => (active ? to : current === to ? null : current));
  const runOf = (word: number) => runs.find((r) => r.from <= word && word <= r.to) ?? null;
  const glossClasses = (run: { to: number } | null) => run && cx("gloss-span", activeGloss === run.to && "gloss-tint");
  const tintOf = (ref: WordRef) => tintedAt({ notes: annotations.notes, tinted, part, ref });

  return tokens.map((token, i) => {
    if (token.kind === "space") {
      const before = wordAt(i - 1);
      const after = wordAt(i + 1);
      const shared =
        before && after ? highlightAt(annotations.highlights, part, before) : null;
      const joins = shared && after && spanContains({ span: shared.span, part, ref: after });
      const at = joins && before ? sweepAt(shared, before) : undefined;
      const tintBefore = before ? tintOf(before) : [];
      const tintJoins = after !== null && tintBefore.some((n) => spanContains({ span: n.span, part, ref: after }));
      const glossRun = before && after ? runOf(before.word) : null;
      const glossJoins = glossRun && after && after.word <= glossRun.to ? glossRun : null;
      return (
        <span
          key={i}
          className={cx(joins && MARK_BAND[shared.color], at !== undefined && "mark-sweep", "note-span", tintJoins && "note-tint", glossClasses(glossJoins))} style={at !== undefined && sweep ? sweepStyle({ sweep, at: at + 0.5 }) : undefined}>
          {token.text}
        </span>
      );
    }
    const ref = { line, word: token.word };
    const highlight = highlightAt(annotations.highlights, part, ref);
    const note = noteAt(annotations.notes, part, ref);
    const tint = tintOf(ref).length > 0;
    const startingHere = display.noteIcons !== "words" ? [] : annotations.notes.filter((n) => n.span.part === part && n.span.start.line === line && n.span.start.word === token.word);
    const target = (e: ReactMouseEvent<HTMLElement>): WordTarget => ({
      part,
      ref,
      element: e.currentTarget,
      letter: letterAtPoint({ element: e.currentTarget, x: e.clientX }),
    });
    const mine = new Map(
      annotations.harakat
        .filter((h) => !h.stale && h.part === part && h.line === line && h.word === token.word)
        .map((h) => [h.letter, h.marks]),
    );
    const { target: t } = display;
    const at = sweepAt(highlight, ref);
    const targetLetter = t && t.part === part && t.line === line && t.word === token.word ? t.letter : null;
    const glossRun = runOf(token.word);
    const endsGloss = runs.filter((r) => r.to === token.word);
    // A ring goes right against its word, before any footnote reference ending it.
    const trailingRef = endsGloss.length > 0 ? splitFootnoteRef(token.text) : null;
    const movedRef = trailingRef && trailingRef.before !== "" && !/\p{L}/u.test(trailingRef.after) && !splitFootnoteRef(trailingRef.after) ? trailingRef : null;
    const wordText = movedRef ? movedRef.before : token.text;
    const band = {
      className: cx(highlight && MARK_BAND[highlight.color], at !== undefined && "mark-sweep", note && "note-span", tint && "note-tint", glossClasses(glossRun)),
      style: at !== undefined && sweep ? sweepStyle({ sweep, at: at + 0.25 }) : undefined,
    };
    return (
      <span key={i} className={startingHere.length > 0 ? "relative" : undefined}>
        <span
          data-part={part}
          data-line={line}
          data-w={token.word}
          onMouseEnter={(e) => onWordHover(target(e), note)}
          onMouseLeave={(e) => note && onWordHover(target(e), null)}
          onClick={(e) => onWordClick(target(e), highlight)}
          style={at !== undefined && sweep ? sweepStyle({ sweep, at }) : undefined}
          className={cx(
            highlight && MARK_BAND[highlight.color],
            at !== undefined && "mark-sweep",
            highlight && "cursor-pointer",
            note && "note-span",
            tint && "note-tint",
            glossClasses(glossRun),
          )}
        >
          <WordText text={wordText} mine={mine} display={display} targetLetter={targetLetter} />
        </span>
        {endsGloss.map((r) => (
          <GlossMarker key="gloss" texts={r.texts} showHarakat={display.showHarakat} band={band} onActive={glossActiveFor(r.to)} />
        ))}
        {movedRef && (
          <span className={band.className} style={band.style}>
            {withFootnoteRefs({ text: token.text.slice(movedRef.before.length), shown: display.hashiyaMarkers })}
          </span>
        )}
        {startingHere.length > 0 && <NoteIcon active={startingHere.some((n) => tinted.has(n.id))} dim={dimNoteIcons} />}
      </span>
    );
  });
};

/** One row of a matn line as laid out on screen, relative to its paragraph. `word` is the row's first word. */
export interface ScreenRow {
  top: number;
  height: number;
  word: number;
}

export const screenRows = (block: HTMLElement): ScreenRow[] => {
  const base = block.getBoundingClientRect();
  const rows: ScreenRow[] = [];
  for (const el of block.querySelectorAll<HTMLElement>("[data-w]")) {
    const r = el.getBoundingClientRect();
    const top = r.top - base.top;
    const word = Number(el.dataset.w);
    const row = rows.find((x) => Math.abs(x.top - top) < r.height / 2);
    if (row) {
      row.word = Math.min(row.word, word);
      row.height = Math.max(row.height, r.height);
    } else rows.push({ top, height: r.height, word });
  }
  return rows.sort((x, y) => x.top - y.top);
};

/** The row a word sits on: words run down the rows in order. */
export const rowOfWord = (rows: ScreenRow[], word: number): ScreenRow | null =>
  rows.reduce<ScreenRow | null>((found, row) => (row.word <= word ? row : found), null);

const rowStyle = (row: ScreenRow) => ({ top: row.top, height: row.height });

/** The matn line's number, in the left margin beside its first row. */
const LineNumber = ({ line }: { line: number }) => (
  // The wrapper keeps the line's font so 1lh is one row of text; the number itself is small.
  <span aria-hidden data-overlay className="pointer-events-none absolute -left-6 top-0 flex h-[1lh] w-5 select-none items-center @3xl:-left-10 @3xl:w-7">
    <span className="font-sans text-xs font-normal tabular-nums text-ink-3">{line}</span>
  </span>
);

/** Where the last-read mark was last drawn, so a mark moved on the same page can glide from there. */
let lastMark: { page: number; top: number } | null = null;
const MarkPage = createContext(0);

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Glides the mark from where it was on this page (170ms ease-out). A mark that wasn't
 * showing on this page just before fades and scales in where it is; with reduced motion
 * every change fades in.
 */
const useGlide = (row: ScreenRow) => {
  const page = useContext(MarkPage);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useLayoutEffect(() => {
    const els = refs.current.filter((el): el is HTMLElement => el !== null && el.offsetParent !== null);
    // Measured from the line, which never moves, so a glide still running doesn't skew it.
    const line = els[0]?.parentElement;
    if (!line) return;
    const top = line.getBoundingClientRect().top + row.top;
    const from = lastMark?.page === page ? lastMark.top : null;
    lastMark = { page, top };
    if (from !== null && Math.abs(from - top) < 1) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const el of els) {
      if (reduce) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: EASE_OUT });
      else if (from === null) el.animate([{ opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1 }], { duration: 150, easing: EASE_OUT });
      else el.animate([{ translate: `0 ${from - top}px` }, { translate: "0 0" }], { duration: 170, easing: EASE_OUT });
    }
  }, [page, row.top]);
  return (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
};

/** The last-read mark in a line's margin: a bar and a bookmark, or on narrow layouts a bar beside the row. */
const LastReadMark = ({ row, onClear }: { row: ScreenRow; onClear: () => void }) => {
  const glide = useGlide(row);
  return (
    <>
      <button
        ref={glide(0)}
        type="button"
        data-margin
        onClick={onClear}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Clear the last-read marker"
        style={rowStyle(row)}
        className="absolute left-full ml-6 hidden select-none items-start gap-3 font-sans @3xl:flex"
      >
        <span className="w-0.5 self-stretch rounded-full bg-accent" />
        <span className="flex flex-col items-center gap-1 text-accent">
          <Bookmark aria-hidden className="size-5 fill-current" />
          <span className="whitespace-nowrap text-overline font-semibold uppercase tracking-widest">Last read</span>
        </span>
      </button>
      {/* Without room for the margin, the marked row gets a bar beside it. */}
      <span ref={glide(1)} aria-hidden style={rowStyle(row)} className="pointer-events-none absolute -right-3 w-0.5 rounded-full bg-accent @3xl:hidden" />
    </>
  );
};

/** What a note mark in the margin hands the reader: the notes ending on its row, and where their words are. */
export interface NoteMarkTarget {
  notes: Note[];
  anchor: DOMRect;
}

export interface NoteMarkHandlers {
  onHover: (target: NoteMarkTarget | null) => void;
  onOpen: (target: NoteMarkTarget) => void;
}

/** The words a note ends on, to anchor its peek to. */
const noteAnchor = ({ from, note }: { from: HTMLElement; note: Note }) => {
  const { part, end } = note.span;
  const word = from.closest("article")?.querySelector<HTMLElement>(`[data-part="${part}"][data-line="${end.line}"][data-w="${end.word}"]`);
  return (word ?? from).getBoundingClientRect();
};

/**
 * The notes ending on one screen row, marked in the left margin: a small note icon
 * (with a count when there are several), out in the margin past the line numbers or
 * in their place when they're hidden. Without room for the margin, a thin bar.
 */
const NoteMark = ({
  row,
  notes,
  numbered,
  dim,
  active,
  handlers,
}: {
  row: ScreenRow;
  notes: Note[];
  numbered: boolean;
  dim: boolean;
  active: boolean;
  handlers: NoteMarkHandlers;
}) => {
  const target = (el: HTMLElement): NoteMarkTarget => {
    const last = notes.reduce((a, b) => (b.span.end.word > a.span.end.word ? b : a));
    return { notes, anchor: noteAnchor({ from: el, note: last }) };
  };
  return (
    <>
      <button
        type="button"
        data-margin
        data-active={active ? "" : undefined}
        aria-label={notes.length === 1 ? "Note" : `${notes.length} notes`}
        style={rowStyle(row)}
        onMouseEnter={(e) => handlers.onHover(target(e.currentTarget))}
        onMouseLeave={() => handlers.onHover(null)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => handlers.onOpen(target(e.currentTarget))}
        className={cx(
          "absolute right-full hidden w-8 select-none items-center justify-end gap-0.5 font-sans text-ink-3 outline-none transition-[color,scale,opacity] duration-press ease-out hover:text-accent hover:opacity-100 focus-visible:text-accent focus-visible:opacity-100 active:scale-92 data-active:text-accent data-active:opacity-100 motion-reduce:transition-[color,opacity] @3xl:flex",
          numbered ? "mr-13" : "mr-3",
          dim && "opacity-30",
        )}
      >
        {notes.length > 1 && <span className="text-overline font-semibold tabular-nums">{notes.length}</span>}
        <MessageSquareText aria-hidden className="size-3.5" />
      </button>
      <span aria-hidden style={rowStyle(row)} className={cx("pointer-events-none absolute right-full mr-1 w-0.5 rounded-full bg-ink-3/50 @3xl:hidden", dim && "opacity-30")} />
    </>
  );
};

/** Notes ending on a line, grouped by the screen row their last word sits on. */
const notesByRow = ({ rows, notes }: { rows: ScreenRow[]; notes: Note[] }) => {
  const groups = new Map<ScreenRow, Note[]>();
  for (const note of notes) {
    const row = rowOfWord(rows, note.span.end.word);
    if (row) groups.set(row, [...(groups.get(row) ?? []), note]);
  }
  return [...groups];
};

/** A line of text with its margin: the last-read marker on one screen row, or on hover a button beside the row. */
const MarkableLine = ({
  as: Tag,
  part,
  line,
  className,
  markerWord,
  layoutKey,
  onMark,
  onClearMark,
  notes,
  numbered,
  noteMarks,
  children,
}: {
  as: "p" | "h2";
  part: Part;
  line: number;
  className: string;
  markerWord: number | null;
  /** Changes when the text may have reflowed (e.g. harakat shown or hidden). */
  layoutKey: string;
  onMark: (word: number) => void;
  onClearMark: () => void;
  /** The notes that end on this line. */
  notes: Note[];
  /** Whether the line has a number in the margin, which the note marks sit beyond. */
  numbered: boolean;
  noteMarks: { dim: boolean; tinted: ReadonlySet<string>; handlers: NoteMarkHandlers };
  children: ReactNode;
}) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [hover, setHover] = useState<ScreenRow | null>(null);
  const [rows, setRows] = useState<ScreenRow[]>([]);
  const measured = markerWord !== null || notes.length > 0;
  const notesKey = notes.map((n) => `${n.id}:${n.span.end.word}`).join(",");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !measured) {
      setRows([]);
      return;
    }
    const measure = () => setRows(screenRows(el));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measured, layoutKey, notesKey]);
  const marked = markerWord === null ? null : rowOfWord(rows, markerWord);

  const rowAt = (clientY: number) => {
    const el = ref.current;
    if (!el) return null;
    const y = clientY - el.getBoundingClientRect().top;
    const rows = screenRows(el);
    return rows.find((r) => y < r.top + r.height) ?? rows.at(-1) ?? null;
  };

  return (
    <Tag ref={ref} data-line-block={`${part}-${line}`} onMouseLeave={() => setHover(null)} className={cx("relative", className)}>
      {children}
      {/* The margin beside the line: the mark button shows only while the pointer is here. */}
      <span
        aria-hidden
        data-margin
        onMouseMove={(e) => {
          // A text selection being dragged across the margin isn't a reach for the mark button.
          if (e.buttons !== 0) return;
          const row = rowAt(e.clientY);
          if (row?.word !== hover?.word) setHover(row);
        }}
        onMouseLeave={() => setHover(null)}
        className="absolute inset-y-0 left-full hidden w-36 @3xl:block"
      />
      {marked && <LastReadMark row={marked} onClear={onClearMark} />}
      {notesByRow({ rows, notes }).map(([row, onRow]) => (
        <NoteMark
          key={row.word}
          row={row}
          notes={onRow}
          numbered={numbered}
          dim={noteMarks.dim}
          active={onRow.some((n) => noteMarks.tinted.has(n.id))}
          handlers={noteMarks.handlers}
        />
      ))}
      {hover && hover.word !== marked?.word && (
        <span
          data-margin
          style={rowStyle(hover)}
          onMouseEnter={() => setHover(hover)}
          onMouseLeave={() => setHover(null)}
          className="absolute left-full ml-6 hidden select-none items-center gap-3 font-sans @3xl:flex"
        >
          <span className="w-px self-stretch bg-line" />
          <button
            type="button"
            onClick={() => onMark(hover.word)}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Mark as last read"
            className="flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:text-accent"
          >
            <BookmarkPlus aria-hidden className="size-4" />
          </button>
        </span>
      )}
    </Tag>
  );
};

/** A heading that opens a chapter, set off with space and a small ornament above it. */
const ChapterOrnament = () => (
  <span aria-hidden className="mx-auto mt-8 mb-1 flex w-36 items-center gap-3 first:mt-2">
    <span className="h-px flex-1 bg-line" />
    <span className="size-2 rotate-45 border border-accent" />
    <span className="h-px flex-1 bg-line" />
  </span>
);

export const PageView = ({
  stored,
  bookTitle,
  chapter,
  width,
  highlightStyle,
  annotations,
  freshHighlight,
  display,
  marker,
  onMark,
  onClearMark,
  onWordHover,
  onWordClick,
  tinted,
  dimNoteMarks,
  noteMarkHandlers,
}: {
  stored: StoredPage;
  bookTitle: string;
  /** The chapter this page falls in, for the running header. */
  chapter: string | null;
  width: PageWidth;
  highlightStyle: HighlightStyle;
  annotations: PageAnnotations;
  /** The highlight just made, if any, to draw in. */
  freshHighlight: string | null;
  display: Display;
  /** The word on this page holding the last-read marker, if any. */
  marker: { part: Part; line: number; word: number } | null;
  onMark: (at: { part: Part; line: number; word: number }) => void;
  onClearMark: () => void;
  onWordHover: LineProps["onWordHover"];
  onWordClick: LineProps["onWordClick"];
  tinted: ReadonlySet<string>;
  /** Focus mode keeps the note marks faint until hovered. */
  dimNoteMarks: boolean;
  noteMarkHandlers: NoteMarkHandlers;
}) => {
  const { page } = stored;
  const articleRef = useRef<HTMLElement>(null);
  useSelectionBoxes(articleRef);
  const fresh = freshHighlight ? annotations.highlights.find((h) => h.id === freshHighlight) : undefined;
  const sweep = fresh ? sweepOrder({ page, highlight: fresh }) : null;
  const lineProps = { glosses: page.glosses, annotations, sweep, display, tinted, dimNoteIcons: dimNoteMarks, onWordHover, onWordClick };
  const t = (s: string) => (display.showHarakat ? s : stripHarakat(s));
  const markable = (part: Part, line: number) => ({
    part,
    line,
    markerWord: marker?.part === part && marker.line === line ? marker.word : null,
    layoutKey: `${display.showHarakat}-${display.showMine}-${display.textScale}-${display.glossMarkers}-${display.hashiyaMarkers}`,
    onMark: (word: number) => onMark({ part, line, word }),
    onClearMark,
    notes: display.noteIcons === "margin" ? annotations.notes.filter((n) => n.span.part === part && n.span.end.line === line) : [],
    numbered: part === "matn" && display.lineNumbers,
    noteMarks: { dim: dimNoteMarks, tinted, handlers: noteMarkHandlers },
  });
  const footnotes = footnotesByMarker(page.hashiya.map((f) => ({ marker: f.marker, text: t(f.text) })));
  const folio = arabicNumber(stored.number ?? stored.position);
  // A marker removed from the page (or never on it) has nowhere to glide from when it comes back.
  useLayoutEffect(() => {
    if (marker === null) lastMark = null;
  }, [marker]);
  return (
    <MarkPage value={stored.position}>
    <Footnotes value={footnotes}>
      <article
        ref={articleRef}
        style={{ "--text-scale": display.textScale } as CSSProperties}
        className={cx(
          "reader-text mx-auto flex w-full flex-col pb-24",
          width === "wide" ? "page-wide max-w-190" : "page-narrow max-w-160",
          highlightStyle === "behind" && "highlights-behind",
        )}
      >
        <header className="mb-6 flex items-baseline justify-between gap-6 border-b border-line pb-3 text-ink-3" dir="rtl">
          <span className="ar truncate text-ar-small">{t(bookTitle)}</span>
          <span className="ar truncate text-ar-small">{chapter && t(chapter)}</span>
        </header>
        {page.matn.length === 0 && <p className="py-12 text-center text-sm text-ink-3">This page has no main text.</p>}
        {page.matn.map((b) =>
          b.kind === "heading" ? (
            <div key={b.line} className="flex flex-col">
              {b.level <= 2 && <ChapterOrnament />}
              <MarkableLine
                as="h2"
                {...markable("matn", b.line)}
                className={cx("ar mt-2 mb-4 text-center font-bold", b.level <= 2 ? "text-ar-display" : "text-ar-reading")}
              >
                {display.lineNumbers && <LineNumber line={b.line} />}
                <Line part="matn" line={b.line} text={b.text} {...lineProps} />
              </MarkableLine>
            </div>
          ) : (
            <MarkableLine key={b.line} as="p" {...markable("matn", b.line)} className="page-line ar whitespace-pre-line rounded-lg text-ar-reading">
              {display.lineNumbers && <LineNumber line={b.line} />}
              <Line part="matn" line={b.line} text={b.text} {...lineProps} />
            </MarkableLine>
          ),
        )}
        {page.hashiya.length > 0 && (
          <section className="relative mt-10 flex flex-col gap-2" dir="rtl">
            <h3 className="sr-only">الحاشية</h3>
            <span aria-hidden className="mb-2 h-px w-1/3 bg-ink-3/40" />
            {page.hashiya.map((f, i) => (
              <MarkableLine key={`${f.marker ?? "u"}-${i}`} as="p" {...markable("hashiya", i + 1)} className="ar text-justify text-ar-small text-ink-2 [text-align-last:start]">
                {f.marker && `(${f.marker}) `}
                <Line part="hashiya" line={i + 1} text={f.text} {...lineProps} />
              </MarkableLine>
            ))}
          </section>
        )}
        <footer className="ar mt-10 text-center text-ar-body text-ink-2" aria-label={`Page ${folio}`}>
          {folio}
        </footer>
      </article>
    </Footnotes>
    </MarkPage>
  );
};

/** The word's own text nodes, skipping the red copies drawn under the reader's harakat. */
const readingText = (element: HTMLElement) =>
  document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("[data-overlay]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

/** The base letter of a word element nearest to the pointer's x position (1-based). */
export const letterAtPoint = ({ element, x }: { element: HTMLElement; x: number }): number | null => {
  const walker = readingText(element);
  let letter = 0;
  let best: { letter: number; distance: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    let i = 0;
    while (i < text.length) {
      if (isMark(text[i] ?? "")) {
        i += 1;
        continue;
      }
      letter += 1;
      let end = i + 1;
      while (end < text.length && isMark(text[end] ?? "")) end += 1;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, end);
      const box = range.getBoundingClientRect();
      const distance = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
      if (!best || distance < best.distance) best = { letter, distance };
      i = end;
    }
  }
  return best?.letter ?? null;
};

/** The base letter where the selection starts, counted within its word (1-based). */
export const letterAtSelectionStart = (root: HTMLElement): number | null => {
  const range = window.getSelection()?.getRangeAt(0);
  const word = range && (range.startContainer.parentElement?.closest<HTMLElement>("[data-w]") ?? null);
  if (!range || !word || !root.contains(word)) return null;
  let letters = 0;
  const walker = readingText(word);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node === range.startContainer ? (node.textContent ?? "").slice(0, range.startOffset) : (node.textContent ?? "");
    letters += [...text].filter((ch) => !isMark(ch)).length;
    if (node === range.startContainer) break;
  }
  return letters + 1;
};

/** True when the selection covers every letter of the word element. */
export const selectionCoversWord = ({ range, word }: { range: Range; word: HTMLElement }): boolean => {
  const walker = readingText(word);
  const first = walker.nextNode();
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
  if (!first || !last) return false;
  return range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.textContent?.length ?? 0) === 0;
};

/** Selects the words a span covers, as a double-click or drag would. */
export const selectSpan = ({ root, span }: { root: HTMLElement; span: Span }) => {
  const at = (ref: WordRef) => root.querySelector<HTMLElement>(`[data-part="${span.part}"][data-line="${ref.line}"][data-w="${ref.word}"]`);
  const first = at(span.start);
  const last = at(span.end);
  if (!first || !last) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

/** Snaps the current text selection inside `root` to whole words. Null when nothing is selected. */
export const spanFromSelection = (root: HTMLElement): { span: Span; rect: DOMRect } | null => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const touches = (el: Element) => {
    if (!range.intersectsNode(el)) return false;
    // A range that starts at the very end of a word or ends at the very start of one doesn't select it.
    if (el.contains(range.endContainer) && range.endOffset === 0 && range.startContainer !== range.endContainer) return false;
    if (el.contains(range.startContainer) && range.startOffset === (range.startContainer.textContent ?? "").length) return false;
    return true;
  };

  const words = [...root.querySelectorAll<HTMLElement>("[data-w]")].filter(touches);
  const first = words[0];
  if (!first) return null;
  const part = first.dataset.part as Part;
  const inPart = words.filter((w) => w.dataset.part === part);
  const last = inPart[inPart.length - 1] ?? first;
  const ref = (el: HTMLElement): WordRef => ({ line: Number(el.dataset.line), word: Number(el.dataset.w) });
  return { span: { part, start: ref(first), end: ref(last) }, rect: range.getBoundingClientRect() };
};

const inWord = (node: Node) => {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest("[data-w]") && !el.closest("[data-overlay]");
};

/**
 * The text position nearest a point, for selections that start or run off the
 * text: in the margins, between lines, past the end of a line.
 */
export const caretNear = ({ root, x, y }: { root: HTMLElement; x: number; y: number }): { node: Node; offset: number } | null => {
  const at = (px: number, py: number) => {
    const pos = document.caretPositionFromPoint(px, py);
    return pos && inWord(pos.offsetNode) ? { node: pos.offsetNode, offset: pos.offset } : null;
  };
  const direct = at(x, y);
  if (direct) return direct;
  // Nearest word: the closest row first, then the closest word along it.
  let best: { rect: DOMRect; score: number } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) {
    const r = el.getBoundingClientRect();
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 10_000 + dx;
    if (!best || score < best.score) best = { rect: r, score };
  }
  if (!best) return null;
  const { rect } = best;
  return at(Math.min(Math.max(x, rect.left + 1), rect.right - 1), rect.top + rect.height / 2);
};
