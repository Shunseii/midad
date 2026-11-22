/**
 * Messages typed while Claude is still answering, sent one at a time, oldest first.
 * The queue moves on by itself after an answer that finished; after one that
 * failed or that the reader stopped, it waits until the reader sends one.
 */
export interface AskQueue<T extends { id: string }> {
  items: T[];
  /** Waiting for the reader: the last answer failed or was stopped. */
  paused: boolean;
  /** The first item goes as soon as the answer being stopped ends, whatever way it ends. */
  sendingNow: boolean;
}

/** How an answer ended: finished, failed, or stopped by the reader. */
export type AnswerEnd = "done" | "error" | "stopped";

export const emptyQueue = <T extends { id: string }>(): AskQueue<T> => ({ items: [], paused: false, sendingNow: false });

export const enqueue = <T extends { id: string }>({ queue, item }: { queue: AskQueue<T>; item: T }): AskQueue<T> => ({
  ...queue,
  items: [...queue.items, item],
});

/** Takes an item out; an emptied queue is no longer paused. */
export const dequeue = <T extends { id: string }>({ queue, id }: { queue: AskQueue<T>; id: string }): AskQueue<T> => {
  const items = queue.items.filter((item) => item.id !== id);
  return items.length === 0 ? emptyQueue() : { ...queue, items };
};

/** Puts an item first, to go once the answer in progress has been stopped. */
export const sendFirst = <T extends { id: string }>({ queue, item }: { queue: AskQueue<T>; item: T }): AskQueue<T> => ({
  items: [item, ...queue.items.filter((queued) => queued.id !== item.id)],
  paused: false,
  sendingNow: true,
});

/** What to send once an answer ends, and the queue after it. */
export const afterAnswer = <T extends { id: string }>({ queue, end }: { queue: AskQueue<T>; end: AnswerEnd }): { next: T | null; queue: AskQueue<T> } => {
  const [first, ...rest] = queue.items;
  if (!first) return { next: null, queue: emptyQueue() };
  if (queue.sendingNow || (end === "done" && !queue.paused)) return { next: first, queue: { items: rest, paused: false, sendingNow: false } };
  return { next: null, queue: { ...queue, paused: true } };
};
