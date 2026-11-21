import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { Span, WordRef } from "../../../shared/annotations";
import type { FindOptions } from "../../../shared/find";
import { arabicNumber } from "../lib/format";
import { shortcutLabel } from "../lib/keymap";
import { handleKeys } from "../lib/use-keybindings";
import { Button, IconButton, cx } from "./ui";

export interface FindState {
  open: boolean;
  query: string;
  options: FindOptions;
  /** The match the reader is on, as an index into the page's matches. */
  active: number;
}

export const CLOSED_FIND: FindState = { open: false, query: "", options: { matchHarakat: false, wholeWord: false }, active: 0 };

const wordsOf = ({ root, span }: { root: HTMLElement; span: Span }): HTMLElement[] => {
  const at = (ref: WordRef) => root.querySelector<HTMLElement>(`[data-part="${span.part}"][data-line="${ref.line}"][data-w="${ref.word}"]`);
  const first = at(span.start);
  const last = at(span.end);
  return first && last ? [first, last] : [];
};

const rangeOf = (words: HTMLElement[]): Range | null => {
  const [first, last] = words;
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  return range;
};

/** Keeps "٣ / ١٢" reading left to right: Arabic-Indic digits would otherwise pull the slash and spaces into right-to-left order. */
const LRM = "\u200E";

const MATCH = "find-match";
const ACTIVE = "find-active";

/**
 * Paints the page's matches with the CSS highlight API, so the words keep their
 * own markup: highlights, notes, glosses and harakat stay as they are under it.
 * Runs after every render, since a re-render can replace the words' nodes.
 */
export const useFindHighlights = ({ root, matches, active, open }: { root: RefObject<HTMLElement | null>; matches: Span[]; active: number; open: boolean }) => {
  useLayoutEffect(() => {
    const el = root.current;
    if (!open || !el || typeof Highlight === "undefined") {
      CSS.highlights?.delete(MATCH);
      CSS.highlights?.delete(ACTIVE);
      return;
    }
    const ranges = matches.map((span) => rangeOf(wordsOf({ root: el, span })));
    CSS.highlights.set(MATCH, new Highlight(...ranges.filter((r, i): r is Range => r !== null && i !== active)));
    const current = ranges[active];
    if (current) CSS.highlights.set(ACTIVE, new Highlight(current));
    else CSS.highlights.delete(ACTIVE);
  });
  useEffect(
    () => () => {
      CSS.highlights?.delete(MATCH);
      CSS.highlights?.delete(ACTIVE);
    },
    [],
  );
};

/** Scrolls the active match to the middle of the page when it changes. */
export const revealMatch = ({ root, span }: { root: HTMLElement | null; span: Span | undefined }) => {
  if (!root || !span) return;
  const [first] = wordsOf({ root, span });
  first?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
};

const OptionToggle = ({ label, title, on, onToggle }: { label: string; title: string; on: boolean; onToggle: () => void }) => (
  <Button variant="ghost" size="sm" pressed={on} tooltip={title} onClick={onToggle} className="shrink-0">
    {label}
  </Button>
);

/** Find on the page: a small bar over the top of the page that steps through the matches. */
export const FindBar = ({
  state,
  count,
  focusKey,
  onChange,
  onStep,
  onClose,
}: {
  state: FindState;
  count: number;
  /** Changes each time Ctrl+F is pressed, to focus and select the query again. */
  focusKey: number;
  onChange: (next: Partial<FindState>) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.open) return;
    input.current?.focus();
    input.current?.select();
  }, [state.open, focusKey]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) =>
    handleKeys({
      event: e,
      handlers: {
        "find.next": () => onStep(1),
        "find.previous": () => onStep(-1),
        "find.close": onClose,
        "find.selectQuery": () => input.current?.select(),
      },
    });

  const hasQuery = state.query.trim() !== "";
  const { options } = state;
  return (
    <div
      role="search"
      aria-label="Find on page"
      data-state={state.open ? "open" : "closed"}
      inert={!state.open}
      className="absolute top-3 right-6 z-10 flex items-center gap-1 rounded-xl bg-surface-3 py-1 pr-1 pl-3 shadow-float transition-[opacity,translate] duration-pop ease-out data-[state=closed]:pointer-events-none data-[state=closed]:-translate-y-2 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity"
    >
      <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
      <input
        ref={input}
        value={state.query}
        onChange={(e) => onChange({ query: e.target.value, active: 0 })}
        onKeyDown={onKeyDown}
        dir="rtl"
        placeholder="Find on page"
        aria-label="Find on page"
        spellCheck={false}
        className="ar w-48 bg-transparent px-1 text-right text-ar-small outline-hidden placeholder:font-sans placeholder:text-sm placeholder:text-ink-3"
      />
      <span aria-live="polite" className={cx("min-w-14 shrink-0 text-center text-xs tabular-nums", hasQuery && count === 0 ? "text-danger" : "text-ink-3")}>
        {hasQuery ? (count === 0 ? "No matches" : `${arabicNumber(Math.min(state.active, count - 1) + 1)} ${LRM}/${LRM} ${arabicNumber(count)}`) : ""}
      </span>
      <OptionToggle label="Harakat" title="Match harakat exactly" on={options.matchHarakat} onToggle={() => onChange({ options: { ...options, matchHarakat: !options.matchHarakat }, active: 0 })} />
      <OptionToggle label="Whole word" title="Match whole words (و ف ب ل ك ال can still come before)" on={options.wholeWord} onToggle={() => onChange({ options: { ...options, wholeWord: !options.wholeWord }, active: 0 })} />
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton icon={ChevronUp} label={shortcutLabel("find.previous")} disabled={count === 0} onClick={() => onStep(-1)} />
      <IconButton icon={ChevronDown} label={shortcutLabel("find.next")} disabled={count === 0} onClick={() => onStep(1)} />
      <IconButton icon={X} label={shortcutLabel("find.close")} onClick={onClose} />
    </div>
  );
};
