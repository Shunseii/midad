import { RotateCcw, TextCursorInput } from "lucide-react";
import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";
import type { Part } from "../../../shared/annotations";
import { stripHarakat } from "../../../shared/arabic";
import type { Gloss } from "../../../shared/page";
import type { GlossMode } from "../lib/appearance";
import { attachment, type GlossBox, type Interval, layoutRow, type RowInput } from "../lib/gloss-layout";
import { shortcutKeys } from "../lib/keymap";
import { useKeybindings } from "../lib/use-keybindings";
import { cx } from "./ui";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** Glosses on the same words, merged so those words carry one label. Glosses that only overlap keep their own. */
export interface GlossRun {
  id: string;
  from: number;
  to: number;
  glosses: Gloss[];
}

export const glossRuns = ({ glosses, part, line }: { glosses: Gloss[]; part: Part; line: number }): GlossRun[] =>
  glosses
    .filter((g) => g.part === part && g.line === line)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .reduce<GlossRun[]>((runs, g) => {
      const last = runs.at(-1);
      if (last && g.from === last.from && g.to === last.to) last.glosses.push(g);
      else runs.push({ id: `${part}:${line}:${g.from}-${g.to}`, from: g.from, to: g.to, glosses: [g] });
      return runs;
    }, []);

export const runText = ({ run, showHarakat }: { run: GlossRun; showHarakat: boolean }) =>
  run.glosses.map((g) => (showHarakat ? g.text : stripHarakat(g.text)).replace(/\n/g, " ")).join(" ؛ ");

/** Gloss labels are set at this fraction of the text size, with this leading. */
const LABEL_SCALE = 0.5;
const LABEL_LEADING = 1.5;

export interface LabelPlacement {
  /** The word whose box the label hangs from: the run's last word on the row it attaches to. */
  anchor: number;
  /** From the anchor word's box. */
  left: number;
  /** From the top of the anchor's box (under the words) or its bottom (over them). */
  offset: number;
  slot: "below" | "above";
  width: number;
  lines: number;
}

export interface LineGlossLayout {
  labels: Record<string, LabelPlacement>;
  /** Room each anchor word asks of its row: above and below the baseline. */
  struts: Record<number, { up: number; down: number }>;
  labelSize: number;
}

const EMPTY: LineGlossLayout = { labels: {}, struts: {}, labelSize: 0 };

let canvas: CanvasRenderingContext2D | null = null;
const context = () => {
  canvas ??= document.createElement("canvas").getContext("2d");
  return canvas;
};

/** The width of a label on one line, and wrapped as evenly as it goes onto two (null for a single word). */
const labelWidths = ({ text, font }: { text: string; font: string }): { one: number; two: number | null } => {
  const ctx = context();
  if (!ctx) return { one: text.length * 8, two: null };
  ctx.font = font;
  const measure = (s: string) => ctx.measureText(s).width;
  const words = text.split(/\s+/).filter(Boolean);
  const one = Math.ceil(measure(text)) + 2;
  if (words.length < 2) return { one, two: null };
  let two = one;
  for (let i = 1; i < words.length; i += 1) {
    two = Math.min(two, Math.ceil(Math.max(measure(words.slice(0, i).join(" ")), measure(words.slice(i).join(" ")))) + 2);
  }
  return { one, two };
};

/** Screen rows of a line's words, top to bottom: each word's row index and box. */
const wordRows = (words: HTMLElement[]) => {
  const rows: { top: number; bottom: number }[] = [];
  const placed = words.map((el) => {
    const r = el.getBoundingClientRect();
    let row = rows.findIndex((x) => Math.abs(x.top - r.top) < r.height / 2);
    if (row === -1) {
      rows.push({ top: r.top, bottom: r.bottom });
      row = rows.length - 1;
    } else {
      rows[row]!.top = Math.min(rows[row]!.top, r.top);
      rows[row]!.bottom = Math.max(rows[row]!.bottom, r.bottom);
    }
    return { word: Number(el.dataset.w), row, box: { left: r.left, right: r.right } satisfies Interval };
  });
  return { rows, placed };
};

const same = (a: LineGlossLayout, b: LineGlossLayout) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lays out a line's interlinear glosses from where its words landed: per screen row, by the
 * rules in gloss-layout. Reruns when the line reflows (width, zoom, harakat, display toggles).
 * The labels and the room they need hang from word boxes, so laying them out never moves a word sideways.
 */
