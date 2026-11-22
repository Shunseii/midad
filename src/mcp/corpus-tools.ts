import type { TextEdit, TextEditResult, TextHistory } from "../shared/corpus";
import type { StoredPage } from "../shared/library";

/**
 * The corpus tools Ask AI gets: fix a page's transcription, read its history,
 * and put an earlier version back. Pages are named as in `midad page <book> <page>`.
 */

/** A problem the model can fix by changing its call; shown to it as the tool's error. */
export class ToolError extends Error {}

interface PageText {
  bookId: string;
  fileId: string;
}

export interface CorpusTextApi {
  getText(input: PageText & { rev?: string }): Promise<string>;
  editText(input: PageText & { edits: TextEdit[]; note: string }): Promise<TextEditResult>;
  textHistory(input: PageText): Promise<TextHistory>;
}

export const validateEdits = (edits: TextEdit[]): TextEdit[] => {
  if (edits.length === 0) throw new ToolError("Give at least one edit.");
  edits.forEach((edit, i) => {
    if (!edit.old) throw new ToolError(`Edit ${i + 1} has an empty "old". Copy the exact text to replace from this page.`);
    if (edit.old === edit.new) throw new ToolError(`Edit ${i + 1} changes nothing: "old" and "new" are the same.`);
  });
  return edits;
};

const MIDAD_PREFIX = "midad: ";

export const midadNote = (note: string): string => {
  const text = note.trim().replace(/^midad:\s*/i, "");
  return `${MIDAD_PREFIX}${text || "hand edit"}`;
};

const describePage = (page: StoredPage, title: string) =>
  `${title} page ${page.position}${page.number === null ? "" : ` (printed ${page.number})`}`;

export const createCorpusTools = ({
  findPage,
  bookTitle,
  corpus,
  syncPage,
}: {
  findPage: (input: { book: string; position: number }) => Promise<StoredPage>;
  bookTitle: (bookId: string) => Promise<string>;
  corpus: CorpusTextApi;
  /** Pulls the page's new text into the local library so the reader shows it. */
  syncPage: (input: PageText) => Promise<void>;
}) => {
  const resolve = async ({ book, page }: { book: string; page: number }) => {
    const stored = await findPage({ book, position: page });
    return { stored, where: describePage(stored, await bookTitle(stored.bookId)), target: { bookId: stored.bookId, fileId: stored.fileId } };
  };

  const applied = async ({ result, where, target, undo }: { result: TextEditResult; where: string; target: PageText; undo: boolean }) => {
    if (result.kind === "failed") {
      throw new ToolError(
        `Edit ${result.failedEdit + 1} didn't apply (${result.reason}), so nothing was changed. Each "old" must match the page's text exactly once, as it stands after the edits before it; read it with corpus_text and include more surrounding text if it isn't unique.`,
      );
    }
    if (result.kind === "conflict") {
      throw new ToolError(`The corpus refused the edit: the page isn't finished, or it changed while editing (${result.message}). Nothing was changed. Read the page again with corpus_text and retry.`);
    }
    if (!result.changed) return `Nothing changed on ${where}: the text came out identical.`;
    const synced = await syncPage(target).then(
      () => "The reader shows the change now.",
      (err: unknown) => `The edit is saved, but the reader couldn't update yet (${err instanceof Error ? err.message : String(err)}); it shows the change after the next sync.`,
    );
    const revert = result.revisionId ? ` corpus_restore with rev ${result.revisionId} ${undo ? "undoes this restore" : "undoes it"}.` : "";
    return `${undo ? "Restored" : "Edited"} ${where}.${revert} ${synced}`;
  };

  return {
    async text({ book, page, rev }: { book: string; page: number; rev?: string }): Promise<string> {
      const { target } = await resolve({ book, page });
      return corpus.getText({ ...target, rev });
    },

    async edit({ book, page, edits, note }: { book: string; page: number; edits: TextEdit[]; note: string }): Promise<string> {
      const valid = validateEdits(edits);
      const { where, target } = await resolve({ book, page });
      const result = await corpus.editText({ ...target, edits: valid, note: midadNote(note) });
      return applied({ result, where, target, undo: false });
    },

    async history({ book, page }: { book: string; page: number }): Promise<string> {
      const { where, target } = await resolve({ book, page });
      const { textEditedAt, revisions } = await corpus.textHistory(target);
      if (revisions.length === 0) return `${where} has no recorded changes.`;
      const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
      return [
        `${where}${textEditedAt === null ? "" : `, hand-edited ${when(textEditedAt)} UTC`}. Changes, newest first:`,
        ...revisions.map((r) => `rev ${r.id}\t${when(r.createdAt)}\t${r.change === "ocr" ? `re-OCR${r.model ? ` (${r.model})` : ""}` : "edit"}${r.note ? `\t${r.note}` : ""}`),
        "Each rev names the text just before that change: corpus_text with rev shows it, corpus_restore with rev puts it back.",
      ].join("\n");
    },

    async restore({ book, page, rev }: { book: string; page: number; rev: string }): Promise<string> {
      const { where, target } = await resolve({ book, page });
      const [current, earlier] = await Promise.all([corpus.getText(target), corpus.getText({ ...target, rev })]);
      if (current === earlier) return `${where} already reads as it did before rev ${rev}; nothing to restore.`;
      if (!current) throw new ToolError(`${where} has no text to replace.`);
      const result = await corpus.editText({ ...target, edits: [{ old: current, new: earlier }], note: midadNote(`restore rev ${rev}`) });
      return applied({ result, where, target, undo: true });
    },
  };
};

export type CorpusTools = ReturnType<typeof createCorpusTools>;
