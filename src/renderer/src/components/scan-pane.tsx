import { X, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useState } from "react";
import { IconButton, Skeleton, cx } from "./ui";

/** The page's original scan, beside the text. Fetched from the corpus the first time, then cached. */
export const ScanPane = ({ bookId, fileId, onClose }: { bookId: string; fileId: string; onClose: () => void }) => {
  const [loaded, setLoaded] = useState<{ fileId: string; ok: boolean } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const state = loaded?.fileId === fileId ? (loaded.ok ? "ready" : "error") : "loading";
  const src = `midad-scan://scan/${encodeURIComponent(bookId)}/${encodeURIComponent(fileId)}`;

  return (
    <section aria-label="Page scan" className="flex min-w-0 flex-1 flex-col border-l border-line bg-surface-2">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-4">
        <h2 className="text-overline font-semibold uppercase tracking-widest text-ink-3">Scan</h2>
        <span className="flex-1" />
        <IconButton icon={zoomed ? ZoomOut : ZoomIn} label={zoomed ? "Fit to width" : "Actual size"} onClick={() => setZoomed(!zoomed)} />
        <IconButton icon={X} label="Hide scan" onClick={onClose} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        {state === "loading" && <Skeleton className="absolute inset-x-4 top-4 aspect-[2/3]" />}
        {state === "error" && (
          <p className="py-12 text-center text-sm text-ink-3">
            Couldn't load this scan. The first time you view a page's scan, Midad needs the corpus connection.
          </p>
        )}
        <img
          key={fileId}
          src={src}
          alt="Scan of this page"
          onLoad={() => setLoaded({ fileId, ok: true })}
          onError={() => setLoaded({ fileId, ok: false })}
          onClick={() => setZoomed(!zoomed)}
          className={cx(
            "rounded-md shadow-sm transition-opacity duration-pop ease-out",
            zoomed ? "max-w-none cursor-zoom-out" : "h-auto w-full cursor-zoom-in",
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
