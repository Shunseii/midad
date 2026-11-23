import { Bookmark, BookmarkPlus, MessageSquareText } from "lucide-react";
import { type CSSProperties, createContext, Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type MouseEvent as ReactMouseEvent, type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type { GlossMode, HighlightStyle, NoteIcons, PageWidth } from "../lib/appearance";
import { arabicNumber } from "../lib/format";
import { FOOTNOTE_REF, footnotesByMarker, splitFootnoteRef, toArabicIndic } from "../lib/footnotes";
import { scrollToMiddle, tintWords } from "../lib/reveal";
import { type Sweep, sweepOrder, sweepTiming } from "../lib/sweep";
import { GlossLabel, type GlossRun, GlossStrut, glossRuns, runText, useGlossLayout } from "./glosses";
import { cx, IconButton } from "./ui";
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

const stopPageHandlers = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** The page's footnotes by marker, for the superscript references in the text to peek at. */
const Footnotes = createContext<Map<string, string>>(new Map());

/** Scrolls to the ḥāshiya entry with this marker and tints its words for a moment. */
const revealFootnote = ({ from, marker }: { from: HTMLElement; marker: string }) => {
  const entry = from.closest("article")?.querySelector<HTMLElement>(`[data-footnote="${marker}"]`);
  if (!entry) return;
  scrollToMiddle(entry);
  tintWords([...entry.querySelectorAll<HTMLElement>("[data-w]")]);
};

/** Scrolls back to the first reference to this footnote in the text and tints its word. */
const revealFootnoteRef = ({ from, marker }: { from: HTMLElement; marker: string }) => {
  const word = from.closest("article")?.querySelector(`[data-footnote-ref="${marker}"]`)?.closest<HTMLElement>("[data-w]");
  if (!word) return;
  scrollToMiddle(word);
  tintWords([word]);
};

const onActivate = (go: (el: HTMLElement) => void) => ({
  onClick: (e: ReactMouseEvent<HTMLElement>) => {
    // Not a click on the word: that would pick a letter for harakat.
    e.stopPropagation();
    go(e.currentTarget);
  },
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    go(e.currentTarget);
  },
});

/**
 * A footnote reference such as (١), set as a superscript that shows the footnote on hover
 * and jumps to it in the ḥāshiya on click or Enter. Its hit area reaches past the small
 * number (an overlay, so the line doesn't move); the em-based bounds track the text size and
 * the zero line height Chromium gives the raised number. A long footnote scrolls inside the peek.
 * Inline-block: as a plain inline child it lifts the word's own box above its neighbours',
 * and the highlight band and reveal tint drawn from that box would step out of line.
 */
