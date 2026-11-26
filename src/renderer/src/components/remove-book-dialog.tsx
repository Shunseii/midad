import { useRef } from "react";
import { removalCounts } from "../../../shared/library";
import { useRemovalPreview, useRemoveBook } from "../lib/midad";
import { Button, Dialog, Skeleton } from "./ui";

/** Confirms removing a book, naming it and counting what goes with it. */
export const RemoveBookDialog = ({
  book,
  onClose,
  onRemoved,
}: {
  book: { bookId: string; title: string };
  onClose: () => void;
  onRemoved: (message: string) => void;
}) => {
  const preview = useRemovalPreview(book.bookId);
  const remove = useRemoveBook();
  const cancel = useRef<HTMLButtonElement>(null);
  const summary = preview.data;

  const confirm = () => remove.mutate(book.bookId, { onSuccess: () => onRemoved(`Removed ${book.title}`) });

  return (
    <Dialog
      title="Remove book?"
      onClose={onClose}
      initialFocus={cancel}
      className="max-w-md motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100"
      footer={
        <div className="flex flex-1 justify-end gap-2">
          <Button ref={cancel} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" data-remove-book disabled={!summary || remove.isPending} onClick={confirm}>
            Remove
          </Button>
        </div>
      }
    >
      <div data-remove-book-dialog className="flex flex-col gap-4">
        <div className="flex flex-col items-end gap-1 rounded-lg bg-surface-2 px-4 py-3 text-right">
          <span className="ar text-ar-body font-bold">{summary?.title ?? book.title}</span>
          {preview.isPending ? (
            <Skeleton className="h-5 w-56" />
          ) : summary ? (
            <span data-removal-counts className="text-sm text-ink-2">
              {removalCounts(summary) || "No pages"}
            </span>
          ) : (
            <span className="text-sm text-ink-2">This book is no longer in your library.</span>
          )}
        </div>
        <p className="text-sm text-ink-2">Its highlights, notes and Ask AI chats go with it, on all your devices. Can't be undone. The corpus copy stays.</p>
        {(preview.error ?? remove.error) && <p className="text-sm text-danger">Couldn't remove it: {(preview.error ?? remove.error)?.message}</p>}
      </div>
    </Dialog>
  );
};
