import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Span } from "../shared/annotations";
import type { ExportFile, TextEdit } from "../shared/corpus";
import { parsePage } from "../shared/page";
import { realignPage } from "../shared/realign";
import { type Annotations, createAnnotations } from "./annotations";
import type { CorpusSource } from "./corpus";
import { createLibrary, type Library } from "./library";
import { createMarkers, type Markers } from "./markers";

// matn 1: heading; 2: "قال المصنف رحمه الله تعالى"; 3: a gloss alone on its line;
// 4: "الكلام هو اللفظ المركب المفيد"; 5: "بالوضع وأقسامه ثلاثة". One footnote.
const BEFORE = [
  "باب الكلام",
  "",
  "---",
  "## باب الكلام",
  "قال المصنف رحمه الله تعالى",
  "<ruby><rt>أي ابن آجروم</rt></ruby>",
  "الكلام هو اللفظ المركب المفيد",
  "بالوضع وأقسامه ثلاثة",
  "---",
  "### الحاشية",
  "(١) المراد بالوضع القصد هنا",
].join("\n");

const file = (text: string): ExportFile => ({ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text });

class FakeCorpus implements CorpusSource {
  files = [file(BEFORE)];
  async getBook(id: string) {
    return { id, title: "t", work: null };
  }
  async exportBook() {
    return structuredClone(this.files);
  }
}

const matn = (line: number, from: number, to: number = from, endLine: number = line): Span => ({ part: "matn", start: { line, word: from }, end: { line: endLine, word: to } });

let corpus: FakeCorpus;
let library: Library;
let annotations: Annotations;
let markers: Markers;
let db: DatabaseSync;

beforeEach(async () => {
  corpus = new FakeCorpus();
  db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => 1000 });
  annotations = createAnnotations({ db, now: () => 1000 });
  markers = createMarkers({ db, now: () => 1000 });
  await library.importBook({ corpusBookId: "b1" });
});

const onPage = () => annotations.listForPage({ bookId: "b1", position: 1 });

/** Applies the agent's edits as the corpus would, then syncs the page with them. */
const agentEdits = async (edits: TextEdit[]) => {
  let text = corpus.files[0]?.text ?? "";
  for (const e of edits) text = text.replace(e.old, e.new);
  corpus.files[0] = file(text);
  await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"], edits: { f1: edits } });
};

const reOcr = async (text: string) => {
  corpus.files[0] = file(text);
  await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
};

