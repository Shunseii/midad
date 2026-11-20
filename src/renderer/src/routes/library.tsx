import { BookOpen, Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { LibraryBook } from "../../../shared/library";
import { BookCover, markOpeningCover } from "../components/book-cover";
import { ImportDialog } from "../components/import-dialog";
import { SyncDialog } from "../components/sync-dialog";
import { Button, IconButton, Progress, Segmented, Skeleton, TextField, Toast } from "../components/ui";
import { plural, timeAgo } from "../lib/format";
import { useLibrary, useSettings } from "../lib/midad";

type Shelf = "all" | "reading" | "finished";

const isFinished = (b: LibraryBook) => b.progress !== null && b.progress.position >= b.pageCount;

const BookCard = ({ book, onSync }: { book: LibraryBook; onSync: () => void }) => {
  const position = book.progress?.position ?? 0;
  return (
    <div data-book className="group relative flex flex-col gap-3">
      <Link
        to={`/read/${book.bookId}`}
        viewTransition
        aria-label={book.title}
        onClick={(e) => markOpeningCover(e.currentTarget)}
        className="rounded-md transition-[translate,box-shadow] duration-pop ease-out group-hover:-translate-y-0.5 group-hover:shadow-float active:scale-99 motion-reduce:group-hover:translate-y-0"
      >
        <BookCover title={book.title} author={[book.author, book.edition].filter(Boolean).join(" · ") || null} size="sm" />
      </Link>
      <IconButton icon={RefreshCw} label="Sync with corpus" onClick={onSync} className="absolute top-3 right-3 bg-surface opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
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
    <div data-book className="flex items-center gap-8 rounded-2xl border border-line bg-surface p-6">
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
  const settings = useSettings();
  const [shelf, setShelf] = useState<Shelf>("all");
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState<LibraryBook | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const books = library.data ?? [];
  const continueBook = books.find((b) => b.progress !== null && !isFinished(b));
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
          onChange={setShelf}
          options={[
            { value: "all", label: "All" },
            { value: "reading", label: "Reading" },
            { value: "finished", label: "Finished" },
          ]}
        />
        <Button icon={Download} onClick={() => setImporting(true)}>
          Import
        </Button>
      </header>

      {!configured && settings.isSuccess && (
        <div className="flex items-center gap-4 rounded-xl bg-warn-soft px-5 py-4 text-sm text-warn">
          <span className="flex-1">Set up the corpus connection to import books.</span>
          <Link to="/settings" viewTransition>
            <Button size="sm" variant="secondary">
              Open settings
            </Button>
          </Link>
        </div>
      )}

      {library.isPending && (
        <div className="grid grid-cols-shelf gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      )}

      {library.error && <p className="text-sm text-danger">Couldn't open the library: {library.error.message}</p>}

      {library.isSuccess && books.length === 0 && (
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
                <BookCard key={b.bookId} book={b} onSync={() => setSyncing(b)} />
              ))}
            </div>
          )}
        </section>
      )}

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
      {toast && <Toast onDone={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
};
