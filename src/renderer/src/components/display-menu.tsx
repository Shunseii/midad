import { Minus, Plus, Type } from "lucide-react";
import type { ReactNode } from "react";
import type { Theme } from "../../../shared/ipc";
import { type HighlightStyle, type PageWidth, useFocusMode, useHighlightStyle, usePageWidth, useTheme } from "../lib/appearance";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IconButton, Kbd, Segmented, Switch, cx } from "./ui";

/** The text sizes the reader steps through, as multiples of the normal size. */
export const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75, 2];
export const SMALLEST = 0.875;
export const LARGEST = 2;
/** Wheel distance per text size step; one mouse notch is usually 100. */
export const WHEEL_STEP = 100;
export const ZOOM_SHOWN_MS = 1200;

/** The text size, shown for a moment under the top bar after a shortcut changes it. */
export const ZoomLevel = ({ scale, shown }: { scale: number; shown: boolean }) => (
  <div
    role="status"
    data-state={shown ? "open" : "closed"}
    className="pointer-events-none fixed top-18 right-4 z-30 flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 text-sm shadow-float transition-[opacity,translate] duration-pop ease-out data-[state=closed]:-translate-y-1 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity"
  >
    <Type aria-hidden className="size-4 text-ink-3" />
    <span className="text-ink-2">Text size</span>
    <span className="font-medium tabular-nums">{Math.round(scale * 100)}%</span>
  </div>
);

export const stepScale = ({ scale, by }: { scale: number; by: 1 | -1 }) => {
  const at = TEXT_SCALES.findIndex((s) => s >= scale);
  const index = Math.min(Math.max((at === -1 ? TEXT_SCALES.length - 1 : at) + by, 0), TEXT_SCALES.length - 1);
  return TEXT_SCALES[index] ?? 1;
};

const Row = ({
  title,
  hint,
  shortcut,
  stacked = false,
  children,
}: {
  title: string;
  hint: ReactNode;
  shortcut?: string;
  /** Puts the control on its own line under the title, for wider controls. */
  stacked?: boolean;
  children: ReactNode;
}) => (
  <div className={cx("flex gap-3", stacked ? "flex-col items-start gap-2" : "items-center")}>
    <div className="flex flex-1 flex-col gap-0.5 self-stretch">
      <span className="flex items-center gap-2 text-sm font-medium">
        {title}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
      <span className="text-xs text-ink-3">{hint}</span>
    </div>
    {children}
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-3.5">
    <h3 className="text-overline font-semibold uppercase tracking-widest text-ink-3">{title}</h3>
    {children}
  </section>
);

const TextSize = ({ scale, onScale }: { scale: number; onScale: (v: number) => void }) => (
  <Row title="Text size" hint="The page's Arabic text" shortcut="Ctrl ±">
    <div className="flex items-center gap-1">
      <IconButton icon={Minus} label="Smaller text (Ctrl+−)" disabled={scale <= SMALLEST} onClick={() => onScale(stepScale({ scale, by: -1 }))} />
      <button
        type="button"
        title="Reset to normal size (Ctrl+0)"
        onClick={() => onScale(1)}
        className="w-12 rounded-md py-1 text-center text-sm tabular-nums text-ink-2 transition-colors duration-press hover:bg-ink/6"
      >
        {Math.round(scale * 100)}%
      </button>
      <IconButton icon={Plus} label="Larger text (Ctrl+=)" disabled={scale >= LARGEST} onClick={() => onScale(stepScale({ scale, by: 1 }))} />
    </div>
  </Row>
);

/** The reader's display settings, opening from the Aa button in the top bar. */
export const DisplayMenu = ({
  open,
  onOpenChange,
  textScale,
  onTextScale,
  lineNumbers,
  onLineNumbers,
  showHarakat,
  onShowHarakat,
  showMine,
  onShowMine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textScale: number;
  onTextScale: (v: number) => void;
  lineNumbers: boolean;
  onLineNumbers: (v: boolean) => void;
  showHarakat: boolean;
  onShowHarakat: (v: boolean) => void;
  showMine: boolean;
  onShowMine: (v: boolean) => void;
}) => {
  const [theme, setTheme] = useTheme();
  const [pageWidth, setPageWidth] = usePageWidth();
  const [focusMode, setFocusMode] = useFocusMode();
  const [highlightStyle, setHighlightStyle] = useHighlightStyle();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<IconButton icon={Type} label="Text display" selected={open} />} />
      <PopoverContent side="bottom" align="end" sideOffset={8} className="w-84 gap-5 p-4">
        <Section title="Appearance">
          <Row title="Theme" hint="Follow the system or choose one" stacked>
            <Segmented label="Theme" value={theme} onChange={setTheme} options={THEMES} />
          </Row>
          <Row title="Page width" hint={pageWidth === "narrow" ? "Justified, a shorter line" : "Longer lines, ragged edge"} stacked>
            <Segmented label="Page width" value={pageWidth} onChange={setPageWidth} options={PAGE_WIDTHS} />
          </Row>
          <Row title="Highlight style" hint={highlightStyle === "under" ? "A band under the letters" : "A fill behind the whole word"} stacked>
            <Segmented label="Highlight style" value={highlightStyle} onChange={setHighlightStyle} options={HIGHLIGHT_STYLES} />
          </Row>
          <Row title="Focus mode" hint="Hide the bars while you read">
            <Switch label="Focus mode" checked={focusMode} onChange={setFocusMode} />
          </Row>
        </Section>
        <div className="h-px bg-line" />
        <Section title="Text">
          <TextSize scale={textScale} onScale={onTextScale} />
          <Row title="Harakat" hint="The corpus's marks and yours" shortcut="H">
            <Switch label="Show harakat" checked={showHarakat} onChange={onShowHarakat} />
          </Row>
          <div className={cx("ml-1 border-l-2 border-line pl-3", !showHarakat && "opacity-45")}>
            <Row title="My harakat" hint={<>Marks you added, in <span className="text-ink-added">red</span></>}>
              <Switch label="Show my harakat" checked={showMine} onChange={onShowMine} disabled={!showHarakat} />
            </Row>
          </div>
          <Row title="Line numbers" hint="The numbers notes and Ask AI use">
            <Switch label="Show line numbers" checked={lineNumbers} onChange={onLineNumbers} />
          </Row>
        </Section>
        <p className="text-xs text-ink-3">
          Click a letter and type a haraka with the Arabic keyboard layout. Your marks are stored separately; the corpus text is never changed.
        </p>
      </PopoverContent>
    </Popover>
  );
};

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const HIGHLIGHT_STYLES: { value: HighlightStyle; label: string }[] = [
  { value: "under", label: "Under text" },
  { value: "behind", label: "Behind text" },
];

const PAGE_WIDTHS: { value: PageWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
];
