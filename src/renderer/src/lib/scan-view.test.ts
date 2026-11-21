import { describe, expect, it } from "vitest";
import { canPan, clampView, FIT, MAX_SCALE, wheelScale, zoomAt } from "./scan-view";

const box = { width: 400, height: 500, aspect: 1.5 };

describe("clampView", () => {
  it("at fit, fills the width and lets a tall image move only up and down", () => {
    expect(clampView({ view: { scale: 1, x: 30, y: 40 }, box })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampView({ view: { scale: 1, x: 30, y: -40 }, box })).toEqual({ scale: 1, x: 0, y: -40 });
  });

  it("never lets a zoomed image's edge leave a gap", () => {
    expect(clampView({ view: { scale: 2, x: 50, y: 50 }, box })).toEqual({ scale: 2, x: 0, y: 0 });
    expect(clampView({ view: { scale: 2, x: -900, y: -2000 }, box })).toEqual({ scale: 2, x: -400, y: -700 });
  });

  it("keeps a short image at the top", () => {
    expect(clampView({ view: { scale: 1, x: 0, y: -30 }, box: { ...box, aspect: 1 } })).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("stays between fit and the largest zoom", () => {
    expect(clampView({ view: { scale: 0.5, x: 0, y: 0 }, box }).scale).toBe(1);
    expect(clampView({ view: { scale: 99, x: 0, y: 0 }, box }).scale).toBe(MAX_SCALE);
  });
});

describe("zoomAt", () => {
  it("holds the point under the pointer still", () => {
    const at = { x: 100, y: 150 };
    const view = zoomAt({ view: FIT, box, scale: 2, at });
    // The image point under the pointer was (100, 150) at scale 1; it's now at view + point * 2.
    expect(view.x + 100 * 2).toBeCloseTo(at.x);
    expect(view.y + 150 * 2).toBeCloseTo(at.y);
  });

  it("returns to fit when zoomed all the way out", () => {
    const square = { ...box, aspect: 1 };
    const zoomed = zoomAt({ view: FIT, box: square, scale: 3, at: { x: 300, y: 400 } });
    expect(zoomAt({ view: zoomed, box: square, scale: 1, at: { x: 10, y: 10 } })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("wheelScale", () => {
  it("zooms in on wheel up and out on wheel down", () => {
    expect(wheelScale({ scale: 1, deltaY: -100, pinch: false })).toBeGreaterThan(1.1);
    expect(wheelScale({ scale: 2, deltaY: 100, pinch: false })).toBeLessThan(2);
  });
});

describe("canPan", () => {
  it("is true when the image overflows the pane on either axis", () => {
    expect(canPan({ view: FIT, box: { ...box, aspect: 1 } })).toBe(false);
    expect(canPan({ view: FIT, box })).toBe(true);
    expect(canPan({ view: { scale: 2, x: 0, y: 0 }, box: { ...box, aspect: 1 } })).toBe(true);
  });
});
