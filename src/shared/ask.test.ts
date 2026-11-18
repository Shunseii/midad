import { describe, expect, it } from "vitest";
import { claudeArgs, parseCitations, readingContext, streamEvent } from "./ask";

describe("parseCitations", () => {
  it("turns [[line n]] into a citation of that matn line", () => {
    expect(parseCitations("as [[line 2]] says")).toEqual([
      { kind: "text", text: "as " },
      { kind: "cite", part: "matn", from: 2, to: 2 },
      { kind: "text", text: " says" },
    ]);
  });

  it("reads line ranges and ḥāshiya footnotes, spelled either way", () => {
    expect(parseCitations("[[lines 2-3]][[ḥāshiya 1]][[hashiya 2]]")).toEqual([
      { kind: "cite", part: "matn", from: 2, to: 3 },
      { kind: "cite", part: "hashiya", from: 1, to: 1 },
      { kind: "cite", part: "hashiya", from: 2, to: 2 },
    ]);
  });

  it("leaves other brackets as text", () => {
    expect(parseCitations("see [[page 4]] and [x]")).toEqual([{ kind: "text", text: "see [[page 4]] and [x]" }]);
  });

  it("leaves a citation still being streamed as text", () => {
    expect(parseCitations("as [[line")).toEqual([{ kind: "text", text: "as [[line" }]);
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
  it("streams, skips the user's own settings and only allows the hamish CLI", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: null });
    expect(args).toEqual(expect.arrayContaining(["-p", "q", "--output-format", "stream-json", "--include-partial-messages", "--setting-sources", "project"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Bash(hamish:*)");
    expect(args).not.toContain("--resume");
  });

  it("resumes the conversation's session", () => {
    const args = claudeArgs({ prompt: "q", systemPrompt: "s", sessionId: "s1" });
    expect(args[args.indexOf("--resume") + 1]).toBe("s1");
  });
});
