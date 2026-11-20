import { describe, expect, it } from "vitest";
import { neighbourPages } from "./neighbours";

describe("neighbourPages", () => {
  it("gives the next and the previous page, next first", () => {
    expect(neighbourPages({ position: 5, total: 10 })).toEqual([6, 4]);
  });

  it("has no previous page on the first page", () => {
    expect(neighbourPages({ position: 1, total: 10 })).toEqual([2]);
  });

  it("has no next page on the last page", () => {
    expect(neighbourPages({ position: 10, total: 10 })).toEqual([9]);
  });

  it("is empty for a one-page book and while the book is still loading", () => {
    expect(neighbourPages({ position: 1, total: 1 })).toEqual([]);
    expect(neighbourPages({ position: 1, total: 0 })).toEqual([]);
  });
});
