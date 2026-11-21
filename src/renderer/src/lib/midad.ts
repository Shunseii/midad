import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HighlightColor, LetterRef, PageAnnotations, Part, Span } from "../../../shared/annotations";
import type { MidadApi, MidadEvents, SyncInput } from "../../../shared/ipc";

declare global {
  interface Window {
    midad: MidadApi;
    midadEvents: MidadEvents;
  }
}

export const midad = window.midad;

export const keys = {
  settings: ["settings"] as const,
  corpusBooks: ["corpus", "books"] as const,
  library: ["library"] as const,
  book: (bookId: string) => ["library", bookId] as const,
  page: (bookId: string, position: number) => ["library", bookId, "page", position] as const,
  syncPreview: (bookId: string) => ["library", bookId, "sync-preview"] as const,
  annotations: (bookId: string, position: number) => ["library", bookId, "annotations", position] as const,
  marker: (bookId: string) => ["library", bookId, "marker"] as const,
  conversations: (bookId: string) => ["library", bookId, "conversations"] as const,
  bookMarks: (bookId: string) => ["library", bookId, "book-marks"] as const,
  firstLine: (bookId: string, position: number) => ["library", bookId, "first-line", position] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => midad["settings.get"]() });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: () => midad["library.list"]() });

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
    addNote: async ({ span, body }: { span: Span; body: string }) => {
      const note = await midad["notes.add"]({ bookId, position, span, body });
      await refresh();
      return note;
    },
    updateNote: async ({ id, body }: { id: string; body: string }) => {
      await midad["notes.update"]({ id, body });
      client.setQueryData<PageAnnotations>(key, (current) =>
        current && {
          ...current,
          notes: current.notes.map((n) => (n.id === id ? { ...n, body: body.trim(), updatedAt: Date.now() } : n)),
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
