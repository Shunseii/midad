import { Menu } from "@base-ui/react/menu";
import { BookOpen, Download, Ellipsis, Pin, PinOff, RefreshCw, Search, Trash2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button as ButtonBase } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { LibraryBook } from "../../../shared/library";
import { BookCover, markOpeningCover, useClosingCover } from "../components/book-cover";
import { ImportDialog } from "../components/import-dialog";
import { RemoveBookDialog } from "../components/remove-book-dialog";
import { SyncDialog } from "../components/sync-dialog";
import { Button, cx, IconButton, Progress, Segmented, Skeleton, TextField, Toast } from "../components/ui";
import { plural, timeAgo } from "../lib/format";
import { WaitingBooks } from "../components/waiting-books";
import { keys, useLibrary, useSetPinned, useSettings, useWaitingBooks } from "../lib/midad";
import { switchListInTransition } from "../lib/view-transition";

type Shelf = "all" | "reading" | "finished";

const SHELVES: { value: Shelf; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
];

const isFinished = (b: LibraryBook) => b.progress !== null && b.progress.position >= b.pageCount;

/** How long a removed book's card takes to fold away before the shelf drops it (duration-panel-exit). */
const FOLD_MS = 180;

/** The longest a pin's view transition waits for the reordered shelf before it plays anyway. */
const REORDER_WAIT_MS = 1000;

/**
 * Runs a change that reorders the shelf inside a view transition, so each card glides to its new
 * place (see "Reordering the shelf" in styles.css). The new snapshot is taken once the refetched
 * books have rendered.
 */
const useShelfReorder = (books: LibraryBook[]) => {
  const rendered = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    rendered.current?.();
    rendered.current = null;
  }, [books]);
  return (change: () => Promise<unknown>): Promise<unknown> => {
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
    const root = document.documentElement;
    root.dataset.reorder = "library";
    let result: Promise<unknown> = Promise.resolve();
    const transition = document.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          rendered.current = resolve;
          result = change();
          result.catch(() => resolve());
          setTimeout(resolve, REORDER_WAIT_MS);
        }),
    );
    void transition.finished.finally(() => delete root.dataset.reorder);
    return transition.updateCallbackDone.then(() => result);
  };
};

const MENU_ITEM = "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-hidden transition-colors duration-press ease-out select-none data-highlighted:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0";

/** A book's actions, from the button on its card. */
interface BookActions {
  onTogglePin: () => void;
  onSync: () => void;
  onRemove: () => void;
}

const BookMenu = ({ book, onTogglePin, onSync, onRemove }: BookActions & { book: LibraryBook }) => (
  <Menu.Root modal={false}>
    <Menu.Trigger
      render={<ButtonBase variant="outline" size="icon" aria-label={`Actions for ${book.title}`} data-book-actions />}
      className="absolute top-3 right-3 text-ink-2 opacity-0 transition-opacity duration-press ease-out group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 data-popup-open:opacity-100"
    >
      <Ellipsis />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50">
        <Menu.Popup
          aria-label="Book actions"
          className="flex w-55 origin-(--transform-origin) flex-col gap-0.5 rounded-xl bg-surface-3 p-1 text-ink shadow-float outline-hidden duration-pop ease-out data-closed:duration-pop-exit data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100"
        >
          <Menu.Item onClick={onTogglePin} data-pin-item className={cx(MENU_ITEM, "[&_svg]:text-ink-2")}>
            {book.pinnedAt === null ? <Pin aria-hidden /> : <PinOff aria-hidden />}
            {book.pinnedAt === null ? "Pin to top" : "Unpin"}
          </Menu.Item>
          <Menu.Item onClick={onSync} className={cx(MENU_ITEM, "[&_svg]:text-ink-2")}>
            <RefreshCw aria-hidden />
            Sync with corpus…
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item onClick={onRemove} data-remove-book-item className={cx(MENU_ITEM, "text-danger")}>
            <Trash2 aria-hidden />
            Remove book…
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);

