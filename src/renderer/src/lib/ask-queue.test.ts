import { describe, expect, it } from "vitest";
import { afterAnswer, type AskQueue, dequeue, emptyQueue, enqueue, sendFirst } from "./ask-queue";

type Item = { id: string };
const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

const queueOf = (...items: Item[]): AskQueue<Item> => items.reduce((queue, item) => enqueue({ queue, item }), emptyQueue<Item>());

describe("ask queue", () => {
  it("keeps messages in the order they were queued", () => {
    expect(queueOf(a, b, c).items).toEqual([a, b, c]);
  });

  it("sends the oldest message after an answer finishes, then the next", () => {
    const first = afterAnswer({ queue: queueOf(a, b), end: "done" });
    expect(first.next).toBe(a);
    expect(first.queue.items).toEqual([b]);
    const second = afterAnswer({ queue: first.queue, end: "done" });
    expect(second.next).toBe(b);
    expect(second.queue).toEqual(emptyQueue());
  });

  it("has nothing to send when empty", () => {
    expect(afterAnswer({ queue: emptyQueue<Item>(), end: "done" })).toEqual({ next: null, queue: emptyQueue() });
    expect(afterAnswer({ queue: emptyQueue<Item>(), end: "error" }).queue.paused).toBe(false);
  });

  it.each(["error", "stopped"] as const)("pauses instead of sending after an answer that %s", (end) => {
    const { next, queue } = afterAnswer({ queue: queueOf(a, b), end });
    expect(next).toBeNull();
    expect(queue.items).toEqual([a, b]);
    expect(queue.paused).toBe(true);
  });

  it("stays paused after a later answer finishes, until the reader sends one", () => {
    const paused = afterAnswer({ queue: queueOf(a), end: "stopped" }).queue;
    expect(afterAnswer({ queue: paused, end: "done" })).toEqual({ next: null, queue: paused });
  });

  it("sends a message picked with Send now first, even though its answer was stopped", () => {
    const picked = sendFirst({ queue: queueOf(a, b, c), item: c });
    expect(picked.items).toEqual([c, a, b]);
    const { next, queue } = afterAnswer({ queue: picked, end: "stopped" });
    expect(next).toBe(c);
    expect(queue).toEqual({ items: [a, b], paused: false, sendingNow: false });
  });

  it("sends a new message now ahead of the queue, and resumes a paused queue", () => {
    const paused = afterAnswer({ queue: queueOf(a), end: "error" }).queue;
    const picked = sendFirst({ queue: paused, item: b });
    expect(picked).toEqual({ items: [b, a], paused: false, sendingNow: true });
    const sent = afterAnswer({ queue: picked, end: "stopped" });
    expect(sent.next).toBe(b);
    expect(afterAnswer({ queue: sent.queue, end: "done" }).next).toBe(a);
  });

  it("removes one message and keeps the rest in order", () => {
    expect(dequeue({ queue: queueOf(a, b, c), id: "b" }).items).toEqual([a, c]);
  });

  it("forgets the pause once the queue is emptied", () => {
    const paused = afterAnswer({ queue: queueOf(a), end: "stopped" }).queue;
    expect(dequeue({ queue: paused, id: "a" })).toEqual(emptyQueue());
  });
});