describe("an agent's edit", () => {
  it("keeps a note on its words when a line above it disappears", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(4, 3, 4), body: "the definition" });
    // The gloss on its own line goes onto the line above it, so every line below moves up one.
    await agentEdits([{ old: "قال المصنف رحمه الله تعالى\n<ruby><rt>أي ابن آجروم</rt></ruby>", new: "قال المصنف <ruby>رحمه<rt>أي ابن آجروم</rt></ruby> الله تعالى" }]);
    const [note] = (await onPage()).notes;
    expect(note).toMatchObject({ span: matn(3, 3, 4), quote: "اللفظ المركب", stale: false });
  });

  it("follows words onto a merged line", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(5, 2, 3), color: "green" });
    await agentEdits([{ old: "المفيد\nبالوضع", new: "المفيد بالوضع" }]);
    expect((await onPage()).highlights[0]).toMatchObject({ span: matn(4, 7, 8), quote: "وأقسامه ثلاثة", stale: false });
  });

  it("keeps a note on a word the edit corrects, and flags that its text changed", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(4, 2, 3), body: "x" });
    await agentEdits([{ old: "هو اللفظ", new: "هو اللفظُ" }]);
    expect((await onPage()).notes[0]).toMatchObject({ span: matn(4, 2, 3), stale: true });
  });

  it("moves harakat, the last-read marker and the reading place with their words", async () => {
    await annotations.setHarakat({ bookId: "b1", position: 1, part: "matn", line: 5, word: 2, letter: 2, marks: "َ" });
    await markers.set({ bookId: "b1", position: 1, line: 5, word: 3 });
    await library.setProgress({ bookId: "b1", position: 1, anchor: { part: "matn", line: 5, word: 1, offset: 12 } });
    await agentEdits([{ old: "## باب الكلام\n", new: "## باب الكلام\nسطر جديد هنا\n" }]);
    expect((await onPage()).harakat[0]).toMatchObject({ line: 6, word: 2, letter: 2, stale: false });
    expect(await markers.get({ bookId: "b1" })).toMatchObject({ line: 6, word: 3 });
    expect((await library.listBooks())[0]?.progress?.anchor).toEqual({ part: "matn", line: 6, word: 1, offset: 12 });
  });

  it("tells repeated words apart exactly, where a diff could pick the wrong one", async () => {
    const twice = BEFORE.replace("بالوضع وأقسامه ثلاثة", "بالوضع وأقسامه ثلاثة بالوضع");
    await reOcr(twice);
    // The second بالوضع, line 5 word 4.
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(5, 4), color: "pink" });
    await agentEdits([{ old: "بالوضع وأقسامه", new: "وأقسامه" }]);
    expect((await onPage()).highlights[0]).toMatchObject({ span: matn(5, 3), quote: "بالوضع", stale: false });
  });

  it("falls back to following unchanged words when the local copy was behind the corpus", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(5, 1), body: "x" });
    // The corpus already had a new first line the library never synced, then the agent edited elsewhere.
    corpus.files[0] = file(BEFORE.replace("## باب الكلام\n", "## باب الكلام\nسطر لم يصل\n").replace("ثلاثة", "ثلاثةٌ"));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"], edits: { f1: [{ old: "ثلاثة", new: "ثلاثةٌ" }] } });
    expect((await onPage()).notes[0]).toMatchObject({ span: matn(6, 1), quote: "بالوضع", stale: false });
  });
});

describe("a re-OCR or sync", () => {
  it("follows unchanged words past added and removed lines", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(4, 4, 2, 5), color: "yellow" });
    await reOcr(BEFORE.replace("<ruby><rt>أي ابن آجروم</rt></ruby>\n", ""));
    expect((await onPage()).highlights[0]).toMatchObject({ span: matn(3, 4, 2, 4), quote: "المركب المفيد بالوضع وأقسامه", stale: false });
  });

  it("follows ḥāshiya words too", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: { part: "hashiya", start: { line: 1, word: 3 }, end: { line: 1, word: 3 } }, body: "x" });
    await reOcr(BEFORE.replace("(١) المراد بالوضع", "(١) قوله المراد بالوضع"));
    expect((await onPage()).notes[0]).toMatchObject({ span: { part: "hashiya", start: { line: 1, word: 4 }, end: { line: 1, word: 4 } }, quote: "القصد", stale: false });
  });

  it("leaves a note whose words are gone where it was, flagged", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(2, 3, 5), body: "x" });
    await reOcr(BEFORE.replace("قال المصنف رحمه الله تعالى", "قال المصنف"));
    expect((await onPage()).notes[0]).toMatchObject({ span: matn(2, 3, 5), stale: true });
  });

  it("changes nothing when the text is the same", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(4, 1), color: "yellow" });
    await reOcr(BEFORE);
    expect((await onPage()).highlights[0]).toMatchObject({ span: matn(4, 1), stale: false });
  });
});

describe("realignPage", () => {
  const side = (source: string) => ({ source, page: parsePage(source) });

  it("snaps a span that ends inside replaced text to the replacement's edge", () => {
    const after = BEFORE.replace("اللفظ المركب", "اللفظ المفرد والمركب");
    const realign = realignPage({ before: side(BEFORE), after: side(after), edits: [{ old: "اللفظ المركب", new: "اللفظ المفرد والمركب" }] });
    expect(realign.span(matn(4, 3, 4))).toEqual(matn(4, 3, 5));
  });

  it("can't follow a word that was deleted", () => {
    const after = BEFORE.replace(" تعالى", "");
    expect(realignPage({ before: side(BEFORE), after: side(after), edits: [{ old: " تعالى", new: "" }] }).word({ part: "matn", line: 2, word: 5 })).toBeNull();
  });
});
