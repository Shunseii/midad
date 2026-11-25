/**
 * Ask AI's memory: short facts about the reader that carry over from one chat to the next.
 * `reader`: who they are. `preference`: how they want answers. `feedback`: a correction they gave.
 * `book`: their goals and context for one book; the only kind that belongs to a book.
 */
export const MEMORY_TYPES = ["reader", "preference", "feedback", "book"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemorySource = "reader" | "agent";

export interface Memory {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  /** Null for a memory every chat sees. */
  bookId: string | null;
  bookTitle: string | null;
  /** Who last wrote it. */
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryInput {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  bookId?: string | null;
}

export const MEMORY_LIMITS = { name: 60, description: 200, body: 1000 } as const;

export const isMemoryType = (value: unknown): value is MemoryType => MEMORY_TYPES.includes(value as MemoryType);
