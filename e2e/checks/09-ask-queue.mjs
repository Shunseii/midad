import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Ask AI queue";

const COMPOSER = "[role=textbox][aria-multiline]";
// The fake Claude answers "[N words]" at about 60 words a second.
const LONG = "[600 words]";
const SHORT = "[12 words]";
// Long enough to catch while it streams.
const MID = "[120 words]";

const streaming = (page) => page.ev(`!!document.querySelector('[aria-label="Stop"]')`);
const queued = (page) => page.ev(`[...document.querySelectorAll('[aria-label="Queued questions"] [role=listitem]:not([data-state=leaving])')].map((i) => i.textContent.trim())`);
const queueHeader = (page) => page.ev(`document.querySelector('[aria-label="Queued questions"]')?.firstElementChild.textContent.trim() ?? null`);
/** Each question asked so far with how its answer stands: streaming, done, stopped or error. */
const TURNS = `[...document.querySelectorAll("p.self-end")].map((q) => {
  const turn = q.parentElement;
  const state = turn.querySelector(".animate-pulse") ? "streaming" : turn.textContent.includes("Stopped.") ? "stopped" : turn.querySelector(".bg-danger-soft") ? "error" : "done";
  return { question: q.textContent.trim(), state };
})`;
const turns = (page) => page.ev(TURNS);
const lastQuestion = (text) => `${JSON.stringify(text)} === [...document.querySelectorAll("p.self-end")].at(-1)?.textContent.trim()`;
const composerText = (page) => page.ev(`document.querySelector("${COMPOSER}").innerText`);
const queuedButton = (text, label) =>
  `js:[...document.querySelectorAll('[aria-label="Queued questions"] [role=listitem]')].find((i) => i.textContent.includes(${JSON.stringify(text)}))?.querySelector('[aria-label="${label}"]')`;

const ask = async (page, text) => {
  await page.click(COMPOSER);
  await page.type(text);
  await page.press("Enter");
};

const startLongAnswer = async (page, text) => {
  await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20_000, message: "an earlier answer never finished" });
  await ask(page, text);
  await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { message: "the question didn't start an answer" });
};

const waitTurns = (page, expected, { timeout = 20_000 } = {}) =>
  page.waitFor(`JSON.stringify(${TURNS}) === ${JSON.stringify(JSON.stringify(expected))}`, { timeout }).catch(async () => {
    throw new Error(`turns: expected ${JSON.stringify(expected)}, got ${JSON.stringify(await turns(page))}`);
  });

