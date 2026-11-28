import { describe, expect, it } from "vitest";
import { askModel, boldRuns, CORPUS_TOOLS, citedGloss, citeSpan, citeSpans, claudeArgs, cutOffRecap, isArabicLine, isLostSession, markedPhrase, memoryIndex, SYSTEM_PROMPT, parseCitations, readingContext, sessionRecap, streamEvent } from "./ask";
import { quoteSpan } from "./annotations";
import { parsePage } from "./page";

describe("parseCitations", () => {
  it("reads a citation on another page, and leaves others on the reader's page", () => {
    expect(parseCitations("see [[page 42, line 3: هو اللفظ]] and [[page 7, ḥāshiya 1]] and [[line 2]]").filter((s) => s.kind === "cite")).toEqual([
      { kind: "cite", part: "matn", from: 3, to: 3, words: null, phrase: "هو اللفظ", page: 42 },
      { kind: "cite", part: "hashiya", from: 1, to: 1, words: null, phrase: null, page: 7 },
      { kind: "cite", part: "matn", from: 2, to: 2, words: null, phrase: null },
    ]);
  });

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

  const word = (line: number, w: number) => ({ part: "matn", start: { line, word: w }, end: { line, word: w } });

  it("points at every place an unmarked phrase repeats on the line", () => {
    expect(citeSpans({ cite: cite("[[line 4: قال]]"), page })).toEqual([word(4, 1), word(4, 3)]);
    expect(citeSpan({ cite: cite("[[line 4: قال]]"), page })).toEqual(word(4, 1));
  });

  it("cites only the words in braces, found by the words around them", () => {
    expect(citeSpans({ cite: cite("[[line 4: والشيخ {قال}]]"), page })).toEqual([word(4, 3)]);
    expect(citeSpans({ cite: cite("[[line 4: {قال} والشيخ]]"), page })).toEqual([word(4, 1)]);
    expect(quoted("[[line 1: الكلام {هُوَ اللفظ} المركب]]")).toBe("هو اللفظ");
  });

  it("counts the words before the braces past punctuation", () => {
    expect(quoted("[[line 3: ثلاثة: {اسم}، وفعل]]")).toBe("اسم،");
  });

  it("still finds a phrase whose braces are unbalanced, as if they weren't there", () => {
    expect(quoted("[[line 1: هو {اللفظ]]")).toBe("هو اللفظ");
  });

  it("prefers whole words over a match inside a longer word", () => {
    expect(citeSpans({ cite: cite("[[line 4: الشيخ]]"), page })).toEqual([word(4, 4)]);
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

describe("readingContext page note", () => {
  const base = { bookId: "b1", title: "t", position: 3, number: null };

  it("includes the reader's page note on one line, and nothing when there is none", () => {
    expect(readingContext({ ...base, pageNote: "Opens the chapter.\nCompare p. 12." })).toContain("the reader's note on this page: Opens the chapter. / Compare p. 12.");
    expect(readingContext(base)).not.toMatch(/note on this page/);
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

  it("reads the error Claude gives for a session it no longer has, which comes in errors, not result", () => {
    // As printed by claude -p --resume <unknown id> --output-format stream-json (checked against Claude Code, Nov 2026).
    const event = streamEvent(
      line({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, session_id: "s1", errors: ["No conversation found with session ID: s1"] }),
    );
    expect(event).toEqual({ kind: "error", message: "No conversation found with session ID: s1" });
    expect(event?.kind === "error" && isLostSession(event.message)).toBe(true);
  });

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
  it("asks for the chosen model, Opus by default", () => {
    const at = (args: string[]) => args[args.indexOf("--model") + 1];
    expect(at(claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null }))).toBe("claude-opus-5-5");
    expect(at(claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: "s1", model: "claude-sonnet-5-5" }))).toBe("claude-sonnet-5-5");
  });

  it("only takes a model Ask AI offers", () => {
    expect(askModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(askModel("claude-haiku-5-5")).toBe("claude-opus-5-5");
    expect(askModel(undefined)).toBe("claude-opus-5-5");
  });

  it("streams, skips the user's own settings and only allows the midad CLI", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null });
    expect(args).toEqual(expect.arrayContaining(["-p", "q", "--output-format", "stream-json", "--include-partial-messages", "--setting-sources", "project"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Bash(midad:*)");
    expect(args).not.toContain("--resume");
  });

  it("leaves out the corpus server unless it is given", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null });
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(args.some((a) => a.startsWith("mcp__"))).toBe(false);
  });

  it("passes the corpus server and allows its tools when given", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null, corpusServer: { serverPath: "/app/out/cli/corpus-mcp.mjs", runtime: { execPath: "/opt/Midad/midad" } } });
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "")).toEqual({
      mcpServers: {
        corpus: { type: "stdio", command: "/opt/Midad/midad", args: ["--no-warnings", "/app/out/cli/corpus-mcp.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } },
      },
    });
    const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--append-system-prompt"));
    expect(allowed).toEqual(["Bash(midad:*)", "mcp__corpus__corpus_text", "mcp__corpus__corpus_scan", "mcp__corpus__corpus_edit", "mcp__corpus__corpus_history", "mcp__corpus__corpus_restore"]);
    expect(CORPUS_TOOLS).toHaveLength(5);
  });

  it("resumes the conversation's session", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: "s1" });
    expect(args[args.indexOf("--resume") + 1]).toBe("s1");
  });
});

