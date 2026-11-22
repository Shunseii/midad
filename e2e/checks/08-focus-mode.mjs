import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, openReader } from "../lib/reader.mjs";

export const name = "Focus mode";

const TRACE = `[...document.querySelectorAll("[data-state]")].find((e) => e.classList.contains("group/trace"))`;

export const checks = [
  [
    "leaves only the top progress line, no contents dots",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 56 });
      await page.waitFor(`!!document.querySelector("[data-entry][aria-current]")`, { message: "the contents rail isn't showing a current entry" });
      await clickPageArea(page);
      await page.press("f", { code: "KeyF" });
      const r = await page.rectOf("[data-page-area]");
      await page.move(r.cx, r.cy);
      await page.waitFor(`${TRACE}?.dataset.state === "shown"`, { timeout: 4000, message: "focus mode didn't hide the bars" });
      await page.sleep(400);
      const trace = await page.ev(`(() => { const t = ${TRACE}; return { children: t.children.length, dots: t.querySelectorAll(".rounded-full").length, lineHeight: Math.round(t.firstElementChild.getBoundingClientRect().height), lineTop: Math.round(t.firstElementChild.getBoundingClientRect().top) }; })()`);
      assert.equal(trace.dots, 0, "focus mode shows contents dots");
      assert.equal(trace.children, 1, "focus mode should leave only the progress line");
      assert.deepEqual([trace.lineTop, trace.lineHeight], [0, 2], "the progress line runs along the top");
      await page.press("f", { code: "KeyF" });
      await page.waitFor(`!${TRACE}`, { message: "F didn't leave focus mode" });
    },
  ],
];
