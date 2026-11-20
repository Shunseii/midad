import { Minus, Plus, Type } from "lucide-react";
import { IconButton, Kbd, Switch, cx } from "./ui";

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

export const TextSize = ({ scale, onScale }: { scale: number; onScale: (v: number) => void }) => (
  <div className="flex items-center gap-3">
    <div className="flex flex-1 flex-col gap-0.5">
      <span className="text-sm font-medium">Text size</span>
      <span className="text-xs text-ink-3">The page's Arabic text</span>
    </div>
    <div className="flex items-center gap-1">
      <IconButton icon={Minus} label="Smaller text (Ctrl+−)" disabled={scale <= SMALLEST} onClick={() => onScale(stepScale({ scale, by: -1 }))} />
      <button
        type="button"
        title="Reset to normal size (Ctrl+0)"
        onClick={() => onScale(1)}
        className="w-12 rounded-md py-1 text-center text-sm tabular-nums text-ink-2 hover:bg-ink/6"
      >
        {Math.round(scale * 100)}%
      </button>
      <IconButton icon={Plus} label="Larger text (Ctrl+=)" disabled={scale >= LARGEST} onClick={() => onScale(stepScale({ scale, by: 1 }))} />
    </div>
  </div>
);

export const DisplayMenu = ({
  textScale,
  onTextScale,
  lineNumbers,
  onLineNumbers,
  showHarakat,
  onShowHarakat,
  showMine,
  onShowMine,
}: {
  textScale: number;
  onTextScale: (v: number) => void;
  lineNumbers: boolean;
  onLineNumbers: (v: boolean) => void;
  showHarakat: boolean;
  onShowHarakat: (v: boolean) => void;
  showMine: boolean;
  onShowMine: (v: boolean) => void;
}) => (
  <div className="absolute right-0 top-11 z-40 flex w-80 flex-col gap-3.5 rounded-xl bg-surface-3 p-4 shadow-float">
    <span className="text-sm font-medium">Text display</span>
    <TextSize scale={textScale} onScale={onTextScale} />
    <div className="flex items-center gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Harakat</span>
        <span className="text-xs text-ink-3">The corpus's marks and yours</span>
      </div>
      <Kbd>H</Kbd>
      <Switch label="Show harakat" checked={showHarakat} onChange={onShowHarakat} />
    </div>
    <div className={cx("ml-1 flex items-center gap-3 border-l-2 border-line pl-3", !showHarakat && "opacity-45")}>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">My harakat</span>
        <span className="text-xs text-ink-3">
          Marks you added, in <span className="text-ink-added">red</span>
        </span>
      </div>
      <Switch label="Show my harakat" checked={showMine} onChange={onShowMine} disabled={!showHarakat} />
    </div>
    <div className="flex items-center gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Line numbers</span>
        <span className="text-xs text-ink-3">The numbers notes and Ask AI use</span>
      </div>
      <Switch label="Show line numbers" checked={lineNumbers} onChange={onLineNumbers} />
    </div>
    <div className="h-px bg-line" />
    <p className="text-xs text-ink-3">
      Click a letter and type a haraka with the Arabic keyboard layout. Your marks are stored separately; the corpus text is never changed.
    </p>
  </div>
);
