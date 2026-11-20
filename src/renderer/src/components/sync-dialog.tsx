import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { LibraryBook } from "../../../shared/library";
import { plural } from "../lib/format";
import { useSyncBook, useSyncPreview } from "../lib/midad";
import { Button, Dialog, Skeleton } from "./ui";

export const SyncDialog = ({
  book,
  onClose,
  onSynced,
}: {
  book: LibraryBook;
  onClose: () => void;
  onSynced: (message: string) => void;
}) => {
  const preview = useSyncPreview({ bookId: book.bookId, enabled: true });
  const sync = useSyncBook();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (fileId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });

  const pullNew = () =>
    sync.mutate(
      { bookId: book.bookId, mode: "new" },
      { onSuccess: (r) => onSynced(`Added ${plural({ count: r.added, one: "page", many: "pages" })}`) },
    );

  const overwrite = () =>
    sync.mutate(
      { bookId: book.bookId, mode: "overwrite", fileIds: [...selected] },
      { onSuccess: (r) => onSynced(`Replaced ${plural({ count: r.overwritten, one: "page", many: "pages" })} with the corpus text`) },
    );

  const data = preview.data;
  const upToDate = data && data.newPages.length === 0 && data.changedPages.length === 0;

  return (
    <Dialog
      title="Sync with corpus"
      description={`${book.title}. Your copy only changes when you choose to pull or overwrite.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        {preview.isPending && <Skeleton className="h-24" />}
        {preview.error && (
          <div className="flex items-center gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
            <span className="flex-1">Couldn't reach the corpus: {preview.error.message}</span>
            <Button size="sm" onClick={() => void preview.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {sync.error && <p className="text-sm text-danger">{sync.error.message}</p>}

        {upToDate && (
          <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-2">
            Your copy matches the corpus.
            {data.pending > 0 && ` ${plural({ count: data.pending, one: "page is", many: "pages are" })} still being transcribed.`}
          </p>
        )}

        {data && data.newPages.length > 0 && (
          <section className="flex items-center gap-4 rounded-xl border border-line p-4">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{plural({ count: data.newPages.length, one: "new page", many: "new pages" })}</span>
              <span className="text-xs text-ink-3">Added in page order. Existing pages stay as they are.</span>
            </div>
            <Button size="sm" icon={Download} disabled={sync.isPending} onClick={pullNew}>
              Pull new pages
            </Button>
          </section>
        )}

        {data && data.changedPages.length > 0 && (
          <section className="flex flex-col gap-3 rounded-xl border border-line p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {plural({ count: data.changedPages.length, one: "page differs", many: "pages differ" })} from the corpus
              </span>
              <span className="text-xs text-ink-3">Overwriting replaces your copy of the page with the corpus text.</span>
            </div>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {data.changedPages.map((p) => (
                <li key={p.fileId}>
                  <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={selected.has(p.fileId)}
                      onChange={() => toggle(p.fileId)}
                    />
                    Page {p.number ?? p.position}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" icon={RefreshCw} disabled={selected.size === 0 || sync.isPending} onClick={overwrite}>
                Overwrite {selected.size > 0 ? plural({ count: selected.size, one: "page", many: "pages" }) : "selected"}
              </Button>
            </div>
          </section>
        )}

        {data && !upToDate && data.pending > 0 && (
          <p className="text-xs text-ink-3">
            {plural({ count: data.pending, one: "page is", many: "pages are" })} still being transcribed and will show up here once done.
          </p>
        )}
      </div>
    </Dialog>
  );
};