const FootnoteRef = ({ marker }: { marker: string }) => {
  const footnote = useContext(Footnotes).get(marker);
  const className = "relative mx-px inline-block align-super text-[0.6em] font-bold text-accent transition-colors duration-press";
  if (!footnote) {
    return (
      <span data-sel-box>
        <sup data-footnote-ref={marker} className={cx(className, "cursor-default")}>
          {marker}
        </sup>
      </span>
    );
  }
  const sup = (
    <sup
      data-footnote-ref={marker}
      role="link"
      tabIndex={0}
      aria-label={`Footnote ${marker}`}
      {...onActivate((el) => revealFootnote({ from: el, marker }))}
      className={cx(
        className,
        "cursor-pointer rounded-sm outline-none before:absolute before:-inset-x-[0.5em] before:-top-[1.15em] before:-bottom-[1.1em] before:content-[''] hover:text-ink focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      {marker}
    </sup>
  );
  return (
    <span data-sel-box>
      <Tooltip>
        <TooltipTrigger render={sup} />
        <TooltipContent
          side="bottom"
          sideOffset={6}
          arrow={false}
          onMouseDown={stopPageHandlers}
          onMouseUp={stopPageHandlers}
          onClick={stopPageHandlers}
          className="block w-max max-w-96 rounded-xl bg-surface-3 p-0 text-ink shadow-float"
        >
          <span dir="rtl" className="gloss-scroll ar block max-h-60 overflow-y-auto overscroll-contain px-3.5 py-2.5 text-right text-ar-small text-ink-2">
            ({marker}) {footnote}
          </span>
        </TooltipContent>
      </Tooltip>
    </span>
  );
};

/** Whether a selection covers some of an element, not just touching its start or end. */
const coversPart = ({ range, el }: { range: Range; el: Element }) =>
  range.intersectsNode(el) && range.comparePoint(el, el.childNodes.length) !== -1 && range.comparePoint(el, 0) !== 1 &&
  !(range.endContainer !== range.startContainer && el.contains(range.endContainer) && range.endOffset === 0) &&
  !(el.contains(range.startContainer) && range.startOffset === (range.startContainer.textContent ?? "").length);

/**
 * The page paints its own selection: the browser's would fill the whole line box, and rows
 * that carry glosses are taller, so it would cover the glosses under the words. Words and the
 * spaces between them take the selection colour at the text's own height instead, and the
 * small inline-block footnote refs (data-sel-box) take it over their full-height boxes.
 */
const useSelectionBoxes = (root: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const update = () => {
      const el = root.current;
      if (!el) return;
      const selection = window.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      for (const box of el.querySelectorAll<HTMLElement>("[data-sel-box], [data-w], [data-space]")) {
        box.toggleAttribute("data-in-selection", !!range && coversPart({ range, el: box }));
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
  /** How interlinear glosses show: under their words, on hover, or not at all. */
  glosses: GlossMode;
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
  /** Focus mode fades the note corners, like the margin marks. */
  dimNoteIcons: boolean;
  /** Changes when the text may have reflowed, so the glosses are laid out again. */
  layoutKey: string;
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
    // With the book's own marks too, the font moves them to make room (a shadda rises over
    // a kasra), so a copy can't line up: the letter is drawn once, all of it in the reader's colour.
    const stacked = !!marks.mine && !!marks.corpus;
    const { before, after } = inContext({ letters, index: i });
    nodes.push(
      <span key={letter} className={cx("relative isolate", stacked && "text-ink-added", letter === targetLetter && "text-accent")}>
        {letter === targetLetter && <span data-overlay aria-hidden className={TARGET_TICK} />}
        {l.base}
        {marks.corpus}
        {stacked && marks.mine}
        {marks.mine && !stacked && (
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
 * A corner mark at one end of a note's words: at the top of the first word's leading edge,
 * or the bottom of the last word's trailing edge. It sits just outside the word's box, so it
 * stays clear of the letters and of a highlight band in either style; it takes no room and
 * is left out of hit tests, selection and copying. Gloss layout treats it as taken space.
 */
const NoteCorner = ({ edge, active, dim }: { edge: "start" | "end"; active: boolean; dim: boolean }) => (
  <span
    data-overlay
    data-note-corner={edge}
    aria-hidden
    className={cx("note-corner", edge === "start" ? "note-corner-start" : "note-corner-end", active && "note-corner-active", dim && !active && "note-corner-dim")}
  />
);

const Line = ({ part, line, text, glosses, annotations, sweep, display, tinted, dimNoteIcons, layoutKey, onWordHover, onWordClick }: LineProps) => {
  const sweepAt = (h: Highlight | null, ref: WordRef) => (sweep && h?.id === sweep.id ? sweep.order.get(`${part}:${ref.line}:${ref.word}`) : undefined);
  const tokens = tokenize(text);
  const wordAt = (i: number) => {
    const t = tokens[i];
    return t?.kind === "word" ? { line, word: t.word } : null;
  };

  const mode = display.glosses;
  const runs = mode === "hidden" ? [] : glossRuns({ glosses, part, line });
  const probe = useRef<HTMLSpanElement>(null);
  const cornersKey = display.noteIcons !== "margin" ? annotations.notes.map((n) => `${n.id}:${n.span.start.line}:${n.span.start.word}:${n.span.end.line}:${n.span.end.word}`).join(",") : "";
  const glossLayout = useGlossLayout({ probe, part, line, runs, enabled: mode === "under", layoutKey: `${layoutKey}|${cornersKey}` });
  const [hover, setHover] = useState<{ run: string; on: "words" | "label" } | null>(null);
  /** The shortest run over a word: the gloss most about that word. */
  const runOf = (word: number) =>
    runs.filter((r) => r.from <= word && word <= r.to).reduce<GlossRun | null>((best, r) => (!best || r.to - r.from < best.to - best.from ? r : best), null);
  // The words tinted violet: those of the gloss under the pointer.
  const tintSpan = hover?.on === "label" ? (runs.find((r) => r.id === hover.run) ?? null) : null;
  const inTint = (word: number) => tintSpan !== null && tintSpan.from <= word && word <= tintSpan.to;
  const glossClasses = (word: number, joinsTo?: number) => {
    if (!inTint(word) || (joinsTo !== undefined && !inTint(joinsTo))) return null;
    return cx("gloss-span gloss-tint", joinsTo === undefined && word === tintSpan?.from && "gloss-from", joinsTo === undefined && word === tintSpan?.to && "gloss-to");
  };
  const hoverWords = (word: number, entering: boolean) => {
    const run = runOf(word);
    if (!run) return;
    setHover((h) => (entering ? { run: run.id, on: "words" } : h?.run === run.id && h.on === "words" ? null : h));
  };
  const tintOf = (ref: WordRef) => tintedAt({ notes: annotations.notes, tinted, part, ref });
  const corners = display.noteIcons !== "margin";
  const startsHere = (word: number) => (corners ? annotations.notes.filter((n) => n.span.part === part && n.span.start.line === line && n.span.start.word === word) : []);
  const endsHere = (word: number) => (corners ? annotations.notes.filter((n) => n.span.part === part && n.span.end.line === line && n.span.end.word === word) : []);
  const anchoredAt = (word: number) => runs.filter((r) => (glossLayout.labels[r.id]?.anchor ?? r.to) === word);

  const nodes = tokens.map((token, i) => {
    if (token.kind === "space") {
      const before = wordAt(i - 1);
      const after = wordAt(i + 1);
      const shared =
        before && after ? highlightAt(annotations.highlights, part, before) : null;
      const joins = shared && after && spanContains({ span: shared.span, part, ref: after });
      const at = joins && before ? sweepAt(shared, before) : undefined;
      const tintBefore = before ? tintOf(before) : [];
      const tintJoins = after !== null && tintBefore.some((n) => spanContains({ span: n.span, part, ref: after }));
      return (
        <span
          key={i}
          data-space
          className={cx(joins && MARK_BAND[shared.color], at !== undefined && "mark-sweep", "note-span", tintJoins && "note-tint", before && after && glossClasses(before.word, after.word))} style={at !== undefined && sweep ? sweepStyle({ sweep, at: at + 0.5 }) : undefined}>
          {token.text}
        </span>
      );
    }
    const ref = { line, word: token.word };
    const highlight = highlightAt(annotations.highlights, part, ref);
    const note = noteAt(annotations.notes, part, ref);
    const tint = tintOf(ref).length > 0;
    const starting = startsHere(token.word);
    const ending = endsHere(token.word);
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
    const anchored = anchoredAt(token.word);
    return (
      <span key={i} className="relative whitespace-nowrap">
        <span
          data-part={part}
          data-line={line}
          data-w={token.word}
          onMouseEnter={(e) => {
            onWordHover(target(e), note);
            hoverWords(token.word, true);
          }}
          onMouseLeave={(e) => {
            if (note) onWordHover(target(e), null);
            hoverWords(token.word, false);
          }}
          onClick={(e) => onWordClick(target(e), highlight)}
          style={at !== undefined && sweep ? sweepStyle({ sweep, at }) : undefined}
          className={cx(
            highlight && MARK_BAND[highlight.color],
            at !== undefined && "mark-sweep",
            highlight && "cursor-pointer",
            note && "note-span",
            tint && "note-tint",
            glossClasses(token.word),
          )}
        >
          <WordText text={token.text} mine={mine} display={display} targetLetter={targetLetter} />
        </span>
        {starting.length > 0 && <NoteCorner edge="start" active={starting.some((n) => tinted.has(n.id))} dim={dimNoteIcons} />}
        {ending.length > 0 && <NoteCorner edge="end" active={ending.some((n) => tinted.has(n.id))} dim={dimNoteIcons} />}
        {mode === "under" && anchored.length > 0 && <GlossStrut room={glossLayout.struts[token.word]} />}
        {anchored.map((run) => (
          <GlossLabel
            key={run.id}
            run={run}
            text={runText({ run, showHarakat: display.showHarakat })}
            mode={mode}
            placement={glossLayout.labels[run.id]}
            labelSize={glossLayout.labelSize}
            active={hover?.run === run.id}
            onHover={(hovered) => setHover((h) => (hovered ? { run: run.id, on: "label" } : h?.run === run.id ? null : h))}
          />
        ))}
      </span>
    );
  });
  return (
    <>
      <span ref={probe} hidden />
      {nodes}
    </>
  );
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
  return word ? rectWithGlosses(word) : from.getBoundingClientRect();
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
  footnote,
  children,
}: {
  as: "p" | "h2";
  /** A ḥāshiya entry's marker, for references in the text to find it by. */
  footnote?: string;
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
    <Tag ref={ref} data-line-block={`${part}-${line}`} data-footnote={footnote} onMouseLeave={() => setHover(null)} className={cx("relative", className)}>
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
          <IconButton icon={BookmarkPlus} label="Mark as last read" variant="outline" onClick={() => onMark(hover.word)} onMouseDown={(e) => e.stopPropagation()} />
        </span>
      )}
    </Tag>
  );
};

/** A ḥāshiya entry's printed number. Where the text refers to it, it links back there. */
const FootnoteBack = ({ marker, printed, linked }: { marker: string; printed: string; linked: boolean }) =>
  linked ? (
    <>
      <span
        role="link"
        tabIndex={0}
        aria-label={`Back to footnote ${marker} in the text`}
        {...onActivate((el) => revealFootnoteRef({ from: el, marker }))}
        className="cursor-pointer rounded-sm text-accent outline-none transition-colors duration-press hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        ({printed})
      </span>{" "}
    </>
  ) : (
    `(${printed}) `
  );

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
  ribbon,
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
  /** The bookmark ribbon, hung from the page's top corner. */
  ribbon?: ReactNode;
}) => {
  const { page } = stored;
  const articleRef = useRef<HTMLElement>(null);
  useSelectionBoxes(articleRef);
  const fresh = freshHighlight ? annotations.highlights.find((h) => h.id === freshHighlight) : undefined;
  const sweep = fresh ? sweepOrder({ page, highlight: fresh }) : null;
  const layoutKey = `${display.showHarakat}-${display.showMine}-${display.textScale}-${display.glosses}-${display.hashiyaMarkers}-${display.noteIcons}-${width}`;
  const lineProps = { glosses: page.glosses, annotations, sweep, display, tinted, dimNoteIcons: dimNoteMarks, layoutKey, onWordHover, onWordClick };
  const t = (s: string) => (display.showHarakat ? s : stripHarakat(s));
  const markable = (part: Part, line: number) => ({
    part,
    line,
    markerWord: marker?.part === part && marker.line === line ? marker.word : null,
    layoutKey,
    onMark: (word: number) => onMark({ part, line, word }),
    onClearMark,
    notes: display.noteIcons === "corners" ? [] : annotations.notes.filter((n) => n.span.part === part && n.span.end.line === line),
    numbered: part === "matn" && display.lineNumbers,
    noteMarks: { dim: dimNoteMarks, tinted, handlers: noteMarkHandlers },
  });
  const footnotes = footnotesByMarker(page.hashiya.map((f) => ({ marker: f.marker, text: t(f.text) })));
  const referenced = new Set(page.matn.flatMap((b) => [...b.text.matchAll(new RegExp(FOOTNOTE_REF.source, "g"))].map((m) => toArabicIndic(m[1] ?? ""))));
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
          "reader-text relative mx-auto flex w-full flex-col pb-24",
          width === "wide" ? "page-wide max-w-190" : "page-narrow max-w-160",
          highlightStyle === "behind" && "highlights-behind",
        )}
      >
        {ribbon}
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
              {/* A line that is only a gloss (OCR'd onto its own line) takes no height; its number would sit on the next line's. */}
              {display.lineNumbers && b.text.trim() !== "" && <LineNumber line={b.line} />}
              <Line part="matn" line={b.line} text={b.text} {...lineProps} />
            </MarkableLine>
          ),
        )}
        {page.hashiya.length > 0 && (
          <section className="relative mt-10 flex flex-col gap-2" dir="rtl">
            <h3 className="sr-only">الحاشية</h3>
            <span aria-hidden className="mb-2 h-px w-1/3 bg-ink-3/40" />
            {page.hashiya.map((f, i) => (
              <MarkableLine
                key={`${f.marker ?? "u"}-${i}`}
                as="p"
                {...markable("hashiya", i + 1)}
                footnote={f.marker ? toArabicIndic(f.marker) : undefined}
                className="ar text-justify text-ar-small text-ink-2 [text-align-last:start]"
              >
                {f.marker && <FootnoteBack marker={toArabicIndic(f.marker)} printed={f.marker} linked={display.hashiyaMarkers && referenced.has(toArabicIndic(f.marker))} />}
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

/**
 * A word's box grown to take in the interlinear glosses printed under its row, so a peek or
 * toolbar opened below the word lands clear of them instead of covering them.
 */
export const rectWithGlosses = (word: HTMLElement): DOMRect => {
  const box = word.getBoundingClientRect();
  const block = word.closest("p, h2");
  if (!block) return box;
  let bottom = box.bottom;
  for (const label of block.querySelectorAll<HTMLElement>("[data-gloss-label]")) {
    const r = label.getBoundingClientRect();
    if (r.top >= box.bottom - 1 && r.top < bottom + box.height) bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(box.left, box.top, box.width, bottom - box.top);
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
