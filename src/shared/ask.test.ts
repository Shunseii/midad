import { describe, expect, it } from "vitest";
import { citeSpan, claudeArgs, parseCitations, readingContext, streamEvent } from "./ask";
import { quoteSpan } from "./annotations";
import { parsePage } from "./page";

describe("parseCitations", () => {
  it("turns [[line n]] into a citation of that matn line", () => {
    expect(parseCitations("as [[line 2]] says")).toEqual([
      { kind: "text", text: "as " },
      { kind: "cite", part: "matn", from: 2, to: 2, words: null, phrase: null },
      { kind: "text", text: " says" },
    ]);
  });

  it("reads line ranges and ḥāshiya footnotes, spelled either way", () => {
    expect(parseCitations("[[lines 2-3]][[ḥāshiya 1]][[hashiya 2]]")).toEqual([
      { kind: "cite", part: "matn", from: 2, to: 3, words: null, phrase: null },
      { kind: "cite", part: "hashiya", from: 1, to: 1, words: null, phrase: null },
      { kind: "cite", part: "hashiya", from: 2, to: 2, words: null, phrase: null },
    ]);
  });

  it("leaves other brackets as text", () => {
    expect(parseCitations("see [[page 4]] and [x]")).toEqual([{ kind: "text", text: "see [[page 4]] and [x]" }]);
  });

  it("reads word ranges within one line", () => {
    expect(parseCitations("[[line 3:2-4]] and [[ḥāshiya 1:5]]")).toEqual([
      { kind: "cite", part: "matn", from: 3, to: 3, words: { from: 2, to: 4 }, phrase: null },
      { kind: "text", text: " and " },
      { kind: "cite", part: "hashiya", from: 1, to: 1, words: { from: 5, to: 5 }, phrase: null },
    ]);
  });

  it("leaves word ranges across several lines as text", () => {
    expect(parseCitations("[[lines 2-3:1-2]]")).toEqual([{ kind: "text", text: "[[lines 2-3:1-2]]" }]);
  });

  it("reads a phrase cited by its words", () => {
    expect(parseCitations("[[line 4: صدقَ الكلام]] and [[ḥāshiya 2:المراد]]")).toEqual([
      { kind: "cite", part: "matn", from: 4, to: 4, words: null, phrase: "صدقَ الكلام" },
      { kind: "text", text: " and " },
      { kind: "cite", part: "hashiya", from: 2, to: 2, words: null, phrase: "المراد" },
    ]);
  });

  it("reads a phrase across a line range", () => {
    expect(parseCitations("[[lines 1-2: المفيد بالوضع]]")).toEqual([{ kind: "cite", part: "matn", from: 1, to: 2, words: null, phrase: "المفيد بالوضع" }]);
  });

  it("leaves a citation still being streamed as text", () => {
    expect(parseCitations("as [[line 2: هو الل")).toEqual([{ kind: "text", text: "as [[line 2: هو الل" }]);
    expect(parseCitations("as [[line")).toEqual([{ kind: "text", text: "as [[line" }]);
  });
});

