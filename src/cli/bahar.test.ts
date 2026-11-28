import { describe, expect, it } from "vitest";
import { type BaharConnector, type BaharRun, type BaharRunner, type BaharWord, baharCandidates, classifyFailure, createBahar, parseAdded, scrub } from "./bahar";
import { dictionaryDb, sqliteBaharDb } from "./bahar-test-db";

const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJhIjoicm8ifQ.c2VjcmV0LXNpZ25hdHVyZQ";
const DB_INFO = JSON.stringify({ hostname: "bahar-user.turso.io", db_name: "bahar-user", access_token: TOKEN });
const UPDATE_NOTICE = "A new version of the Bahar CLI is available (1.5.0). Run `bahar update` to upgrade.\n";

const WORD: BaharWord = {
  word: "المفيدُ",
  translation: "conveying meaning",
  type: "ism",
  root: ["ف", "ي", "د"],
  tags: ["midad"],
  examples: [{ sentence: "الكلامُ هو اللفظُ المركَّبُ المفيدُ بالوضعِ", context: "متن الآجرومية · ص ٣" }],
};

const ADDED = JSON.stringify({ added: 1, results: [{ id: "w1", word: WORD.word, flashcardIds: { forward: "f1", reverse: "r1" } }] }, null, 2);

const missing = () => Object.assign(new Error("spawn bahar ENOENT"), { code: "ENOENT" });

const fakeRunner = ({ installed = ["bahar"], dbInfo, add }: { installed?: string[]; dbInfo?: BaharRun; add?: BaharRun | Error }) => {
  const calls: Parameters<BaharRunner>[0][] = [];
  const run: BaharRunner = async (input) => {
    calls.push(input);
    if (!installed.includes(input.command)) throw missing();
    if (input.args[0] === "db-info") return dbInfo ?? { code: 0, stdout: `${UPDATE_NOTICE}${DB_INFO}\n`, stderr: "" };
    if (add instanceof Error) throw add;
    return add ?? { code: 0, stdout: ADDED, stderr: "" };
  };
  return { run, calls };
};

const dictionary = dictionaryDb([
  { id: "e1", word: "كِتَابٌ", translation: "book", root: ["ك", "ت", "ب"], tags: ["midad"] },
  { id: "e2", word: "عَلَى", translation: "on", type: "harf" },
]);

const recordingConnector = () => {
  const seen: { url: string; authToken: string }[] = [];
  const connect: BaharConnector = (input) => {
    seen.push(input);
    return sqliteBaharDb(dictionary);
  };
  return { connect, seen };
};

describe("bahar search", () => {
  it("connects with db-info's credentials, read after an update notice, and returns ranked entries", async () => {
    const { connect, seen } = recordingConnector();
    const { run, calls } = fakeRunner({});
    const found = await createBahar({ run, candidates: ["bahar"], connect }).search({ query: "كتاب" });
    expect(found).toEqual([{ id: "e1", word: "كِتَابٌ", translation: "book", type: "ism", root: ["ك", "ت", "ب"], tags: ["midad"], definition: null }]);
    expect(seen).toEqual([{ url: "libsql://bahar-user.turso.io", authToken: TOKEN }]);
    expect(calls.map((c) => c.args)).toEqual([["db-info"]]);
  });

  it("never runs a write command", async () => {
    const { connect } = recordingConnector();
    const { run, calls } = fakeRunner({});
    await createBahar({ run, candidates: ["bahar"], connect }).search({ query: "on" });
    expect(calls.every((c) => c.args[0] === "db-info")).toBe(true);
  });

  it("keeps the token out of a database error", async () => {
    const connect: BaharConnector = () => ({
      execute: () => Promise.reject(new Error(`SQLITE_ERROR: bad request for libsql://bahar-user.turso.io with Authorization: Bearer ${TOKEN} (token ${TOKEN})`)),
      close: () => {},
    });
    const error = await createBahar({ run: fakeRunner({}).run, candidates: ["bahar"], connect })
      .search({ query: "كتاب" })
      .then(() => null, (err: unknown) => err as Error);
    expect(error?.message).toBeTruthy();
    expect(error?.message).not.toContain(TOKEN);
    expect(error?.message).not.toContain("c2VjcmV0LXNpZ25hdHVyZQ");
  });

  it("keeps the token out of a failed db-info", async () => {
    const run = fakeRunner({ dbInfo: { code: 1, stdout: DB_INFO, stderr: "something odd happened" } }).run;
    const error = await createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect })
      .search({ query: "كتاب" })
      .then(() => null, (err: unknown) => err as Error);
    expect(error?.message).toMatch(/^Bahar couldn't/);
    expect(error?.message).not.toContain(TOKEN);
  });

  it("asks the reader to log in themselves when they aren't", async () => {
    const run = fakeRunner({ dbInfo: { code: 1, stdout: "", stderr: "Not logged in. Run `bahar login` first.\n" } }).run;
    await expect(createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).search({ query: "كتاب" })).rejects.toThrow(/run `bahar login`.*themselves/);
  });

  it("reports an expired token from the database as not signed in", async () => {
    const connect: BaharConnector = () => ({ execute: () => Promise.reject(new Error("SERVER_ERROR: Server returned HTTP status 401")), close: () => {} });
    await expect(createBahar({ run: fakeRunner({}).run, candidates: ["bahar"], connect }).search({ query: "x" })).rejects.toThrow(/bahar login/);
  });

  it("reports network failures in one line", async () => {
    const connect: BaharConnector = () => ({
      execute: () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND bahar-user.turso.io") })),
      close: () => {},
    });
    await expect(createBahar({ run: fakeRunner({}).run, candidates: ["bahar"], connect }).search({ query: "x" })).rejects.toThrow(/^Couldn't reach Bahar/);
  });

  it("gives up on a database that doesn't answer", async () => {
    const connect: BaharConnector = () => ({ execute: () => new Promise(() => {}), close: () => {} });
    await expect(createBahar({ run: fakeRunner({}).run, candidates: ["bahar"], connect, timeoutMs: 20 }).search({ query: "x" })).rejects.toThrow(/^Couldn't reach Bahar/);
  });

  it("says when the CLI isn't installed", async () => {
    const { run } = fakeRunner({ installed: [] });
    await expect(createBahar({ run, candidates: ["bahar", "/home/me/.local/bin/bahar"], connect: recordingConnector().connect }).search({ query: "x" })).rejects.toThrow(/isn't installed/);
  });

  it("falls back to the CLI's install folder when it isn't on PATH", async () => {
    const { run, calls } = fakeRunner({ installed: ["/home/me/.local/bin/bahar"] });
    await createBahar({ run, candidates: ["bahar", "/home/me/.local/bin/bahar"], connect: recordingConnector().connect }).search({ query: "x" });
    expect(calls.at(-1)?.command).toBe("/home/me/.local/bin/bahar");
  });

  it("reports unreadable connection details without echoing them", async () => {
    const run = fakeRunner({ dbInfo: { code: 0, stdout: `{"hostname": "h", "token": "${TOKEN}"}`, stderr: "" } }).run;
    const error = await createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect })
      .search({ query: "x" })
      .then(() => null, (err: unknown) => err as Error);
    expect(error?.message).toMatch(/connection details couldn't be read/);
    expect(error?.message).not.toContain(TOKEN);
  });
});