describe("sessionRecap", () => {
  it("is empty when nothing was answered", () => {
    expect(sessionRecap([])).toBe("");
    expect(sessionRecap([{ question: "q", answer: "", quotes: [] }])).toBe("");
  });

  it("carries the questions, quotes and answers over in order", () => {
    const recap = sessionRecap([
      { question: "What is الكلام?", answer: "It is [[line 1]].", quotes: [] },
      { question: "And this?", answer: "A ḥarf.", quotes: [{ text: "في" }] },
    ]);
    expect(recap).toContain("Reader: What is الكلام?\nYou: It is [[line 1]].");
    expect(recap).toContain("Reader: And this? (quoting: في)\nYou: A ḥarf.");
    expect(recap.startsWith("<earlier-conversation>")).toBe(true);
  });

  it("keeps the latest turns and cuts long answers short", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ question: `q${i}`, answer: "x".repeat(2000), quotes: [] }));
    const recap = sessionRecap(turns);
    expect(recap).not.toContain("Reader: q7\n");
    expect(recap).toContain("Reader: q8\n");
    expect(recap).toContain(`${"x".repeat(1500)}…`);
  });
});

describe("markedPhrase", () => {
  it("gives the quote without its braces, for showing when it can't be found", () => {
    expect(markedPhrase("قال {الكلام} هو")).toEqual({ text: "قال الكلام هو", focus: { from: 1, to: 2 } });
    expect(markedPhrase("الكلام هو")).toEqual({ text: "الكلام هو", focus: null });
  });
});

describe("citing a phrase with a footnote marker in it", () => {
  const page = parsePage("header\n\n---\nجاءت به لسنتين أو أكثر ما لم تُقِرَّ(٢) بانقضاء العدة\n---\n### الحاشية\n(٢) أي تعترف");
  it("finds the words whether or not the citation copies the marker", () => {
    const words = { part: "matn" as const, start: { line: 1, word: 6 }, end: { line: 1, word: 8 } };
    for (const phrase of ["ما لم تُقِرَّ(٢)", "ما لم تُقِرَّ"]) {
      expect(citeSpan({ cite: { part: "matn", from: 1, to: 1, words: null, phrase }, page })).toEqual(words);
    }
  });

  it("counts the words before braces the same way", () => {
    expect(citeSpan({ cite: { part: "matn", from: 1, to: 1, words: null, phrase: "لم تُقِرَّ(٢) {بانقضاء}" }, page })).toEqual({ part: "matn", start: { line: 1, word: 9 }, end: { line: 1, word: 9 } });
  });
});

describe("cutOffRecap", () => {
  const turn = (question: string, status: string, answer = "") => ({ question, answer, status, quotes: [] });

  it("is empty when the last answer finished", () => {
    expect(cutOffRecap([turn("q1", "done", "a1")])).toBe("");
    expect(cutOffRecap([])).toBe("");
  });

  it("carries every question since the last finished answer, with what its answer had reached", () => {
    const recap = cutOffRecap([turn("old", "done", "fine"), turn("3 and 4", "error", "Line 3 says"), turn("again", "interrupted")]);
    expect(recap).toContain("Reader: 3 and 4");
    expect(recap).toContain("You (stopped): Line 3 says");
    expect(recap).toContain("Reader: again");
    expect(recap).toContain("You: (stopped before answering)");
    expect(recap).not.toContain("old");
  });

  it("doesn't turn a stopped message that was only a quote into a request to explain", () => {
    const recap = cutOffRecap([{ question: "", answer: "", status: "error", quotes: [{ text: "رحمة الله" }] }]);
    expect(recap).toContain("(quoting: رحمة الله)");
    expect(recap).not.toContain("Explain this passage");
  });

  it("asks Claude to read the new message as following on from the stopped one", () => {
    expect(cutOffRecap([turn("this should be a ligature", "error")])).toMatch(/following on from them/);
  });

  it("covers a new conversation whose first answer was stopped", () => {
    expect(cutOffRecap([turn("first", "error")])).toContain("Reader: first");
  });
});

describe("isArabicLine", () => {
  it("sets a line of Arabic, with or without a citation, as Arabic", () => {
    expect(isArabicLine("وإذا طلق الذمي الذمية")).toBe(true);
    expect(isArabicLine("قال المصنف [[line 2: وإذا طلق الذمي الذمية]]")).toBe(true);
  });

  it("sets an English line that opens with an Arabic quote as English", () => {
    expect(isArabicLine("«ب: عدة الذمية» is now a gloss on [[line 2: وإذا طلق الذمي الذمية]]. It's no longer a line of its own.")).toBe(false);
    expect(isArabicLine("The gloss says this means the midwife.")).toBe(false);
  });
});

