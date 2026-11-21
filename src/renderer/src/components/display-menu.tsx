import { ArrowRight, Minus, Plus, Settings2, Type } from "lucide-react";
import { useNavigate } from "react-router";
import { type ReactNode, useRef } from "react";
import type { Theme } from "../../../shared/ipc";
import { type PageWidth, useFocusMode, usePageWidth, useTheme } from "../lib/appearance";
import { usePref } from "../lib/prefs";
import type { BookReturn, SettingsState } from "../routes/settings";
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

/** The reader's everyday display settings, opening from the Display button in the top bar. The rest live in Settings. */
export const DisplayMenu = ({
  open,
  onOpenChange,
  textScale,
  onTextScale,
  bookReturn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textScale: number;
  onTextScale: (v: number) => void;
  /** Where the reader is now, so Settings can offer a way back. */
  bookReturn: () => BookReturn | undefined;
}) => {
  const [theme, setTheme] = useTheme();
  const [pageWidth, setPageWidth] = usePageWidth();
  const focusMode = useFocusMode();
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [glossMarkers, setGlossMarkers] = usePref({ key: "reader.glossMarkers", fallback: true });
  const [hashiyaMarkers, setHashiyaMarkers] = usePref({ key: "reader.hashiyaMarkers", fallback: true });
  const navigate = useNavigate();
  // Opening focuses the menu itself: on the first control, Text size's tooltip would open and take the first Esc.
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<IconButton icon={Settings2} label="Display" selected={open} />} />
      <PopoverContent ref={popup} initialFocus={popup} side="bottom" align="end" sideOffset={8} className="w-80 gap-4 p-0 pt-4 [view-transition-name:display-menu]">
        <div className="flex flex-col gap-4 px-4">
          <TextSize scale={textScale} onScale={onTextScale} />
          <Row title="Harakat" hint="The corpus's marks and yours" shortcut="H">
            <Switch label="Show harakat" checked={showHarakat} onChange={setShowHarakat} />
          </Row>
          <Row title="Gloss markers" hint="Rings after words with an interlinear gloss">
            <Switch label="Show gloss markers" checked={glossMarkers} onChange={setGlossMarkers} />
          </Row>
          <Row title="Hashiya markers" hint="Footnote numbers in the text">
            <Switch label="Show hashiya markers" checked={hashiyaMarkers} onChange={setHashiyaMarkers} />
          </Row>
          <Row title="Theme" hint="Follow the system or choose one" stacked>
            <Segmented label="Theme" value={theme} onChange={setTheme} options={THEMES} />
          </Row>
          <Row title="Page width" hint={pageWidth === "narrow" ? "Justified, a shorter line" : "Longer lines, ragged edge"} stacked>
            <Segmented label="Page width" value={pageWidth} onChange={setPageWidth} options={PAGE_WIDTHS} />
          </Row>
          <Row title="Focus mode" hint={focusMode.kind === "locked" ? "Locked: hidden until Esc or F" : "Hide the bars while you read"} shortcut="F">
            <Switch label="Focus mode" checked={focusMode.choice !== "off"} onChange={focusMode.toggle} />
          </Row>
        </div>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            void navigate("/settings", { state: { section: "appearance", from: bookReturn() } satisfies SettingsState, viewTransition: true });
          }}
          className="flex items-center justify-between rounded-b-xl border-t border-line px-4 py-3 text-sm text-ink-2 transition-colors duration-press hover:bg-ink/4 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          All settings…
          <ArrowRight aria-hidden className="size-4 text-ink-3" />
        </button>
      </PopoverContent>
    </Popover>
  );
};

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];


const PAGE_WIDTHS: { value: PageWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
];