export const useGlossLayout = ({
  probe,
  part,
  line,
  runs,
  enabled,
  layoutKey,
}: {
  /** Any element directly inside the line's block. */
  probe: RefObject<HTMLElement | null>;
  part: Part;
  line: number;
  runs: GlossRun[];
  enabled: boolean;
  layoutKey: string;
}): LineGlossLayout => {
  const [layout, setLayout] = useState<LineGlossLayout>(EMPTY);
  const runsKey = runs.map((r) => `${r.from}-${r.to}:${r.glosses.map((g) => g.text).join("|")}`).join(",");

  useLayoutEffect(() => {
    const block = probe.current?.parentElement;
    if (!enabled || !block || runs.length === 0) {
      setLayout((prev) => (same(prev, EMPTY) ? prev : EMPTY));
      return;
    }
    const measure = () => {
      const words = [...block.querySelectorAll<HTMLElement>(`[data-part="${part}"][data-line="${line}"][data-w]`)];
      if (words.length === 0) return;
      const { rows, placed } = wordRows(words);
      const blockBox = block.getBoundingClientRect();
      const style = getComputedStyle(block);
      const fontSize = Number.parseFloat(style.fontSize);
      const labelSize = fontSize * LABEL_SCALE;
      const unit = labelSize * LABEL_LEADING;
      const gap = fontSize * 0.25;
      const gapV = fontSize * 0.08;
      const font = `${style.fontWeight} ${labelSize}px ${style.fontFamily}`;
      const ctx = context();
      let ascent = fontSize * 0.9;
      let descent = fontSize * 0.8;
      if (ctx) {
        ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
        const m = ctx.measureText("ب");
        ascent = m.fontBoundingBoxAscent;
        descent = m.fontBoundingBoxDescent;
      }

      // A raised footnote ref or a note's top corner takes space over the words; a note's bottom corner, under them.
      const obstacles = [...block.querySelectorAll<HTMLElement>("[data-footnote-ref], [data-note-corner]")].map((el) => ({
        box: el.getBoundingClientRect(),
        under: el.dataset.noteCorner === "end",
      }));
      const perRow = new Map<number, { input: RowInput; anchors: Map<string, number> }>();
      for (const run of runs) {
        const runWords = placed.filter((w) => w.word >= run.from && w.word <= run.to);
        const at = attachment(runWords);
        if (!at) continue;
        const entry = perRow.get(at.row) ?? (() => {
          const row = rows[at.row]!;
          const near = (r: DOMRect) => r.bottom >= row.top - fontSize * 0.5 && r.top <= row.bottom + fontSize * 0.5;
          const input: RowInput = {
            bounds: { left: blockBox.left, right: blockBox.right },
            glosses: [],
            obstacles: {
              below: obstacles.filter((o) => o.under && near(o.box)).map((o) => ({ left: o.box.left, right: o.box.right })),
              above: obstacles.filter((o) => !o.under && near(o.box)).map((o) => ({ left: o.box.left, right: o.box.right })),
            },
          };
          const created = { input, anchors: new Map<string, number>() };
          perRow.set(at.row, created);
          return created;
        })();
        const widths = labelWidths({ text: runText({ run, showHarakat: true }), font });
        const box: GlossBox = { id: run.id, base: at.base, width: widths.one, twoLineWidth: widths.two };
        entry.input.glosses.push(box);
        entry.anchors.set(run.id, Math.max(...runWords.filter((w) => w.row === at.row).map((w) => w.word)));
      }

      const next: LineGlossLayout = { labels: {}, struts: {}, labelSize };
      for (const [rowIndex, { input, anchors }] of perRow) {
        const result = layoutRow({ row: input, options: { gap, reach: fontSize * 1.6 } });
        const row = rows[rowIndex]!;
        const contentHeight = row.bottom - row.top;
        const strut = {
          up: result.above > 0 ? Math.ceil(ascent + gapV + result.above * unit) : 0,
          down: result.below > 0 ? Math.ceil(descent + gapV * 2 + result.below * unit) : 0,
        };
        for (const p of result.placed) {
          const anchor = anchors.get(p.id);
          const anchorEl = anchor === undefined ? null : words.find((w) => Number(w.dataset.w) === anchor)?.parentElement;
          if (anchor === undefined || !anchorEl) continue;
          const anchorBox = anchorEl.getBoundingClientRect();
          next.labels[p.id] = {
            anchor,
            left: Math.round((p.left - anchorBox.left) * 10) / 10,
            offset: Math.round((contentHeight + gapV + p.lane * unit) * 10) / 10,
            slot: p.slot,
            width: Math.ceil(p.width),
            lines: p.lines,
          };
          next.struts[anchor] = strut;
        }
      }
      setLayout((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(block);
    let live = true;
    void document.fonts.ready.then(() => live && measure());
    return () => {
      live = false;
      observer.disconnect();
    };
    // runs is described by runsKey.
  }, [probe, part, line, runsKey, enabled, layoutKey]);

  return enabled ? layout : EMPTY;
};

/** The zero-width box that gives a row the room its glosses take, without moving any word sideways. */
export const GlossStrut = ({ room }: { room: { up: number; down: number } | undefined }) => (
  <span
    aria-hidden
    data-overlay
    data-gloss-strut
    className="pointer-events-none inline-block w-0 select-none"
    style={{ height: room ? room.up + room.down : 0, verticalAlign: room ? -room.down : 0 }}
  />
);

export interface GlossActions {
  correct: (input: { run: GlossRun; from: number; to: number }) => void;
  reset: (input: { run: GlossRun }) => void;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * A gloss printed small under (or over) its words. Hovering it tints its words; hovering
 * the words inks it. Clicking it offers to adjust which words it explains.
 */
export const GlossLabel = ({
  run,
  text,
  mode,
  placement,
  labelSize,
  active,
  onHover,
  onAdjust,
  onReset,
}: {
  run: GlossRun;
  text: string;
  mode: GlossMode;
  placement: LabelPlacement | undefined;
  labelSize: number;
  /** Its words or the label itself are hovered, or its words are being adjusted. */
  active: boolean;
  onHover: (hovered: boolean) => void;
  onAdjust: () => void;
  onReset: () => void;
}) => {
  const [menu, setMenu] = useState(false);
  const corrected = run.glosses.some((g) => g.book);
  const floating = mode === "hover";
  if (!floating && !placement) return null;
  if (floating && !active && !menu) return null;
  const style: CSSProperties = floating
    ? { top: "calc(100% + 0.15em)", right: 0 }
    : {
        left: placement!.left,
        width: placement!.width,
        fontSize: labelSize,
        lineHeight: LABEL_LEADING,
        ...(placement!.slot === "below" ? { top: placement!.offset } : { bottom: placement!.offset }),
      };
  return (
    <Popover open={menu} onOpenChange={setMenu}>
      <PopoverTrigger
        nativeButton={false}
        aria-label={`Gloss: ${text}`}
        onMouseDown={stop}
        onMouseUp={stop}
        onClick={stop}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        render={
          <span
            data-overlay
            data-gloss-label={run.id}
            data-gloss-words={`${run.from}-${run.to}`}
            dir="rtl"
            style={style}
            className={cx(
              "gloss-label",
              floating ? "gloss-label-floating" : placement!.lines > 1 ? "whitespace-normal text-balance" : "whitespace-nowrap",
              (active || menu) && "gloss-label-active",
            )}
          />
        }
      >
        {text}
      </PopoverTrigger>
      <PopoverContent side="bottom" sideOffset={6} onMouseDown={stop} onMouseUp={stop} onClick={stop} className="w-max min-w-44 gap-0.5 p-1">
        <button
          type="button"
          onClick={() => {
            setMenu(false);
            onAdjust();
          }}
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink transition-colors duration-press hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <TextCursorInput aria-hidden className="size-4 text-ink-3" />
          Adjust words
        </button>
        {corrected && (
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onReset();
            }}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink transition-colors duration-press hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <RotateCcw aria-hidden className="size-4 text-ink-3" />
            Reset to the book's words
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
};

export interface AdjustState {
  run: string;
  from: number;
  to: number;
}

/** The word under a point on this line, if any. */
const wordAt = ({ x, y, part, line }: { x: number; y: number; part: Part; line: number }): number | null => {
  for (const el of document.elementsFromPoint(x, y)) {
    const word = el.closest<HTMLElement>("[data-w]");
    if (word && word.dataset.part === part && Number(word.dataset.line) === line) return Number(word.dataset.w);
  }
  return null;
};

/**
 * One end of the words a gloss is being moved to: a bar with a knob, dragged across the
 * line's words. The start end sits at the first word's leading edge, the end at the last's.
 */
export const AdjustHandle = ({
  edge,
  part,
  line,
  adjust,
  onChange,
}: {
  edge: "start" | "end";
  part: Part;
  line: number;
  adjust: AdjustState;
  onChange: (next: AdjustState) => void;
}) => (
  <span
    data-overlay
    data-gloss-handle={edge}
    role="slider"
    aria-label={edge === "start" ? "First word of the gloss" : "Last word of the gloss"}
    aria-valuenow={edge === "start" ? adjust.from : adjust.to}
    onMouseDown={stop}
    onMouseUp={stop}
    onClick={stop}
    onPointerDown={(e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={(e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const word = wordAt({ x: e.clientX, y: e.clientY, part, line });
      if (word === null) return;
      const other = edge === "start" ? adjust.to : adjust.from;
      const from = Math.min(word, other);
      const to = Math.max(word, other);
      if (from !== adjust.from || to !== adjust.to) onChange({ ...adjust, from, to });
    }}
    onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    className={cx("gloss-handle", edge === "start" ? "gloss-handle-start" : "gloss-handle-end")}
  />
);

/** Save and cancel for adjusting a gloss's words, with Enter and Esc from the keymap. */
export const AdjustBar = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => {
  useKeybindings({ scope: "popover", handlers: { "gloss.saveWords": () => onSave(), "gloss.cancelWords": () => onCancel() } });
  return (
    <span
      data-overlay
      data-gloss-adjust-bar
      dir="ltr"
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      className="gloss-adjust-bar absolute top-[calc(100%+0.3em)] left-0 z-20 flex select-none items-center gap-1 whitespace-nowrap rounded-lg bg-surface-3 p-1 font-sans text-xs text-ink-2 shadow-float"
    >
      <span className="px-1.5">Drag the ends to the gloss's words</span>
      <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 transition-colors duration-press hover:bg-ink/5 hover:text-ink">
        Cancel <span className="text-ink-3">{shortcutKeys("gloss.cancelWords")}</span>
      </button>
      <button type="button" onClick={onSave} className="rounded-md bg-accent px-2 py-1 text-on-accent transition-opacity duration-press hover:opacity-90">
        Save <span className="opacity-70">{shortcutKeys("gloss.saveWords")}</span>
      </button>
    </span>
  );
};
