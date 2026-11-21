import { describe, expect, it } from "vitest";
import { type ComposerPart, parseComposer, questionWithQuoteMarks, serializeComposer } from "./composer";
import type { Quote } from "./conversations";

const quote = (id: string, offset?: number): Quote => ({ id, text: `نص ${id}`, span: null, position: 1, ...(offset === undefined ? {} : { offset }) });
const text = (t: string): ComposerPart => ({ kind: "text", text: t });
const pill = (q: Quote): ComposerPart => ({ kind: "quote", quote: q });

describe("serializeComposer", () => {
  it("records each pill's offset in Arabic text", () => {
    const { question, quotes } = serializeComposer([text("ما معنى "), pill(quote("a")), text(" و"), pill(quote("b")), text(" هنا؟")]);
    expect(question).toBe("ما معنى  و هنا؟");
    expect(quotes.map((q) => [q.id, q.offset])).toEqual([
      ["a", 8],
      ["b", 10],
    ]);
  });

  it("shifts offsets by trimmed leading space and clamps trailing ones", () => {
    const { question, quotes } = serializeComposer([text("  "), pill(quote("a")), text(" explain  "), pill(quote("b")), text(" ")]);
    expect(question).toBe("explain");
    expect(quotes.map((q) => q.offset)).toEqual([0, 7]);
  });

  it("keeps a question that is only pills", () => {
    expect(serializeComposer([pill(quote("a")), pill(quote("b"))])).toMatchObject({ question: "", quotes: [{ offset: 0 }, { offset: 0 }] });
  });
});

describe("parseComposer", () => {
  it("round-trips text and pills", () => {
    const parts = [text("ما معنى "), pill(quote("a")), text(" و"), pill(quote("b")), text(" هنا؟")];
    const saved = serializeComposer(parts);
    const [a, b] = saved.quotes as [Quote, Quote];
    expect(parseComposer(saved)).toEqual([text("ما معنى "), pill(a), text(" و"), pill(b), text(" هنا؟")]);
  });

  it("keeps adjacent pills in order", () => {
    const a = quote("a", 3);
    const b = quote("b", 3);
    expect(parseComposer({ question: "abcdef", quotes: [a, b] })).toEqual([text("abc"), pill(a), pill(b), text("def")]);
  });

  it("puts quotes without an offset first, as older questions show them", () => {
    const a = quote("a");
    const b = quote("b");
    expect(parseComposer({ question: "لماذا؟", quotes: [a, b] })).toEqual([pill(a), pill(b), text("لماذا؟")]);
  });
});

describe("questionWithQuoteMarks", () => {
  it("marks each pill with its number", () => {
    expect(questionWithQuoteMarks({ question: "قارن  مع ", quotes: [quote("a", 5), quote("b", 9)] })).toBe("قارن [quote 1] مع [quote 2]");
  });

  it("leaves older questions alone", () => {
    expect(questionWithQuoteMarks({ question: "why?", quotes: [quote("a")] })).toBe("why?");
  });
});