describe("citeSpan", () => {
  const page = parsePage(["h", "", "---", "الكلام هو اللفظ المركب المفيد", "بالوضع وأقسامه ثلاثة", "وأقسامه ثلاثة: اسم، وفعل، وحرف", "قال والشيخ قال الشيخ", "---", "### الحاشية", "(١) المراد بالوضع القصد هنا"].join("\n"));
  const cite = (s: string) => {
    const [segment] = parseCitations(s);
    if (segment?.kind !== "cite") throw new Error("not a citation");
    return segment;
  };
  const quoted = (s: string) => {
    const span = citeSpan({ cite: cite(s), page });
    return span && quoteSpan({ page, span });
  };

  it("covers just the cited words", () => {
    expect(quoted("[[line 1:2-3]]")).toBe("هو اللفظ");
  });

  it("covers whole lines when no words are given", () => {
    expect(quoted("[[lines 1-2]]")).toBe("الكلام هو اللفظ المركب المفيد بالوضع وأقسامه ثلاثة");
  });

  it("finds ḥāshiya words", () => {
    expect(quoted("[[ḥāshiya 1:1]]")).toBe("المراد");
  });

  it("finds a cited phrase by its text, with or without harakat", () => {
    expect(quoted("[[line 1: هو اللفظ]]")).toBe("هو اللفظ");
    expect(quoted("[[line 1: هُوَ اللَّفْظُ]]")).toBe("هو اللفظ");
    expect(quoted("[[ḥāshiya 1: بالوضع القصد]]")).toBe("بالوضع القصد");
  });

  it("ignores punctuation and tatweel in a cited phrase", () => {
    expect(quoted("[[line 3: ثلاثة اسم وفعل]]")).toBe("ثلاثة: اسم، وفعل،");
    expect(quoted("[[line 3: اســم]]")).toBe("اسم،");
  });

  it("takes the first match when a phrase repeats on the line", () => {
    const span = citeSpan({ cite: cite("[[line 4: قال]]"), page });
    expect(span).toEqual({ part: "matn", start: { line: 4, word: 1 }, end: { line: 4, word: 1 } });
  });

  it("prefers whole words over a match inside a longer word", () => {
    const span = citeSpan({ cite: cite("[[line 4: الشيخ]]"), page });
    expect(span).toEqual({ part: "matn", start: { line: 4, word: 4 }, end: { line: 4, word: 4 } });
  });

  it("finds a phrase across the lines it cites", () => {
    expect(quoted("[[lines 1-2: المفيد بالوضع]]")).toBe("المفيد بالوضع");
  });

  it("is null for a phrase that isn't on the line", () => {
    expect(quoted("[[line 1: بالوضع]]")).toBeNull();
    expect(quoted("[[line 9: الكلام]]")).toBeNull();
  });

  it("still reads the older word-number citations", () => {
    expect(quoted("[[line 1:4-5]]")).toBe("المركب المفيد");
  });

  it("is null for lines or words the page doesn't have", () => {
    expect(quoted("[[line 9]]")).toBeNull();
    expect(quoted("[[line 2:2-7]]")).toBeNull();
  });
});

describe("readingContext", () => {
  const base = { bookId: "b1", title: "الآجرومية", position: 3, number: 5 };

  it("names the book, the page position and the printed page", () => {
    const text = readingContext(base);
    expect(text).toContain("b1");
    expect(text).toMatch(/page 3\b/);
    expect(text).toMatch(/printed 5/);
    expect(text).not.toMatch(/selection/i);
  });

  it("adds the selection with its lines and words", () => {
    const text = readingContext({
      ...base,
      selection: { span: { part: "hashiya", start: { line: 1, word: 2 }, end: { line: 1, word: 3 } }, text: "بالوضع القصد" },
    });
    expect(text).toMatch(/selection/i);
    expect(text).toContain("بالوضع القصد");
    expect(text).toMatch(/ḥāshiya 1/);
    expect(text).toMatch(/--hashiya --line 1 --words 2-3/);
  });
});

describe("readingContext quotes", () => {
  const base = { bookId: "b1", title: "t", position: 3, number: null };

  it("lists quotes from this page with their lines, and pasted text without", () => {
    const text = readingContext({
      ...base,
      quotes: [
        { span: { part: "matn", start: { line: 2, word: 1 }, end: { line: 2, word: 4 } }, text: "الكلام هو اللفظ المركب" },
        { span: null, text: "نص من مكان آخر" },
      ],
    });
    expect(text).toMatch(/quote 1: line 2, words 1–4 .*: الكلام هو اللفظ المركب/);
    expect(text).toMatch(/quote 2 \(pasted\): نص من مكان آخر/);
  });
});

describe("streamEvent", () => {
  const line = (o: unknown) => JSON.stringify(o);

  it("reads streamed text", () => {
    expect(streamEvent(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } }))).toEqual({
      kind: "delta",
      text: "hi",
    });
  });

  it("reports a tool starting", () => {
    expect(streamEvent(line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash" } } }))).toEqual({
      kind: "tool",
      name: "Bash",
    });
  });

  it("reads the final answer and session id, and errors", () => {
    expect(streamEvent(line({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "s1" }))).toEqual({
      kind: "done",
      text: "done",
      sessionId: "s1",
    });
    expect(streamEvent(line({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom", session_id: "s1" }))).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("ignores everything else, including broken lines", () => {
    expect(streamEvent(line({ type: "system", subtype: "init" }))).toBeNull();
    expect(streamEvent("not json")).toBeNull();
  });
});

describe("claudeArgs", () => {
  it("streams, skips the user's own settings and only allows the midad CLI", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null });
    expect(args).toEqual(expect.arrayContaining(["-p", "q", "--output-format", "stream-json", "--include-partial-messages", "--setting-sources", "project"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Bash(midad:*)");
    expect(args).not.toContain("--resume");
  });

  it("resumes the conversation's session", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: "s1" });
    expect(args[args.indexOf("--resume") + 1]).toBe("s1");
  });
});
