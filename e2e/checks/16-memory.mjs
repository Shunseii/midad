import assert from "node:assert/strict";

export const name = "Settings memory";

const ROW = "[data-memory]";
const rows = (page) => page.ev(`[...document.querySelectorAll(${JSON.stringify(ROW)})].map((r) => r.innerText)`);
const rowWith = (text) => `js:[...document.querySelectorAll(${JSON.stringify(ROW)})].find((r) => r.innerText.includes(${JSON.stringify(text)}))`;
const buttonIn = (text, label) => `js:${rowWith(text).slice(3)}?.querySelector('[aria-label=${JSON.stringify(label)}]')`;

const openMemory = async (page) => {
  await page.go("#/settings", `!!document.querySelector("#memory")`);
  await page.ev(`document.querySelector("#memory").scrollIntoView({ block: "start" })`);
  await page.waitFor(`document.querySelectorAll(${JSON.stringify(ROW)}).length > 0`, { message: "no memories listed" });
  await page.sleep(300);
};

export const checks = [
  [
    "lists every memory, labelled by who wrote it and with its book",
    async (page) => {
      await openMemory(page);
      const listed = await rows(page);
      assert.equal(listed.length, 2);
      const goal = listed.find((r) => r.includes("Reading for the exam"));
      assert.ok(goal?.includes("Ask AI"), `not labelled as Ask AI's: ${goal}`);
      assert.ok(goal?.includes("كتاب الاختبار الطويل"), `the book memory doesn't name its book: ${goal}`);
      assert.ok(listed.find((r) => r.includes("Transliterate"))?.includes("All books"));
      assert.ok(await page.ev(`document.body.innerText.includes("2 memories")`));
    },
  ],
  [
    "edits a memory in place, which then reads as the reader's",
    async (page) => {
      await page.click(buttonIn("Transliterate", "Edit memory"));
      await page.waitFor(`!!document.querySelector("form[aria-label='Edit memory'] textarea")`, { message: "the editor didn't open" });
      await page.ev(`document.querySelector("form[aria-label='Edit memory'] textarea").select()`);
      await page.type("Write the Arabic, then (ism).");
      await page.click(`js:[...document.querySelectorAll("form[aria-label='Edit memory'] button")].find((b) => b.textContent === "Save")`);
      await page.waitFor(`!document.querySelector("form[aria-label='Edit memory']")`, { message: "the editor didn't close on save" });
      await page.waitFor(`${rowWith("Write the Arabic, then (ism).").slice(3)}?.querySelector("[data-memory-source=reader]") != null`, {
        message: "the edited memory isn't labelled as the reader's",
      });
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
