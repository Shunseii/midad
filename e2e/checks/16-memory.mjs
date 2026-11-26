import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";

export const name = "Settings memory";

const ROW = "[data-memory]";
const rows = (page) => page.ev(`[...document.querySelectorAll(${JSON.stringify(ROW)})].map((r) => r.innerText)`);
const rowWith = (text) => `js:[...document.querySelectorAll(${JSON.stringify(ROW)})].find((r) => r.innerText.includes(${JSON.stringify(text)}))`;
const buttonIn = (text, label) => `js:${rowWith(text).slice(3)}?.querySelector('[aria-label=${JSON.stringify(label)}]')`;

/** Each group's key (global or a book id) with the descriptions under it, in the order shown. */
const groups = (page) =>
  page.ev(`(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-memory-group], [data-memory], form[aria-label='Edit memory']")) {
      if (el.dataset.memoryGroup) out.push({ group: el.dataset.memoryGroup, title: el.innerText, rows: [] });
      else out.at(-1)?.rows.push(el.innerText.split("\\n")[1] ?? el.innerText);
    }
    return out;
  })()`);

const openMemory = async (page) => {
  await page.go("#/settings", `!!document.querySelector("#memory")`);
  await page.ev(`document.querySelector("#memory").scrollIntoView({ block: "start" })`);
  await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length > 0`, { message: "no memories listed" });
  await page.sleep(300);
};

export const checks = [
  [
    "groups memories under All books, then each book by its title, labelled by who wrote them",
    async (page) => {
      await openMemory(page);
      const shown = await groups(page);
      assert.deepEqual(
        shown.map((g) => g.group),
        ["global", LONG_BOOK],
      );
      assert.match(shown[0].title, /all books/i);
      assert.ok(shown[1].title.includes("كتاب الاختبار الطويل"), `the book's group isn't titled with the book: ${shown[1].title}`);
      assert.deepEqual(shown[0].rows, ["Transliterate Arabic terms"]);
      assert.deepEqual(shown[1].rows, ["Reading for the exam"]);
      const listed = await rows(page);
      assert.ok(listed.every((r) => r.includes("Ask AI") && !r.includes("edited")), `unexpected labels: ${listed.join(" | ")}`);
      assert.ok(await page.ev(`document.body.innerText.includes("2 memories")`));
    },
  ],
  [
    "edits a memory in place, which then shows its first author and that it was edited",
    async (page) => {
      await page.click(buttonIn("Transliterate", "Edit memory"));
      await page.waitFor(`!!document.querySelector("form[aria-label='Edit memory'] textarea")`, { message: "the editor didn't open" });
      await page.ev(`document.querySelector("form[aria-label='Edit memory'] textarea").select()`);
      await page.type("Write the Arabic, then (ism).");
      await page.click(`js:[...document.querySelectorAll("form[aria-label='Edit memory'] button")].find((b) => b.textContent === "Save")`);
      await page.waitFor(`!document.querySelector("form[aria-label='Edit memory']")`, { message: "the editor didn't close on save" });
      const row = rowWith("Write the Arabic, then (ism).").slice(3);
      await page.waitFor(`${row}?.querySelector("[data-memory-author=agent]") != null && ${row}.innerText.includes("edited")`, {
        message: "the edited memory doesn't show Ask AI as its author and that it was edited",
      });
    },
  ],
  [
    "moves a memory from All books to a book with Applies to",
    async (page) => {
      await page.click(buttonIn("Transliterate", "Edit memory"));
      await page.waitFor(`!!document.querySelector("form[aria-label='Edit memory'] select")`, { message: "no Applies to picker" });
      const options = await page.ev(`[...document.querySelector("form[aria-label='Edit memory'] select").options].map((o) => o.textContent)`);
      assert.deepEqual(options.slice(0, 1), ["All books"]);
      assert.ok(options.includes("كتاب الاختبار الطويل") && options.includes("رسالة قصيرة"), `books missing from the picker: ${options}`);
      await page.ev(`(() => {
        const select = document.querySelector("form[aria-label='Edit memory'] select");
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        set.call(select, ${JSON.stringify(LONG_BOOK)});
        select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
      await page.click(`js:[...document.querySelectorAll("form[aria-label='Edit memory'] button")].find((b) => b.textContent === "Save")`);
      await page.waitFor(`!document.querySelector("form[aria-label='Edit memory']")`, { message: "the editor didn't close on save" });
      await page.waitFor(`!document.querySelector("[data-memory-group=global]")`, { message: "the All books group didn't go once it was empty" });
      const shown = await groups(page);
      assert.deepEqual(shown.map((g) => g.group), [LONG_BOOK]);
      assert.equal(shown[0].rows.length, 2);
    },
  ],
  [
    "Esc cancels an edit without saving and stays in Settings",
    async (page) => {
      await page.click(buttonIn("Reading for the exam", "Edit memory"));
      await page.waitFor(`!!document.querySelector("form[aria-label='Edit memory']")`);
      await page.type(" CHANGED");
      await page.press("Escape");
      await page.waitFor(`!document.querySelector("form[aria-label='Edit memory']")`, { message: "Esc didn't close the editor" });
      assert.ok(!(await page.ev(`document.body.innerText.includes("CHANGED")`)), "Esc saved the edit");
      assert.match(await page.ev("location.hash"), /settings/);
    },
  ],
  [
    "searching filters the list",
    async (page) => {
      await page.click(`[aria-label="Search memories"]`);
      await page.type("exam");
      await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length === 1`, { message: "search didn't filter" });
      await page.type("zzz");
      await page.waitFor(`document.body.innerText.includes("No memories match")`);
      await page.ev(`(() => { const i = document.querySelector('[aria-label="Search memories"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length === 2`, { message: "clearing the search didn't bring the list back" });
    },
  ],
  [
    "deletes a memory with an Undo that brings it back",
    async (page) => {
      await page.click(buttonIn("Reading for the exam", "Delete memory"));
      await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length === 1`, { message: "the memory wasn't deleted" });
      await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Undo")`, { message: "no Undo toast" });
      await page.click(`js:[...document.querySelectorAll("button")].find((b) => b.textContent === "Undo")`);
      await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length === 2`, { message: "Undo didn't restore the memory" });
      assert.ok((await rows(page)).some((r) => r.includes("Reading for the exam")));
    },
  ],
  [
    "the buttons in a row are what a click at their centre hits",
    async (page) => {
      for (const label of ["Edit memory", "Delete memory"]) {
        const r = await page.rectOf(buttonIn("Transliterate", label));
        const hit = await page.ev(`document.elementFromPoint(${r.cx}, ${r.cy})?.closest("button")?.getAttribute("aria-label")`);
        assert.equal(hit, label);
      }
    },
  ],
];