describe("bahar add", () => {
  it("runs `bahar add` with the word as a one-item JSON array on stdin", async () => {
    const { run, calls } = fakeRunner({});
    expect(await createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).toEqual({ id: "w1", word: WORD.word });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["add"]);
    expect(JSON.parse(calls[0]?.stdin ?? "")).toEqual([WORD]);
  });

  it("reads the answer after an update notice on stdout", async () => {
    const { run } = fakeRunner({ add: { code: 0, stdout: `${UPDATE_NOTICE}${ADDED}`, stderr: "" } });
    expect(await createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).toEqual({ id: "w1", word: WORD.word });
  });

  it("doesn't claim success without Bahar's confirmation", async () => {
    const { run } = fakeRunner({ add: { code: 0, stdout: UPDATE_NOTICE, stderr: "" } });
    await expect(createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).rejects.toThrow(/didn't confirm/);
  });

  it("says when the CLI isn't installed", async () => {
    const { run } = fakeRunner({ installed: [] });
    await expect(createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).rejects.toThrow(/isn't installed/);
  });

  it("reports not being signed in and invalid input", async () => {
    const signedOut = fakeRunner({ add: { code: 1, stdout: "", stderr: "\u001b[31mNot logged in. Run `bahar login` first.\u001b[39m\n" } });
    await expect(createBahar({ run: signedOut.run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).rejects.toThrow(/bahar login/);
    const invalid = fakeRunner({ add: { code: 1, stdout: "", stderr: 'Word 1: "type" is invalid.\n' } });
    await expect(createBahar({ run: invalid.run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).rejects.toThrow(/^Bahar couldn't add the word: Word 1: "type" is invalid\.$/);
  });

  it("reports a hung CLI as a network problem", async () => {
    const { run } = fakeRunner({ add: Object.assign(new Error("slow"), { code: "ETIMEDOUT" }) });
    await expect(createBahar({ run, candidates: ["bahar"], connect: recordingConnector().connect }).add(WORD)).rejects.toThrow(/^Couldn't reach Bahar/);
  });
});

describe("helpers", () => {
  it("scrubs the token, bearer headers, token fields and JWTs", () => {
    const text = `Bearer abc123 {"access_token":"plain-secret"} ${TOKEN} raw:plain-secret`;
    const out = scrub({ text, secrets: ["plain-secret"] });
    expect(out).not.toMatch(/abc123|plain-secret|eyJ/);
  });

  it("classifies failures", () => {
    expect(classifyFailure({ output: "Unable to connect. Is the computer able to access the url?", action: "x" })).toMatch(/^Couldn't reach Bahar/);
    expect(classifyFailure({ output: "", action: "add the word" })).toBe("Bahar couldn't add the word.");
  });

  it("parses the add answer only when it's well formed", () => {
    expect(parseAdded(`${UPDATE_NOTICE}${ADDED}`)?.results[0]?.id).toBe("w1");
    expect(parseAdded("{not json\n")).toBeNull();
  });

  it("looks only at MIDAD_BAHAR_BIN when set", () => {
    expect(baharCandidates({ env: { MIDAD_BAHAR_BIN: "/x/bahar" }, home: "/h" })).toEqual(["/x/bahar"]);
    expect(baharCandidates({ env: {}, home: "/h" })).toEqual(["bahar", "/h/.local/bin/bahar", "/h/.bun/bin/bahar"]);
  });
});