const BookCard = ({ book, leaving, onTogglePin, onSync, onRemove }: BookActions & { book: LibraryBook; leaving: boolean }) => {
  const position = book.progress?.position ?? 0;
  const pinned = book.pinnedAt !== null;
  return (
    <div
      data-book={book.bookId}
      data-shelf-card
      data-pinned={pinned || undefined}
      data-state={leaving ? "leaving" : undefined}
      className="group relative flex flex-col gap-3 transition-[opacity,scale] duration-panel-exit ease-out data-[state=leaving]:scale-95 data-[state=leaving]:opacity-0 motion-reduce:data-[state=leaving]:scale-100"
    >
      <Link
        to={`/read/${book.bookId}`}
        viewTransition
        aria-label={book.title}
        onClick={(e) => markOpeningCover(e.currentTarget)}
        className="rounded-md transition-[translate,box-shadow] duration-pop ease-out group-hover:-translate-y-0.5 group-hover:shadow-float active:scale-99 motion-reduce:group-hover:translate-y-0"
      >
        <BookCover title={book.title} author={[book.author, book.edition].filter(Boolean).join(" · ") || null} size="sm" />
      </Link>
      <IconButton
        icon={Pin}
        label={pinned ? "Unpin" : "Pin to top"}
        variant="outline"
        selected={pinned}
        aria-label={`Pin ${book.title}`}
        aria-pressed={pinned}
        data-pin-toggle
        onClick={onTogglePin}
        className={cx(
          "absolute top-3 left-3 transition-[opacity,background-color,color] [&_svg]:transition-[rotate] [&_svg]:duration-pop [&_svg]:ease-out hover:[&_svg]:-rotate-12 motion-reduce:hover:[&_svg]:rotate-0",
          pinned ? "border-accent-soft" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      />
      <BookMenu book={book} onTogglePin={onTogglePin} onSync={onSync} onRemove={onRemove} />
      <Progress value={book.pageCount ? position / book.pageCount : 0} />
      <span className="flex justify-between text-xs text-ink-3">
        <span>{position ? `Page ${position} of ${book.pageCount}` : "Not started"}</span>
        <span>{plural({ count: book.pageCount, one: "page", many: "pages" })}</span>
      </span>
    </div>
  );
};

const ContinueCard = ({ book }: { book: LibraryBook }) => {
  const navigate = useNavigate();
  const position = book.progress?.position ?? 1;
  const open = (from: Element) => {
    markOpeningCover(from);
    void navigate(`/read/${book.bookId}`, { viewTransition: true });
  };
  const author = [book.author, book.edition].filter(Boolean).join(" · ");
  return (
    <div data-book={book.bookId} className="flex items-center gap-8 rounded-2xl border border-line bg-surface p-6">
      <button
        type="button"
        aria-label={`Open ${book.title}`}
        onClick={(e) => open(e.currentTarget)}
        className="rounded-md transition-[translate,box-shadow] duration-pop ease-out hover:-translate-y-0.5 hover:shadow-float active:scale-99 motion-reduce:hover:translate-y-0"
      >
        <BookCover title={book.title} author={author || null} size="md" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="ar text-ar-display font-bold">{book.title}</span>
          {author && <span className="ar text-ar-small text-ink-2">{author}</span>}
        </div>
        <Progress value={position / Math.max(1, book.pageCount)} />
        <div className="flex items-center gap-4">
          <Button icon={BookOpen} onClick={(e) => open(e.currentTarget)}>
            Resume reading
          </Button>
          <span className="text-sm text-ink-2">
            Page {position} of {book.pageCount}
            {book.progress && ` · last read ${timeAgo(book.progress.updatedAt)}`}
          </span>
        </div>
      </div>
    </div>
  );
};

export const LibraryRoute = () => {
  const library = useLibrary();
  const waiting = useWaitingBooks();
  const settings = useSettings();
  const [shelf, setShelf] = useState<Shelf>("all");
  useClosingCover();
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState<LibraryBook | null>(null);
  const [removing, setRemoving] = useState<LibraryBook | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const client = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const books = library.data ?? [];
  // Pinned books lead the list, so the book read last is found by when it was read, not by its place.
  const continueBook = books
    .filter((b) => b.progress !== null && !isFinished(b))
    .reduce<LibraryBook | undefined>((latest, b) => ((b.progress?.updatedAt ?? 0) > (latest?.progress?.updatedAt ?? -Infinity) ? b : latest), undefined);
  const setPinned = useSetPinned();
  const reorder = useShelfReorder(books);
  const togglePin = (book: LibraryBook) => {
    const pinned = book.pinnedAt === null;
    reorder(() => setPinned.mutateAsync({ bookId: book.bookId, pinned }))
      .then(() => {
        // Moving a card in the shelf drops the focus inside it; keyboard users land back on its pin.
        if (document.activeElement === document.body) document.querySelector<HTMLElement>(`[data-shelf-card][data-book="${CSS.escape(book.bookId)}"] [data-pin-toggle]`)?.focus();
      })
      .catch((err: unknown) => setToast(`Couldn't ${pinned ? "pin" : "unpin"} ${book.title}: ${err instanceof Error ? err.message : String(err)}`));
  };
  const configured = Boolean(settings.data?.endpoint && settings.data.hasKey);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return books
      .filter((b) => shelf === "all" || (shelf === "finished" ? isFinished(b) : b.progress !== null && !isFinished(b)))
      .filter((b) => !q || [b.title, b.author, b.edition].some((s) => s?.toLowerCase().includes(q)));
  }, [books, shelf, filter]);

  const totalPages = books.reduce((n, b) => n + b.pageCount, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-12 py-10">
      <header className="flex items-end gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="font-display text-display font-semibold">Library</h1>
          <p className="text-sm text-ink-2">
            {plural({ count: books.length, one: "book", many: "books" })} · {plural({ count: totalPages, one: "page", many: "pages" })}
          </p>
        </div>
        <TextField icon={Search} placeholder="Filter by title or author" className="w-72" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Segmented
          label="Shelf"
          value={shelf}
          onChange={(next) => switchListInTransition({ list: "library", order: SHELVES.map((s) => s.value), from: shelf, to: next, apply: setShelf })}
          options={SHELVES}
        />
        <Button icon={Download} onClick={() => setImporting(true)}>
          Import
        </Button>
      </header>

      {/* With books waiting from other devices, their panel says the same, next to them. */}
      {!configured && settings.isSuccess && waiting.isSuccess && waiting.data.length === 0 && (
        <div className="flex items-center gap-4 rounded-xl bg-warn-soft px-5 py-4 text-sm text-warn">
          <span className="flex-1">Set up the corpus connection to import books.</span>
          <Link to="/settings" viewTransition>
            <Button size="sm" variant="secondary">
              Open settings
            </Button>
          </Link>
        </div>
      )}

      <div data-switch-list="library" className="flex flex-col gap-8">
      {library.isPending && (
        <div className="grid grid-cols-shelf gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      )}

      {library.error && <p className="text-sm text-danger">Couldn't open the library: {library.error.message}</p>}

      <WaitingBooks books={waiting.data ?? []} configured={configured} onImported={setToast} />

      {library.isSuccess && books.length === 0 && waiting.isSuccess && waiting.data.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <span className="ar text-ar-display text-ink-3">مداد</span>
          <p className="max-w-sm text-sm text-ink-2">Your library is empty. Import a book from the corpus to start reading.</p>
          <Button icon={Download} onClick={() => setImporting(true)} disabled={!configured}>
            Import from corpus
          </Button>
        </div>
      )}

      {continueBook && shelf === "all" && !filter && (
        <section className="flex flex-col gap-3">
          <h2 className="text-overline font-semibold uppercase tracking-widest text-ink-3">Continue reading</h2>
          <ContinueCard book={continueBook} />
        </section>
      )}

      {books.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-overline font-semibold uppercase tracking-widest text-ink-3">All books</h2>
          {shown.length === 0 ? (
            <p className="py-6 text-sm text-ink-3">No books on this shelf.</p>
          ) : (
            <div className="grid grid-cols-shelf gap-6">
              {shown.map((b) => (
                <BookCard
                  key={b.bookId}
                  book={b}
                  leaving={leaving === b.bookId}
                  onTogglePin={() => togglePin(b)}
                  onSync={() => setSyncing(b)}
                  onRemove={() => setRemoving(b)}
                />
              ))}
            </div>
          )}
        </section>
      )}
      </div>

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(message) => {
            setImporting(false);
            setToast(message);
          }}
        />
      )}
      {syncing && (
        <SyncDialog
          book={syncing}
          onClose={() => setSyncing(null)}
          onSynced={(message) => {
            setSyncing(null);
            setToast(message);
            void library.refetch();
          }}
        />
      )}
      {removing && (
        <RemoveBookDialog
          book={removing}
          onClose={() => setRemoving(null)}
          onRemoved={(message) => {
            setRemoving(null);
            setToast(message);
            setLeaving(removing.bookId);
            setTimeout(() => {
              void client.invalidateQueries({ queryKey: keys.library }).finally(() => setLeaving(null));
            }, FOLD_MS);
          }}
        />
      )}
      {toast && <Toast onDone={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
};
