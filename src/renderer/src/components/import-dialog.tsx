import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportProgress } from "../../../shared/library";
import { Link } from "react-router";
import { plural } from "../lib/format";
import { useCorpusBooks, useImportBook, useLibrary } from "../lib/midad";
import { Badge, Button, Dialog, Skeleton, TextField, cx } from "./ui";

export const ImportDialog = ({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (message: string) => void;
}) => {
  const corpusBooks = useCorpusBooks({ enabled: true });
  const library = useLibrary();
  const importBook = useImportBook();
  const [filter, setFilter] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const filterField = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!importingId) return;
    setProgress(null);
    return window.midadEvents.onImportProgress((corpusBookId, next) => {
      if (corpusBookId === importingId) setProgress(next);
    });
  }, [importingId]);

  const imported = useMemo(() => new Set(library.data?.map((b) => b.bookId)), [library.data]);
  const books = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = corpusBooks.data ?? [];
    return q
      ? all.filter((b) => [b.title, b.author, b.workTitle].some((s) => s?.toLowerCase().includes(q)))
      : all;
  }, [corpusBooks.data, filter]);

  const runImport = (id: string) => {
    setImportingId(id);
    importBook.mutate(id, {
      onSuccess: (result) => {
        const pending = result.pending ? `, ${plural({ count: result.pending, one: "page", many: "pages" })} still transcribing` : "";
        onImported(`Imported ${plural({ count: result.imported, one: "page", many: "pages" })}${pending}`);
      },
      onSettled: () => setImportingId(null),
    });
  };

  return (
    <Dialog
      title="Import from corpus"
      description="Pulls a book's transcribed pages into Midad. You read from this copy; sync it later to get new pages."
      onClose={onClose}
      initialFocus={filterField}
    >
      <div className="flex flex-col gap-4">
        <TextField ref={filterField} icon={Search} placeholder="Filter by title or author" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {importBook.error && <p className="text-sm text-danger">{importBook.error.message}</p>}

        {corpusBooks.isPending && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )}

        {corpusBooks.error && (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-danger-soft p-4">
            <p className="text-sm text-danger">Couldn't reach the corpus: {corpusBooks.error.message}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void corpusBooks.refetch()}>
                Retry
              </Button>
              <Link to="/settings" viewTransition onClick={onClose}>
                <Button size="sm" variant="secondary">
                  Open settings
                </Button>
              </Link>
            </div>
          </div>
        )}

        {corpusBooks.data && books.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-3">
            {corpusBooks.data.length === 0 ? "The corpus has no books yet." : "No books match that filter."}
          </p>
        )}

        <ul className="flex flex-col divide-y divide-line">
          {books.map((b) => (
            <li key={b.id} className={cx("flex items-center gap-4 py-3", b.pagesReady === 0 && "opacity-60")}>
              <div className="flex min-w-0 flex-1 flex-col items-end text-right">
                <span className="ar truncate text-ar-body font-bold">{b.title}</span>
                <span className="ar truncate text-ar-small text-ink-2">
                  {[b.author, b.workTitle].filter(Boolean).join(" · ") || " "}
                </span>
                <span className="text-xs text-ink-3 tabular-nums">
                  {importingId === b.id
                    ? importStatus(progress)
                    : b.pagesReady === 0
                    ? "Not transcribed yet"
                    : `${b.pagesReady.toLocaleString("en")} of ${plural({ count: b.pagesTotal, one: "page", many: "pages" })} transcribed`}
                </span>
              </div>
              <div className="flex w-28 shrink-0 justify-end">
              {imported.has(b.id) ? (
                <Badge tone="accent">In library</Badge>
              ) : importingId === b.id ? (
                <ImportBar progress={progress} />
              ) : b.pagesReady === 0 ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Download}
                  disabled={importingId !== null}
                  onClick={() => runImport(b.id)}
                >
                  Import
                </Button>
              )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
};

const importStatus = (progress: ImportProgress | null) => {
  if (progress?.phase === "saving") return "Saving to your library…";
  if (!progress) return "Importing…";
  return `Importing ${progress.done.toLocaleString("en")} of ${plural({ count: progress.total, one: "page", many: "pages" })}`;
};

const ImportBar = ({ progress }: { progress: ImportProgress | null }) => {
  const saving = progress?.phase === "saving";
  const percent = saving ? 100 : progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-label="Import progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="flex h-8 w-full animate-in items-center fade-in duration-press"
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className={cx("h-full rounded-full bg-accent transition-[width] duration-pop ease-out motion-reduce:transition-none", saving && "animate-pulse")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
