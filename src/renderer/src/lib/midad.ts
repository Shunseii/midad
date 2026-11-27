import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HighlightColor, LetterRef, NoteTarget, PageAnnotations, Part, Span } from "../../../shared/annotations";
import type { MidadApi, MidadEvents, SyncInput } from "../../../shared/ipc";
import type { Memory } from "../../../shared/memories";
import type { BookmarkState } from "./undo";

declare global {
  interface Window {
    midad: MidadApi;
    midadEvents: MidadEvents;
  }
}

export const midad = window.midad;

export const keys = {
  settings: ["settings"] as const,
  syncSettings: ["sync", "settings"] as const,
  syncStatus: ["sync", "status"] as const,
  updateStatus: ["update", "status"] as const,
  corpusBooks: ["corpus", "books"] as const,
  library: ["library"] as const,
  waiting: ["library", "elsewhere"] as const,
  book: (bookId: string) => ["library", bookId] as const,
  page: (bookId: string, position: number) => ["library", bookId, "page", position] as const,
  syncPreview: (bookId: string) => ["library", bookId, "sync-preview"] as const,
  annotations: (bookId: string, position: number) => ["library", bookId, "annotations", position] as const,
  marker: (bookId: string) => ["library", bookId, "marker"] as const,
  conversations: (bookId: string) => ["library", bookId, "conversations"] as const,
  bookMarks: (bookId: string) => ["library", bookId, "book-marks"] as const,
  firstLine: (bookId: string, position: number) => ["library", bookId, "first-line", position] as const,
  bookmarks: (bookId: string) => ["library", bookId, "bookmarks"] as const,
  // Under "library" so Ask AI's writes through the CLI refresh it.
  memories: ["library", "memories"] as const,
};

export const useMemories = () => useQuery({ queryKey: keys.memories, queryFn: () => midad["memories.list"]() });

export const useUpdateMemory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; description: string; body: string; bookId: string | null }) => midad["memories.update"](input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.memories }),
  });
};

export const useRemoveMemory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => midad["memories.remove"](input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.memories }),
  });
};

export const useRestoreMemory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { memory: Memory }) => midad["memories.restore"](input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.memories }),
  });
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => midad["settings.get"]() });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: () => midad["library.list"]() });

/** Books in the library on other devices that this one hasn't imported. Refetched with the library. */
export const useWaitingBooks = () => useQuery({ queryKey: keys.waiting, queryFn: () => midad["library.elsewhere"]() });

export const useBook = (bookId: string) =>
  useQuery({ queryKey: keys.book(bookId), queryFn: () => midad["library.get"](bookId) });

export const usePage = ({ bookId, position }: { bookId: string; position: number }) =>
  useQuery({
    queryKey: keys.page(bookId, position),
    queryFn: () => midad["library.page"]({ bookId, position }),
    placeholderData: (previous) => previous,
  });

export const useCorpusBooks = ({ enabled }: { enabled: boolean }) =>
  useQuery({ queryKey: keys.corpusBooks, queryFn: () => midad["corpus.listBooks"](), enabled, retry: false });

export const useSyncPreview = ({ bookId, enabled }: { bookId: string; enabled: boolean }) =>
  useQuery({
    queryKey: keys.syncPreview(bookId),
    queryFn: () => midad["library.previewSync"]({ bookId }),
    enabled,
    retry: false,
    gcTime: 0,
  });

export const useImportBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (corpusBookId: string) => midad["library.import"]({ corpusBookId }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.library }),
  });
};

export const useSyncBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncInput) => midad["library.sync"](input),
    onSuccess: (_result, input) => client.invalidateQueries({ queryKey: keys.book(input.bookId) }),
  });
};

/** Pins or unpins a book; resolves once the library has been refetched in its new order. */
export const useSetPinned = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { bookId: string; pinned: boolean }) => midad["library.setPinned"](input),
    onSettled: () => client.invalidateQueries({ queryKey: keys.library }),
  });
};

/** What removing a book would delete, counted fresh each time the dialog opens. */
export const useRemovalPreview = (bookId: string) =>
  useQuery({ queryKey: ["library", bookId, "removal"], queryFn: () => midad["library.removalPreview"]({ bookId }), gcTime: 0 });

/** Removes a book. The caller refetches the library once the book's card has folded away. */
export const useRemoveBook = () => useMutation({ mutationFn: (bookId: string) => midad["library.remove"]({ bookId }) });

export const useMarker = (bookId: string) =>
  useQuery({ queryKey: keys.marker(bookId), queryFn: () => midad["marker.get"]({ bookId }) });

/** Moves or clears the book's last-read marker; `null` clears it. */
export const useSetMarker = (bookId: string) => {
  const client = useQueryClient();
  return async (at: { position: number; part: Part; line: number; word: number } | null) => {
    if (at) await midad["marker.set"]({ bookId, ...at });
    else await midad["marker.clear"]({ bookId });
    await client.invalidateQueries({ queryKey: keys.marker(bookId) });
  };
};

export const useBookmarks = (bookId: string) =>
  useQuery({ queryKey: keys.bookmarks(bookId), queryFn: () => midad["bookmarks.list"]({ bookId }) });

