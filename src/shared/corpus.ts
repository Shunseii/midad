// The subset of the arabic-digitization API types Midad uses. Copied from
// packages/shared in that repo rather than linked, since Midad is a separate
// repo; keep field names identical so responses parse without mapping.

export type FileState =
  | "captured"
  | "queued"
  | "processing"
  | "rate_limited"
  | "done"
  | "needs_review"
  | "approved"
  | "failed";

export interface Work {
  id: string;
  name: string;
  author?: string | null;
  created_at: number;
  tags: string[];
}

export interface BookWithStatus {
  id: string;
  title: string;
  created_at: number;
  work_id?: string | null;
  files_total: number;
  counts: Partial<Record<FileState, number>>;
}

export interface ExportFile {
  file_id: string;
  page_number: number | null;
  role: string | null;
  order_hint: number | null;
  state: FileState;
  text: string | null;
}

export interface CorpusBookListing {
  id: string;
  title: string;
  author: string | null;
  workTitle: string | null;
  pagesTotal: number;
  pagesReady: number;
}

export interface TextEdit {
  old: string;
  new: string;
}

export type TextEditResult =
  | { kind: "edited"; changed: boolean; revisionId: string | null; textEditedAt: number | null }
  /** 422: edit number `failedEdit` (from 0) didn't apply, so none did. */
  | { kind: "failed"; failedEdit: number; reason: string }
  /** 409: the page isn't done, or it changed during the edit. */
  | { kind: "conflict"; message: string };

export interface TextRevision {
  /** Addresses the text as it was just before this change. */
  id: string;
  change: "edit" | "ocr";
  model: string | null;
  note: string | null;
  createdAt: number;
}

export interface TextHistory {
  textEditedAt: number | null;
  /** Newest first. */
  revisions: TextRevision[];
}