export const checks = [
  [
    "Enter while answering queues the question, in order, and clears the composer",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector("${COMPOSER}")`, { message: "Ask AI didn't open" });
      await page.waitStill(COMPOSER);
      await startLongAnswer(page, `Long one ${LONG}`);
      await page.click(COMPOSER);
      await page.type(`First queued ${MID}`);
      assert.ok(await page.ev(`!!document.querySelector('[aria-label="Queue"]') && !!document.querySelector('[aria-label="Stop"]')`), "Stop and Queue aren't both shown with a draft");
      await page.press("Enter");
      await ask(page, `Second queued ${MID}`);
      await page.sleep(300);
      assert.deepEqual(await queued(page), [`First queued ${MID}`, `Second queued ${MID}`]);
      assert.equal((await composerText(page)).trim(), "", "the composer kept the draft");
      assert.ok(await streaming(page), "queueing stopped the answer");
      assert.equal((await turns(page)).length, 1, "a queued question was sent straight away");
    },
  ],
  [
    "when the answer finishes, the queued questions send one after another",
    async (page) => {
      await waitTurns(page, [
        { question: `Long one ${LONG}`, state: "done" },
        { question: `First queued ${MID}`, state: "streaming" },
      ]);
      assert.deepEqual(await queued(page), [`Second queued ${MID}`]);
      await waitTurns(page, [
        { question: `Long one ${LONG}`, state: "done" },
        { question: `First queued ${MID}`, state: "done" },
        { question: `Second queued ${MID}`, state: "streaming" },
      ]);
      await page.waitFor(`!document.querySelector('[aria-label="Queued questions"]')`, { message: "the emptied queue didn't go away" });
    },
  ],
  [
    "Send now stops the answer, keeps what it wrote, and sends that question next",
    async (page) => {
      await startLongAnswer(page, `Long two ${LONG}`);
      await ask(page, `Stays queued ${SHORT}`);
      await ask(page, `Jumps ahead ${MID}`);
      await page.sleep(1500);
      await page.click(queuedButton("Jumps ahead", "Send now"));
      await waitTurns(page, [
        { question: `Long one ${LONG}`, state: "done" },
        { question: `First queued ${MID}`, state: "done" },
        { question: `Second queued ${MID}`, state: "done" },
        { question: `Long two ${LONG}`, state: "stopped" },
        { question: `Jumps ahead ${MID}`, state: "streaming" },
      ], { timeout: 3000 });
      const kept = await page.ev(`[...document.querySelectorAll("p.self-end")][3].parentElement.textContent`);
      assert.match(kept, /word\d/, "the stopped answer lost what it had written");
      assert.deepEqual(await queued(page), [`Stays queued ${SHORT}`]);
      // Send now doesn't pause the queue: the rest follows once the sent question is answered.
      await page.waitFor(lastQuestion(`Stays queued ${SHORT}`), {
        timeout: 10_000,
        message: "the rest of the queue didn't follow",
      });
    },
  ],
  [
    "Remove takes a question out; Edit puts it back in the composer after the draft",
    async (page) => {
      await startLongAnswer(page, `Long three ${LONG}`);
      await ask(page, "Remove me");
      await ask(page, "Edit me");
      await page.sleep(300);
      await page.click(queuedButton("Remove me", "Remove"));
      await page.sleep(400);
      assert.deepEqual(await queued(page), ["Edit me"]);
      await page.click(COMPOSER);
      await page.type("Draft");
      await page.click(queuedButton("Edit me", "Edit"));
      await page.sleep(400);
      assert.equal(await composerText(page), "Draft\nEdit me");
      await page.waitFor(`!document.querySelector('[aria-label="Queued questions"]')`, { message: "the edited question stayed in the queue" });
      assert.ok(await page.ev(`document.activeElement === document.querySelector("${COMPOSER}")`), "the composer isn't focused after Edit");
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.press("Backspace", { commands: ["deleteBackward"] });
      assert.equal((await composerText(page)).trim(), "", "couldn't clear the composer");
    },
  ],
  [
    "Stop pauses the queue until Resume",
    async (page) => {
      await ask(page, `Waits ${SHORT}`);
      await page.click('[aria-label="Stop"]');
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { message: "Stop didn't stop the answer" });
      await page.sleep(500);
      assert.equal((await turns(page)).at(-1).state, "stopped");
      assert.deepEqual(await queued(page), [`Waits ${SHORT}`], "the queue moved on after Stop");
      assert.match(await queueHeader(page), /^Paused/);
      await page.click(`js:[...document.querySelectorAll('[aria-label="Queued questions"] button')].find((b) => b.textContent.trim() === "Resume")`);
      await page.waitFor(lastQuestion(`Waits ${SHORT}`), { message: "Resume didn't send" });
    },
  ],
  [
    "Ctrl+Enter while answering sends the draft now",
    async (page) => {
      await startLongAnswer(page, `Long four ${LONG}`);
      await page.click(COMPOSER);
      await page.type(`Right now ${SHORT}`);
      await page.press("Enter", { ctrl: true });
      await page.waitFor(lastQuestion(`Right now ${SHORT}`), {
        timeout: 3000,
        message: "Ctrl+Enter didn't send the draft",
      });
      const all = await turns(page);
      assert.equal(all.at(-2).question, `Long four ${LONG}`);
      assert.equal(all.at(-2).state, "stopped");
      await page.waitFor(`!document.querySelector('[aria-label="Queued questions"]')`, { message: "Ctrl+Enter left something in the queue" }).catch(async (e) => { throw new Error(e.message + JSON.stringify(await queued(page)) + JSON.stringify(await turns(page))); });
      assert.equal((await composerText(page)).trim(), "");
    },
  ],
];
