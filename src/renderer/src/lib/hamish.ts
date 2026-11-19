import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HighlightColor, LetterRef, PageAnnotations, Span } from "../../../shared/annotations";
import type { HamishApi, HamishEvents, SyncInput } from "../../../shared/ipc";

declare global {
  interface Window {
    hamish: HamishApi;
    hamishEvents: HamishEvents;
  }
}

export const hamish = window.hamish;

export const keys = {
  settings: ["settings"] as const,
  corpusBooks: ["corpus", "books"] as const,
  library: ["library"] as const,
  book: (bookId: string) => ["library", bookId] as const,
  page: (bookId: string, position: number) => ["library", bookId, "page", position] as const,
  syncPreview: (bookId: string) => ["library", bookId, "sync-preview"] as const,
  annotations: (bookId: string, position: number) => ["library", bookId, "annotations", position] as const,
  marker: (bookId: string) => ["library", bookId, "marker"] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => hamish["settings.get"]() });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: () => hamish["library.list"]() });

export const useBook = (bookId: string) =>
  useQuery({ queryKey: keys.book(bookId), queryFn: () => hamish["library.get"](bookId) });

export const usePage = ({ bookId, position }: { bookId: string; position: number }) =>
  useQuery({
    queryKey: keys.page(bookId, position),
    queryFn: () => hamish["library.page"]({ bookId, position }),
    placeholderData: (previous) => previous,
  });

export const useCorpusBooks = ({ enabled }: { enabled: boolean }) =>
  useQuery({ queryKey: keys.corpusBooks, queryFn: () => hamish["corpus.listBooks"](), enabled, retry: false });

export const useSyncPreview = ({ bookId, enabled }: { bookId: string; enabled: boolean }) =>
  useQuery({
    queryKey: keys.syncPreview(bookId),
    queryFn: () => hamish["library.previewSync"]({ bookId }),
    enabled,
    retry: false,
    gcTime: 0,
  });

export const useImportBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (corpusBookId: string) => hamish["library.import"]({ corpusBookId }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.library }),
  });
};

export const useSyncBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncInput) => hamish["library.sync"](input),
    onSuccess: (_result, input) => client.invalidateQueries({ queryKey: keys.book(input.bookId) }),
  });
};

export const useMarker = (bookId: string) =>
  useQuery({ queryKey: keys.marker(bookId), queryFn: () => hamish["marker.get"]({ bookId }) });

/** Moves or clears the book's last-read marker; `null` clears it. */
export const useSetMarker = (bookId: string) => {
  const client = useQueryClient();
  return async (at: { position: number; line: number; word: number } | null) => {
    if (at) await hamish["marker.set"]({ bookId, ...at });
    else await hamish["marker.clear"]({ bookId });
    await client.invalidateQueries({ queryKey: keys.marker(bookId) });
  };
};

export const useAnnotations = ({ bookId, position }: { bookId: string; position: number }) =>
  useQuery({
    queryKey: keys.annotations(bookId, position),
    queryFn: () => hamish["annotations.list"]({ bookId, position }),
  });

/** Highlight and note writes for one page. Each refreshes that page's annotations. */
export const useAnnotationActions = ({ bookId, position }: { bookId: string; position: number }) => {
  const client = useQueryClient();
  const key = keys.annotations(bookId, position);
  const refresh = () => client.invalidateQueries({ queryKey: key });
  return {
    addHighlight: async ({ span, color }: { span: Span; color: HighlightColor }) => {
      const highlight = await hamish["highlights.add"]({ bookId, position, span, color });
      await refresh();
      return highlight;
    },
    removeHighlight: async (id: string) => {
      await hamish["highlights.remove"]({ id });
      await refresh();
    },
    addNote: async ({ span, body }: { span: Span; body: string }) => {
      const note = await hamish["notes.add"]({ bookId, position, span, body });
      await refresh();
      return note;
    },
    updateNote: async ({ id, body }: { id: string; body: string }) => {
      await hamish["notes.update"]({ id, body });
      client.setQueryData<PageAnnotations>(key, (current) =>
        current && {
          ...current,
          notes: current.notes.map((n) => (n.id === id ? { ...n, body: body.trim(), updatedAt: Date.now() } : n)),
        },
      );
    },
    deleteNote: async (id: string) => {
      await hamish["notes.delete"]({ id });
      await refresh();
    },
    setHarakat: async ({ marks, ...ref }: LetterRef & { marks: string }) => {
      await hamish["harakat.set"]({ bookId, position, marks, ...ref });
      await refresh();
    },
    removeHarakat: async (ref: LetterRef) => {
      await hamish["harakat.remove"]({ bookId, position, ...ref });
      await refresh();
    },
  };
};

export const useSaveSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { endpoint: string; key?: string }) => hamish["settings.save"](input),
    onSuccess: (settings) => {
      client.setQueryData(keys.settings, settings);
      void client.invalidateQueries({ queryKey: keys.corpusBooks });
    },
  });
};

/** Reader display preferences are per-viewer conveniences, kept in localStorage. */
export const readPref = <T>({ key, fallback }: { key: string; fallback: T }): T => {
  try {
    const raw = localStorage.getItem(`hamish.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const writePref = ({ key, value }: { key: string; value: unknown }) => {
  try {
    localStorage.setItem(`hamish.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; preferences then last for the session only.
  }
};
