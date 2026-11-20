import { X, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
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
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state === "loading" && <Skeleton className="aspect-[2/3] w-full" />}
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
            "rounded-md shadow-sm",
            zoomed ? "max-w-none cursor-zoom-out" : "h-auto w-full cursor-zoom-in",
            state !== "ready" && "hidden",
          )}
        />
      </div>
    </section>
  );
};
