import { Download, MonitorSmartphone, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ImportProgress, WaitingBook } from "../../../shared/library";
import { plural } from "../lib/format";
import { useCorpusBooks, useImportBook } from "../lib/midad";
import { Button, Progress, cx } from "./ui";

/** How long an imported row takes to fold away before the list drops it (duration-panel-exit). */
const FOLD_MS = 180;

/**
 * Books in the library on the reader's other devices that aren't on this one: synced membership
 * whose text still has to come from the corpus. Each imports through the same flow as the Import
 * dialog; without the corpus set up, the panel says so instead.
 */
export const WaitingBooks = ({ books, configured, onImported }: { books: WaitingBook[]; configured: boolean; onImported: (message: string) => void }) => {
  const importBook = useImportBook();
  // Entries synced by older builds carry no title; the corpus still knows it.
  const corpus = useCorpusBooks({ enabled: configured && books.some((b) => !b.title) });
  const nameOf = (book: WaitingBook) => {
    const listed = corpus.data?.find((c) => c.id === book.bookId);
    return { title: book.title ?? listed?.workTitle ?? listed?.title ?? null, author: book.author ?? listed?.author ?? null };
  };
  const [importing, setImporting] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  // Imported rows stay for a moment to fold away; the refetched list no longer has them.
  const [leaving, setLeaving] = useState<WaitingBook[]>([]);

  useEffect(() => {
    if (!importing) return;
    setProgress(null);
    return window.midadEvents.onImportProgress((bookId, next) => {
      if (bookId === importing) setProgress(next);
    });
  }, [importing]);

  useEffect(() => {
    if (importing || queue.length === 0) return;
    const [next, ...rest] = queue;
    if (!next) return;
    setQueue(rest);
    setImporting(next);
    const book = books.find((b) => b.bookId === next);
    importBook.mutate(next, {
      onSuccess: (result) => {
        if (book) {
          setLeaving((list) => [...list, book]);
          setTimeout(() => setLeaving((list) => list.filter((b) => b.bookId !== book.bookId)), FOLD_MS);
        }
        onImported(`Imported ${(book && nameOf(book).title) ?? "the book"}: ${plural({ count: result.imported, one: "page", many: "pages" })}`);
      },
      onError: () => setQueue([]),
      onSettled: () => setImporting(null),
    });
  }, [importing, queue, books, importBook, onImported]);

  const shown = [...books, ...leaving.filter((l) => !books.some((b) => b.bookId === l.bookId))];
  if (shown.length === 0) return null;
  const busy = importing !== null || queue.length > 0;
  const add = (ids: string[]) => setQueue((q) => [...q, ...ids.filter((id) => id !== importing && !q.includes(id))]);
  const count = plural({ count: books.length, one: "book", many: "books" });

  return (
    <section className="flex flex-col gap-3 transition-[opacity,translate] duration-panel ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none">
      <h2 className="text-overline font-semibold uppercase tracking-widest text-ink-3">From your other devices</h2>
      <div data-waiting-books className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-6 py-5">
        <div className="flex items-center gap-3 pb-2">
          <MonitorSmartphone className="size-4.5 shrink-0 text-ink-2" />
          <p className="flex-1 text-sm text-ink-2">
            {count} in your library {books.length === 1 ? "is" : "are"} on your other devices but not on this one yet.{" "}
            {configured ? "Import them from the corpus to read them here" : "Set up the corpus connection to download them"}; your highlights and notes are already waiting.
          </p>
          {configured ? (
            <Button size="sm" icon={Download} disabled={busy} onClick={() => add(books.map((b) => b.bookId))}>
              Import all
            </Button>
          ) : (
            <Link to="/settings" viewTransition>
              <Button size="sm" variant="secondary" icon={Settings}>
                Open settings
              </Button>
            </Link>
          )}
        </div>
        {importBook.error && <p className="pb-2 text-sm text-danger">Couldn't import: {importBook.error.message}</p>}
        {shown.map((book, i) => {
          const state = leaving.some((l) => l.bookId === book.bookId) ? "imported" : importing === book.bookId ? "importing" : "default";
          return (
            <div
              key={book.bookId}
              data-waiting-book={book.bookId}
              data-state={state}
              className={cx(
                "flex items-center gap-4 py-3.5 transition-[opacity,translate,display] transition-discrete duration-panel-exit ease-out starting:translate-y-1.5 starting:opacity-0",
                "data-[state=imported]:hidden data-[state=imported]:-translate-y-1 data-[state=imported]:opacity-0 motion-reduce:transition-none",
                i < shown.length - 1 && "border-b border-line",
              )}
            >
              <div className="flex w-64 shrink-0 items-center gap-3">
                {!configured ? (
                  <span className="text-xs text-ink-3">Needs the corpus</span>
                ) : state === "importing" ? (
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Progress value={progress?.phase === "downloading" && progress.total ? progress.done / progress.total : progress?.phase === "saving" ? 1 : 0} />
                    <span className="text-xs text-ink-3">
                      {progress?.phase === "downloading" ? `Downloading ${progress.done} of ${plural({ count: progress.total, one: "page", many: "pages" })}` : progress?.phase === "saving" ? "Saving…" : "Starting…"}
                    </span>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" icon={Download} disabled={queue.includes(book.bookId)} onClick={() => add([book.bookId])}>
                    {queue.includes(book.bookId) ? "Queued" : "Import"}
                  </Button>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-end gap-0.5 text-right">
                <span className="ar text-ar-body font-bold">{nameOf(book).title ?? book.bookId}</span>
                {nameOf(book).author && <span className="ar text-ar-small text-ink-2">{nameOf(book).author}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
