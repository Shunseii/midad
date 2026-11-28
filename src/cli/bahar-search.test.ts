import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { formatEntries, normalizeArabic, normalizeArabicLoose, normalizedLooseSql, normalizedSql, searchArgs, searchSql, toEntry } from "./bahar-search";
import { dictionaryDb } from "./bahar-test-db";

const ALL_COLUMNS = new Set(["id", "word", "translation", "type", "root", "tags", "definition"]);

const search = ({ db, query, limit = 10 }: { db: DatabaseSync; query: string; limit?: number }) => {
  const args = searchArgs({ query, limit });
  if (!args) throw new Error("empty query");
  return db.prepare(searchSql(ALL_COLUMNS)).all(...args).map((row) => toEntry(row as Record<string, unknown>));
};

const SAMPLES = ["كِتَابٌ", "كتاب", "أَكَلَ", "إِسْلَام", "آمَنَ", "ٱلْحَمْدُ", "قـــال", "هٰذَا", "عَلَى", "عَلِيّ", "مَدْرَسَةٌ", "مدرسه", "a_b%c", "مُؤْمِن"];

describe("Arabic folding", () => {
  it("folds the same in JS and in the generated SQL", () => {
    const db = dictionaryDb([]);
    for (const sample of SAMPLES) {
      const row = db.prepare(`SELECT ${normalizedSql("?1")} AS strict, ${normalizedLooseSql("?1")} AS loose`).get(sample) as { strict: string; loose: string };
      expect(row.strict).toBe(normalizeArabic(sample));
      expect(row.loose).toBe(normalizeArabicLoose(sample));
    }
  });

  it("strips harakat, tatweel and dagger alef, and folds hamza-carrying alefs", () => {
    expect(normalizeArabic("كِتَابٌ")).toBe("كتاب");
    expect(normalizeArabic("قـــال")).toBe("قال");
    expect(normalizeArabic("هٰذَا")).toBe("هذا");
    expect(normalizeArabic("أإآٱ")).toBe("اااا");
  });

  it("keeps ى and ي apart, and ة only folds loosely", () => {
    expect(normalizeArabic("عَلَى")).not.toBe(normalizeArabic("عَلِي"));
    expect(normalizeArabic("مدرسة")).toBe("مدرسة");
    expect(normalizeArabicLoose("مدرسة")).toBe("مدرسه");
  });
});

describe("searching the dictionary", () => {
  const db = dictionaryDb([
    { id: "e1", word: "كِتَابٌ", translation: "Book", root: ["ك", "ت", "ب"], tags: ["nouns"] },
    { id: "e2", word: "كَاتِب", translation: "writer", root: ["ك", "ت", "ب"] },
    { id: "e3", word: "مَكْتَبَةٌ", translation: "library", root: ["ك", "ت", "ب"] },
    { id: "e4", word: "كتابة", translation: "writing" },
    { id: "e5", word: "عَلَى", translation: "on", type: "harf" },
    { id: "e6", word: "عَلِيّ", translation: "high, exalted" },
    { id: "e7", word: "أَكَلَ", translation: "to eat", type: "fi'l", root: ["أ", "ك", "ل"] },
    { id: "e8", word: "مَدْرَسَة", translation: "school" },
    { id: "e9", word: "مدرسه", translation: "school (misspelt)" },
    { id: "e10", word: "100%_off", translation: "a_b" },
    { id: "e11", word: "1000Xoff", translation: "aXb" },
  ]);

  it("matches unvowelled queries against vowelled words and the reverse", () => {
    expect(search({ db, query: "كتاب" })[0]?.id).toBe("e1");
    expect(search({ db, query: "كَاتِبٌ" }).map((e) => e.id)).toEqual(["e2"]);
  });

  it("folds alef with hamza both ways", () => {
    expect(search({ db, query: "اكل" }).map((e) => e.id)).toEqual(["e7"]);
    expect(search({ db, query: "إكل" }).map((e) => e.id)).toEqual(["e7"]);
  });

  it("ranks an exact match, then a prefix, then a substring", () => {
    expect(search({ db, query: "كتاب" }).map((e) => e.id)).toEqual(["e1", "e4"]);
    expect(search({ db, query: "تاب" }).map((e) => e.id)).toEqual(["e1", "e4"]);
    expect(search({ db, query: "كاتب" }).map((e) => e.id)).toEqual(["e2"]);
    expect(search({ db, query: "كات" }).map((e) => e.id)).toEqual(["e2"]);
    expect(search({ db, query: "كتا" }).map((e) => e.id)).toEqual(["e1", "e4"]);
  });

  it("finds words by their root letters, spaced or not", () => {
    expect(search({ db, query: "ك ت ب" }).map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(search({ db, query: "ا ك ل" }).map((e) => e.id)).toEqual(["e7"]);
  });

  it("does not fold ى into ي", () => {
    expect(search({ db, query: "على" }).map((e) => e.id)).toEqual(["e5"]);
    expect(search({ db, query: "علي" }).map((e) => e.id)).toEqual(["e6"]);
  });

  it("matches ة and ه, ranking the exact spelling first", () => {
    expect(search({ db, query: "مدرسة" }).map((e) => e.id)).toEqual(["e8", "e9"]);
    expect(search({ db, query: "مدرسه" }).map((e) => e.id)).toEqual(["e9", "e8"]);
  });

  it("matches translations case-insensitively", () => {
    expect(search({ db, query: "BOOK" }).map((e) => e.id)).toEqual(["e1"]);
    expect(search({ db, query: "school" }).map((e) => e.id)).toEqual(["e8", "e9"]);
  });

  it("treats % and _ in the query literally", () => {
    expect(search({ db, query: "0%_" }).map((e) => e.id)).toEqual(["e10"]);
    expect(search({ db, query: "a_b" }).map((e) => e.id)).toEqual(["e10"]);
    expect(search({ db, query: "%" }).map((e) => e.id)).toEqual(["e10"]);
  });

  it("stops at the limit", () => {
    expect(search({ db, query: "ك", limit: 2 })).toHaveLength(2);
  });

  it("has nothing to search for in harakat alone", () => {
    expect(searchArgs({ query: " ً ", limit: 10 })).toBeNull();
  });

  it("works on a table without the optional columns", () => {
    const bare = dictionaryDb([]);
    bare.exec("CREATE TABLE t AS SELECT id, word, translation FROM dictionary_entries; DROP TABLE dictionary_entries; ALTER TABLE t RENAME TO dictionary_entries;");
    bare.prepare("INSERT INTO dictionary_entries VALUES ('x', 'كتاب', 'book')").run();
    const args = searchArgs({ query: "كتب", limit: 10 }) ?? [];
    const rows = bare.prepare(searchSql(new Set(["id", "word", "translation"]))).all(...args);
    expect(rows).toEqual([]);
    expect(bare.prepare(searchSql(new Set(["id", "word", "translation"]))).all(...(searchArgs({ query: "كتاب", limit: 10 }) ?? [])).map((r) => toEntry(r as Record<string, unknown>))).toMatchObject([{ id: "x", root: [], tags: [], type: null }]);
  });
});

describe("formatting", () => {
  it("prints one compact line per entry", () => {
    expect(formatEntries([{ id: "e1", word: "كِتَابٌ", translation: "book", type: "ism", root: ["ك", "ت", "ب"], tags: ["nouns", "midad"], definition: null }])).toBe(
      "كِتَابٌ — book · ism · root ك-ت-ب · tags nouns, midad · id e1\n",
    );
  });

  it("says clearly when nothing matches", () => {
    expect(formatEntries([])).toMatch(/^No matches/);
  });
});
