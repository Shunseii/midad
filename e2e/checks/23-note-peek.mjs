import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Note peek";

const PEEK = "[data-slot=popover-content] [data-note-peek]";
const ARROW = "[data-slot=popover-arrow]";
const WORD = `[data-part=matn][data-line="3"][data-w="2"]`;

const arrowLook = (page) =>
  page.ev(`(() => {
    const arrow = document.querySelector("${ARROW}");
    const edge = getComputedStyle(arrow.querySelector("path")).stroke;
    const shadows = getComputedStyle(document.querySelector("${PEEK}")).boxShadow.split(/,(?![^(]*\\))/).map((s) => s.trim());
    const r = arrow.getBoundingClientRect();
    // Just inside the arrow's base, where it overlaps the ring.
    const y = arrow.dataset.side === "top" ? r.top + 1.5 : r.bottom - 1.5;
    const onTop = arrow.contains(document.elementFromPoint(r.left + r.width / 2, y));
    return { edge, shadows, onTop };
  })()`);

export const checks = [
  [
    "a hovered peek's ring runs round its arrow, which sits in front; unhovered the arrow has no ring",
    async (page) => {
      await page.ev(`window.midad["notes.add"](${JSON.stringify({ bookId: LONG_BOOK, position: 40, span: { part: "matn", start: { line: 3, word: 2 }, end: { line: 3, word: 3 } }, body: "ملاحظة" })})`);
      await openReader(page, { bookId: LONG_BOOK, position: 40 });
      await page.ev(`document.querySelector('${WORD}').scrollIntoView({ block: "start" })`);
      await page.sleep(300);
      const word = await page.rectOf(WORD);
      await page.move(word.cx, word.cy);
      await page.waitFor(`!!document.querySelector("${PEEK}")`, { message: "hovering the noted words didn't show the peek" });
      await page.sleep(500);

      const plain = await arrowLook(page);
      assert.equal(plain.edge, "rgba(0, 0, 0, 0)", "the arrow has a coloured edge before the peek is hovered");

      const peek = await page.rectOf(PEEK);
      await page.move(peek.cx, peek.cy);
      await page.sleep(300);
      const hovered = await arrowLook(page);
      // The ring is the shadow that hovering added.
      const ring = hovered.shadows.find((s) => !plain.shadows.includes(s))?.match(/^rgba?\([^)]*\)/)?.[0];
      assert.ok(ring, `hovering the peek didn't ring it: ${hovered.shadows.join(", ")}`);
      assert.equal(hovered.edge, ring, "the arrow's edge isn't the peek's ring colour");
      assert.ok(hovered.onTop, "the arrow is behind the peek");
    },
  ],
];
