import { Bookmark as BookmarkIcon, Pencil, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { stripHarakat } from "../../../shared/arabic";
import type { Bookmark, PageSummary } from "../../../shared/library";
import { bookmarkFolio, openingLines } from "../lib/bookmarks";
import { timeAgo } from "../lib/format";
import { usePagePreview } from "../lib/midad";
import { Button, cx, IconButton, Kbd } from "./ui";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** Resting on a row this long opens its preview, so moving down the list doesn't flash a card per row. */
const PREVIEW_DELAY_MS = 350;

const NameInput = ({
  initial,
  onSave,
  onCancel,
  className,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) => {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(value);
    else onCancel();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  };
  return (
    <Input
      autoFocus
      dir="rtl"
      aria-label="Bookmark name"
      placeholder="Name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      className={cx("ar h-8 text-right text-ar-small", className)}
    />
  );
};

/**
 * One bookmark: its page and its name, if it has one. Rename and delete keep
 * their own slot at the row's end, so showing them never moves the text.
 */
export const BookmarkRow = ({
  folio,
  name,
  current = false,
  renaming = false,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  onHoverChange,
}: {
  folio: string;
  name: string | null;
  current?: boolean;
  renaming?: boolean;
  onOpen: () => void;
  onStartRename?: () => void;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  onDelete?: () => void;
  /** The row's element while the pointer rests on it, else null. */
  onHoverChange?: (row: HTMLElement | null) => void;
}) => {
  const hasActions = onStartRename !== undefined || onDelete !== undefined;
  return (
    <div
      role="listitem"
      data-bookmark-row
      onMouseEnter={(e) => onHoverChange?.(e.currentTarget)}
      onMouseLeave={() => onHoverChange?.(null)}
      className={cx(
        "group/row flex min-h-9 items-center gap-1.5 rounded-lg py-0.5 pr-2.5 pl-0.5 transition-colors duration-press ease-out starting:opacity-0",
        current ? "bg-accent-soft" : "hover:bg-ink/5",
        hasActions ? "" : "pl-2.5",
      )}
    >
      {hasActions && (
        <div
          className={cx(
            "flex w-16.5 shrink-0 items-center gap-0.5 transition-opacity duration-press ease-out group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none",
            renaming ? "opacity-100" : "opacity-0",
          )}
        >
          {onStartRename && <IconButton icon={Pencil} label="Rename" onClick={onStartRename} />}
          {onDelete && <IconButton icon={Trash2} label="Delete bookmark" onClick={onDelete} />}
        </div>
      )}
      {renaming && onRename && onCancelRename ? (
        <div dir="rtl" className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cx("ar min-w-8 shrink-0 text-right text-ar-small leading-7", current ? "text-accent" : "text-ink-2")}>{folio}</span>
          <NameInput initial={name ?? ""} onSave={onRename} onCancel={onCancelRename} className="flex-1" />
        </div>
      ) : (
        <button type="button" dir="rtl" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md py-1 text-right outline-none focus-visible:outline-2 focus-visible:outline-accent">
          <span className={cx("ar min-w-8 shrink-0 text-ar-small leading-6", current ? "text-accent" : "text-ink-2")}>{folio}</span>
          {name && <span className={cx("ar line-clamp-2 min-w-0 flex-1 text-ar-small leading-6 font-medium", current ? "text-accent" : "text-ink")}>{name}</span>}
        </button>
      )}
    </div>
  );
};

/** The card beside the list while the pointer rests on a row: the page's opening lines and when it was bookmarked. */
const BookmarkPreview = ({
  bookId,
  target,
  folio,
  showHarakat,
}: {
  bookId: string;
  target: { bookmark: Bookmark; row: HTMLElement } | null;
  folio: (position: number) => string;
  showHarakat: boolean;
}) => {
  // Keep the last bookmark shown so the card can fade out with its content.
  const last = useRef<{ bookmark: Bookmark; top: number; left: number } | null>(null);
  if (target) {
    const row = target.row.getBoundingClientRect();
    const rail = target.row.closest("nav")?.getBoundingClientRect() ?? row;
    last.current = { bookmark: target.bookmark, top: row.top - 4, left: rail.right + 8 };
  }
  const shown = last.current;
  const page = usePagePreview({ bookId, position: shown?.bookmark.position ?? 1, enabled: target !== null });
  if (!shown) return null;
  const lines = page.data ? openingLines({ page: page.data.page }) : [];
  const t = (s: string) => (showHarakat ? s : stripHarakat(s));
  return createPortal(
    <div
      aria-hidden
      data-bookmark-preview
      data-state={target ? "open" : "closed"}
      style={{ top: shown.top, left: shown.left }}
      className="pointer-events-none fixed z-40 flex w-85 origin-left flex-col gap-2 rounded-xl bg-surface-3 px-4 py-3 shadow-float transition-[opacity,scale,translate] duration-pop ease-out starting:-translate-x-1 starting:scale-96 starting:opacity-0 data-[state=closed]:-translate-x-1 data-[state=closed]:scale-96 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity motion-reduce:starting:translate-x-0 motion-reduce:starting:scale-100"
    >
      <div dir="rtl" className="flex items-baseline gap-2.5">
        <span className="ar text-ar-body leading-7 font-bold whitespace-nowrap text-ink">{folio(shown.bookmark.position)}</span>
        {shown.bookmark.name && <span className="ar truncate text-ar-small font-medium text-accent">{shown.bookmark.name}</span>}
      </div>
      {page.isPending ? (
        <div className="flex flex-col gap-2 py-1">
          <span className="h-3 w-full animate-pulse rounded bg-ink/8" />
          <span className="h-3 w-4/5 self-end animate-pulse rounded bg-ink/8" />
        </div>
      ) : lines.length > 0 ? (
        <p dir="rtl" className="ar line-clamp-3 text-right text-ar-small leading-7.5 text-ink-2">
          {lines.map(t).join(" ")}
        </p>
      ) : (
        <p className="text-xs text-ink-3">This page has no main text.</p>
      )}
      <span className="text-xs text-ink-3">Added {timeAgo(shown.bookmark.createdAt)}</span>
    </div>,
    document.body,
  );
};