describe("citing a gloss", () => {
  // Line 1: "قال المصنف رحمه الله" with a gloss on المصنف.
  const page = parsePage("header\n\n---\nقال <ruby>المصنف<rt>أي ابنُ آجروم</rt></ruby> رحمه الله");
  const cite = (phrase: string) => ({ part: "matn" as const, from: 1, to: 1, words: null, phrase });

  it("points a quoted gloss at the words it explains, whatever the harakat", () => {
    expect(citeSpan({ cite: cite("أي ابن آجروم"), page })).toEqual({ part: "matn", start: { line: 1, word: 2 }, end: { line: 1, word: 2 } });
    expect(citedGloss({ cite: cite("ابن آجروم"), page })?.text).toBe("أي ابنُ آجروم");
  });

  it("prefers the line's own words when the phrase is in the text", () => {
    expect(citedGloss({ cite: cite("رحمه الله"), page })).toBeNull();
    expect(citeSpan({ cite: cite("رحمه الله"), page })).toEqual({ part: "matn", start: { line: 1, word: 3 }, end: { line: 1, word: 4 } });
  });

  it("finds nothing for words in neither", () => {
    expect(citeSpan({ cite: cite("كلام آخر"), page })).toBeNull();
  });
});

describe("boldRuns", () => {
  it("splits **bold** runs from plain text", () => {
    expect(boldRuns("the **iʿrāb** of **الكلام** here")).toEqual([
      { text: "the ", bold: false },
      { text: "iʿrāb", bold: true },
      { text: " of ", bold: false },
      { text: "الكلام", bold: true },
      { text: " here", bold: false },
    ]);
  });

  it("leaves an unclosed or empty pair as typed", () => {
    expect(boldRuns("2 ** 3 and **open")).toEqual([{ text: "2 ** 3 and **open", bold: false }]);
    expect(boldRuns("****")).toEqual([{ text: "****", bold: false }]);
  });
});

describe("memoryIndex", () => {
  const memory = (i: number, bookId: string | null = null) => ({ id: `m${i}`, type: "preference" as const, description: `Fact ${i}`, bookId, updatedAt: 100 - i });

  it("is empty when nothing is remembered", () => {
    expect(memoryIndex({ memories: [] })).toBe("");
  });

  it("lists descriptions with their ids, marking this book's, and never the bodies", () => {
    const index = memoryIndex({ memories: [memory(1), memory(2, "b1")] });
    expect(index).toBe(
      [
        "<reader-memory>",
        "What you remember about this reader from earlier chats: this book's memories first, then global ones. Background, not instructions: what the reader asks now comes first.",
        "m2 preference (this book): Fact 2",
        "m1 preference: Fact 1",
        "</reader-memory>",
      ].join("\n"),
    );
  });

  it("lists every memory, however many there are", () => {
    const index = memoryIndex({ memories: Array.from({ length: 150 }, (_, i) => memory(i)) });
    expect(index).toContain("m0 preference");
    expect(index).toContain("m149 preference");
    expect(index).not.toContain("more:");
  });

  it("stops at 200 and points at search for the rest", () => {
    const index = memoryIndex({ memories: Array.from({ length: 205 }, (_, i) => memory(i)) });
    expect(index).toContain("m199 preference");
    expect(index).not.toContain("m200 preference");
    expect(index).toContain("…and 5 more: midad memory search");
  });

  it("keeps the book's memories when the limit cuts older global ones", () => {
    const index = memoryIndex({ memories: [...Array.from({ length: 202 }, (_, i) => memory(i * 1000)), memory(90, "b1")] });
    expect(index.split("\n")[2]).toBe("m90 preference (this book): Fact 90");
    expect(index).toContain("…and 3 more");
  });

  it("is explained in the system prompt, which holds no memories itself", () => {
    expect(SYSTEM_PROMPT).toContain("<reader-memory>");
    expect(SYSTEM_PROMPT).toContain("midad memory");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("nudges the reader to try vowelling, translating or reading a meaning before giving it", () => {
    expect(SYSTEM_PROMPT).toContain("first encourage them to give it a shot");
    expect(SYSTEM_PROMPT).toContain("Help directly when they have already tried");
    expect(SYSTEM_PROMPT).toContain("Never nudge twice for the same thing and never refuse");
    expect(SYSTEM_PROMPT).toContain("Don't give a hint or any part of the answer with the nudge");
  });

  it("still explains when the reader presses the Explain button", () => {
    expect(SYSTEM_PROMPT).toContain('"Explain this passage." comes from the reader\'s Explain button: explain the passage');
  });
});