/** Adds, renames or (with `null`) removes the bookmark on a page. */
export const useSetBookmark = (bookId: string) => {
  const client = useQueryClient();
  return async ({ position, bookmark }: { position: number; bookmark: BookmarkState }) => {
    if (bookmark) await midad["bookmarks.set"]({ bookId, position, ...bookmark });
    else await midad["bookmarks.remove"]({ bookId, position });
    await client.invalidateQueries({ queryKey: keys.bookmarks(bookId) });
  };
};

/** A page, fetched only while `enabled`; for previews that load as they're needed. */
export const usePagePreview = ({ bookId, position, enabled }: { bookId: string; position: number; enabled: boolean }) =>
  useQuery({
    queryKey: keys.page(bookId, position),
    queryFn: () => midad["library.page"]({ bookId, position }),
    enabled,
    staleTime: 5 * 60_000,
  });

/** The pages with highlights and notes, for the scrubber's dots. */
export const useBookMarks = (bookId: string) =>
  useQuery({ queryKey: keys.bookMarks(bookId), queryFn: () => midad["annotations.bookMarks"]({ bookId }) });

/** A page's first line, fetched only while `enabled`; a page fetched before stays available either way. */
export const useFirstLine = ({ bookId, position, enabled }: { bookId: string; position: number; enabled: boolean }) =>
  useQuery({
    queryKey: keys.firstLine(bookId, position),
    queryFn: () => midad["library.firstLine"]({ bookId, position }),
    enabled,
    staleTime: 5 * 60_000,
  });

export const useAnnotations = ({ bookId, position }: { bookId: string; position: number }) =>
  useQuery({
    queryKey: keys.annotations(bookId, position),
    queryFn: () => midad["annotations.list"]({ bookId, position }),
  });

/** Highlight and note writes for one page. Each refreshes that page's annotations. */
export const useAnnotationActions = ({ bookId, position }: { bookId: string; position: number }) => {
  const client = useQueryClient();
  const key = keys.annotations(bookId, position);
  const refresh = () =>
    Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: keys.bookMarks(bookId) })]);
  return {
    addHighlight: async ({ span, color }: { span: Span; color: HighlightColor }) => {
      const highlight = await midad["highlights.add"]({ bookId, position, span, color });
      await refresh();
      return highlight;
    },
    removeHighlight: async (id: string) => {
      await midad["highlights.remove"]({ id });
      await refresh();
    },
    addNote: async (input: NoteTarget & { body: string }) => {
      const note = await midad["notes.add"]({ bookId, position, ...input });
      await refresh();
      return note;
    },
    updateNote: async ({ id, body }: { id: string; body: string }) => {
      await midad["notes.update"]({ id, body });
      client.setQueryData<PageAnnotations>(key, (current) =>
        current && {
          ...current,
          notes: current.notes.map((n) => (n.id === id ? { ...n, body: body.trim(), updatedAt: Date.now() } : n)),
          pageNote: current.pageNote?.id === id ? { ...current.pageNote, body: body.trim(), updatedAt: Date.now() } : current.pageNote,
        },
      );
    },
    deleteNote: async (id: string) => {
      await midad["notes.delete"]({ id });
      await refresh();
    },
    setHarakat: async ({ marks, ...ref }: LetterRef & { marks: string }) => {
      await midad["harakat.set"]({ bookId, position, marks, ...ref });
      await refresh();
    },
    removeHarakat: async (ref: LetterRef) => {
      await midad["harakat.remove"]({ bookId, position, ...ref });
      await refresh();
    },
    clearHarakat: async (span: Span) => {
      const removed = await midad["harakat.clear"]({ bookId, position, span });
      await refresh();
      return removed;
    },
  };
};

export const useSaveSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { endpoint: string; key?: string }) => midad["settings.save"](input),
    onSuccess: (settings) => {
      client.setQueryData(keys.settings, settings);
      void client.invalidateQueries({ queryKey: keys.corpusBooks });
    },
  });
};

/** Device sync's status, kept current by the main process's pushes (see main.tsx). */
export const useSyncStatus = () => useQuery({ queryKey: keys.syncStatus, queryFn: () => midad["sync.status"](), staleTime: Number.POSITIVE_INFINITY });

export const useSyncSettings = () => useQuery({ queryKey: keys.syncSettings, queryFn: () => midad["sync.settings"]() });

export const useConnectSync = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; token?: string }) => midad["sync.connect"](input),
    onSuccess: (settings) => client.setQueryData(keys.syncSettings, settings),
  });
};

export const useDisconnectSync = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => midad["sync.disconnect"](),
    onSuccess: (settings) => client.setQueryData(keys.syncSettings, settings),
  });
};

/** The updater's status, kept current by the main process's pushes (see main.tsx). */
export const useUpdateStatus = () => useQuery({ queryKey: keys.updateStatus, queryFn: () => midad["update.status"](), staleTime: Number.POSITIVE_INFINITY });

export const useCheckForUpdates = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => midad["update.check"](),
    onSuccess: (status) => client.setQueryData(keys.updateStatus, status),
  });
};

export const useRestartToUpdate = () => useMutation({ mutationFn: () => midad["update.restart"]() });

const LEGACY_PREFIX = "hamish.";
try {
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX))) {
    const renamed = `midad.${key.slice(LEGACY_PREFIX.length)}`;
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key) ?? "");
    localStorage.removeItem(key);
  }
} catch {
  // Storage can be unavailable; there is nothing to carry over then.
}