/** The book's bookmarks in page order, with a preview on hover and rename and delete in place. */
export const BookmarkList = ({
  bookId,
  bookmarks,
  pages,
  current,
  showHarakat,
  onOpen,
  onRename,
  onDelete,
}: {
  bookId: string;
  bookmarks: Bookmark[];
  pages: PageSummary[];
  current: number;
  showHarakat: boolean;
  onOpen: (position: number) => void;
  onRename: (input: { bookmark: Bookmark; name: string }) => void;
  onDelete: (bookmark: Bookmark) => void;
}) => {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [hovered, setHovered] = useState<{ bookmark: Bookmark; row: HTMLElement } | null>(null);
  const [previewed, setPreviewed] = useState<{ bookmark: Bookmark; row: HTMLElement } | null>(null);
  useEffect(() => {
    if (!hovered || renaming !== null) {
      setPreviewed(null);
      return;
    }
    const timer = setTimeout(() => setPreviewed(hovered), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hovered, renaming]);
  const folio = (position: number) => bookmarkFolio({ position, pages });

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-3 py-12 text-center starting:opacity-0 transition-opacity duration-pop ease-out motion-reduce:transition-none">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface">
          <BookmarkIcon aria-hidden className="size-5 text-ink-3" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-semibold">No bookmarks yet</span>
          <span className="text-xs text-ink-3">Bookmark a page to come back to it later.</span>
        </span>
        <span className="flex gap-1 text-xs text-ink-3">
          <Kbd>Ctrl</Kbd>
          <Kbd>D</Kbd>
        </span>
      </div>
    );
  }

  return (
    <>
      <div role="list" aria-label="Bookmarks" className="flex flex-col gap-0.5">
        {bookmarks.map((b) => (
          <BookmarkRow
            key={b.position}
            folio={folio(b.position)}
            name={b.name}
            current={b.position === current}
            renaming={renaming === b.position}
            onOpen={() => onOpen(b.position)}
            onStartRename={() => setRenaming(b.position)}
            onRename={(name) => {
              setRenaming(null);
              onRename({ bookmark: b, name });
            }}
            onCancelRename={() => setRenaming(null)}
            onDelete={() => {
              setHovered(null);
              onDelete(b);
            }}
            onHoverChange={(row) => setHovered(row ? { bookmark: b, row } : null)}
          />
        ))}
      </div>
      <p className="mt-auto px-2.5 pt-4 text-xs text-ink-3">Ctrl+D bookmarks the page you're on.</p>
      <BookmarkPreview bookId={bookId} target={previewed} folio={folio} showHarakat={showHarakat} />
    </>
  );
};

/**
 * The ribbon hanging into the page's top corner on a bookmarked page. It drops
 * in when the page is bookmarked and slides back up when the bookmark goes;
 * clicking it opens the bookmark's name and a way to remove it.
 */
export const BookmarkRibbon = ({
  bookmark,
  folio,
  onRename,
  onRemove,
}: {
  bookmark: Bookmark | null;
  folio: string;
  onRename: (name: string) => void;
  onRemove: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const on = bookmark !== null;
  useEffect(() => {
    if (!on) setOpen(false);
  }, [on]);
  const save = () => {
    setOpen(false);
    if (bookmark && draft.trim() !== (bookmark.name ?? "")) onRename(draft);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(bookmark?.name ?? "");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            data-bookmark-ribbon
            data-state={on ? "on" : "off"}
            aria-label="Edit bookmark"
            aria-hidden={!on}
            tabIndex={on ? 0 : -1}
            className="absolute -top-10 -left-9 z-2 h-14 w-4 cursor-pointer bg-accent transition-[translate,height,opacity] duration-sweep ease-out [clip-path:polygon(0_0,100%_0,100%_100%,50%_calc(100%-7px),0_100%)] hover:h-16 data-[state=off]:pointer-events-none data-[state=off]:-translate-y-full data-[state=off]:opacity-0 data-[state=off]:duration-panel-exit data-[state=off]:ease-in motion-reduce:transition-opacity motion-reduce:data-[state=off]:translate-y-0 motion-reduce:data-[state=off]:opacity-0"
          />
        }
      />
      <PopoverContent side="bottom" align="start" className="w-80 gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Bookmark</span>
          <span className="flex-1" />
          <span className="ar text-ar-small text-ink-3">{folio}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Input
            autoFocus
            dir="rtl"
            aria-label="Bookmark name"
            placeholder="Name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="ar text-right text-ar-small"
          />
          <p className="text-xs text-ink-3">Optional.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={save}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
