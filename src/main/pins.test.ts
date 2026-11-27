import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBookRemoval } from "./book-removal";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { openUserStore } from "./user-store";

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: `Title ${id}`, work: null }),
  exportBook: async () => [1, 2, 3].map((n) => ({ file_id: `f${n}`, page_number: n, role: null, order_hint: null, state: "done" as const, text: `صفحة ${n}` })),
};

let dir: string;
let clock = 1000;
const connections: DatabaseSync[] = [];

const open = (file: string) => {
  const db = new DatabaseSync(join(dir, file));
  connections.push(db);
  const user = openUserStore({ db, getNow: () => clock });
  return { user, library: createLibrary({ db, corpus, now: () => clock }), removal: createBookRemoval({ db }) };
};
type Device = ReturnType<typeof open>;

const sync = (a: Device, b: Device) => {
  b.user.store.applyMergeableChanges(a.user.store.getMergeableContent());
  a.user.store.applyMergeableChanges(b.user.store.getMergeableContent());
  a.user.runAfterMerge();
  b.user.runAfterMerge();
};

const shelf = async (device: Device) => (await device.library.listBooks()).map((b) => b.bookId);
const pinnedAt = async ({ device, bookId }: { device: Device; bookId: string }) => (await device.library.listBooks()).find((b) => b.bookId === bookId)?.pinnedAt;

let here: Device;

beforeEach(async () => {
  clock = 1000;
  dir = mkdtempSync(join(tmpdir(), "midad-pins-"));
  here = open("midad.db");
  for (const bookId of ["b1", "b2", "b3", "b4"]) {
    clock += 10;
    await here.library.importBook({ corpusBookId: bookId });
  }
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("pinning a book", () => {
  it("puts pinned books first, in last-opened order among themselves, and leaves the rest in theirs", async () => {
    expect(await shelf(here)).toEqual(["b4", "b3", "b2", "b1"]);
    clock = 2000;
    await here.library.setPinned({ bookId: "b1", pinned: true });
    clock = 2100;
    await here.library.setPinned({ bookId: "b3", pinned: true });
    expect(await shelf(here)).toEqual(["b3", "b1", "b4", "b2"]);
    clock = 2200;
    await here.library.setProgress({ bookId: "b1", position: 2 });
    expect(await shelf(here)).toEqual(["b1", "b3", "b4", "b2"]);
  });

  it("records when it was pinned, keeps that time when pinned again, and clears it on unpin", async () => {
    clock = 2000;
    await here.library.setPinned({ bookId: "b2", pinned: true });
    clock = 3000;
    await here.library.setPinned({ bookId: "b2", pinned: true });
    expect(await pinnedAt({ device: here, bookId: "b2" })).toBe(2000);
    await here.library.setPinned({ bookId: "b2", pinned: false });
    expect(await pinnedAt({ device: here, bookId: "b2" })).toBeNull();
    expect(await shelf(here)).toEqual(["b4", "b3", "b2", "b1"]);
  });

  it("refuses a book that isn't in the library", async () => {
    await expect(here.library.setPinned({ bookId: "nope", pinned: true })).rejects.toThrow(/not in the library/);
  });

  it("is lost when the book is removed, so importing it again starts unpinned", async () => {
    await here.library.setPinned({ bookId: "b1", pinned: true });
    await here.removal.remove({ bookId: "b1" });
    await here.library.importBook({ corpusBookId: "b1" });
    expect(await pinnedAt({ device: here, bookId: "b1" })).toBeNull();
  });
});

describe("pins between devices", () => {
  let there: Device;

  beforeEach(() => {
    there = open("other.db");
    sync(here, there);
  });

  it("reaches the other device, and so does unpinning", async () => {
    await there.library.importBook({ corpusBookId: "b1" });
    sync(here, there);
    clock = 2000;
    await here.library.setPinned({ bookId: "b1", pinned: true });
    sync(here, there);
    expect(await pinnedAt({ device: there, bookId: "b1" })).toBe(2000);
    clock = 3000;
    await there.library.setPinned({ bookId: "b1", pinned: false });
    sync(here, there);
    expect(await pinnedAt({ device: here, bookId: "b1" })).toBeNull();
  });

  it("merges as its own cell: pins made on both devices at once both stay", async () => {
    for (const bookId of ["b1", "b2"]) await there.library.importBook({ corpusBookId: bookId });
    sync(here, there);
    clock = 2000;
    await here.library.setPinned({ bookId: "b1", pinned: true });
    clock = 2001;
    await there.library.setPinned({ bookId: "b2", pinned: true });
    await there.library.setProgress({ bookId: "b1", position: 3 });
    sync(here, there);
    for (const device of [here, there]) {
      expect(await pinnedAt({ device, bookId: "b1" })).toBe(2000);
      expect(await pinnedAt({ device, bookId: "b2" })).toBe(2001);
    }
  });

  it("survives importing a book that was pinned on another device", async () => {
    clock = 2000;
    await here.library.setPinned({ bookId: "b2", pinned: true });
    sync(here, there);
    clock = 3000;
    await there.library.importBook({ corpusBookId: "b2" });
    expect(await pinnedAt({ device: there, bookId: "b2" })).toBe(2000);
    sync(here, there);
    expect(await pinnedAt({ device: here, bookId: "b2" })).toBe(2000);
  });

  it("survives an import of the waiting book made before the pin arrived", async () => {
    clock = 2000;
    await here.library.setPinned({ bookId: "b3", pinned: true });
    clock = 3000;
    await there.library.importBook({ corpusBookId: "b3" });
    sync(here, there);
    for (const device of [here, there]) expect(await pinnedAt({ device, bookId: "b3" })).toBe(2000);
  });
});
