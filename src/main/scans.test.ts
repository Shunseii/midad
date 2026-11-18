import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScans, type ScanBytes } from "./scans";

let dir: string;
let fetched: string[];
let fail: Error | null;

const fetchScan = async ({ bookId, fileId }: { bookId: string; fileId: string }): Promise<ScanBytes> => {
  fetched.push(`${bookId}/${fileId}`);
  if (fail) throw fail;
  return { bytes: new TextEncoder().encode(`scan of ${fileId}`), contentType: "image/jpeg" };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamish-scans-"));
  fetched = [];
  fail = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const text = (scan: ScanBytes) => new TextDecoder().decode(scan.bytes);

describe("scans", () => {
  it("fetches a scan the first time and serves it from disk after", async () => {
    const scans = createScans({ dir, fetchScan });
    expect(text(await scans.get({ bookId: "b1", fileId: "f1" }))).toBe("scan of f1");
    const again = await scans.get({ bookId: "b1", fileId: "f1" });
    expect(text(again)).toBe("scan of f1");
    expect(again.contentType).toBe("image/jpeg");
    expect(fetched).toEqual(["b1/f1"]);
  });

  it("keeps cached scans across restarts and works offline", async () => {
    await createScans({ dir, fetchScan }).get({ bookId: "b1", fileId: "f1" });
    fail = new Error("offline");
    expect(text(await createScans({ dir, fetchScan }).get({ bookId: "b1", fileId: "f1" }))).toBe("scan of f1");
  });

  it("passes on a failed fetch and caches nothing", async () => {
    fail = new Error("401 unauthorized");
    const scans = createScans({ dir, fetchScan });
    await expect(scans.get({ bookId: "b1", fileId: "f2" })).rejects.toThrow("401");
    expect(readdirSync(dir, { recursive: true }).filter((f) => String(f).includes("f2"))).toEqual([]);
  });

  it("refuses ids that would leave the cache folder", async () => {
    const scans = createScans({ dir, fetchScan });
    await expect(scans.get({ bookId: "..", fileId: "f1" })).rejects.toThrow(/id/);
    await expect(scans.get({ bookId: "b1", fileId: "../x" })).rejects.toThrow(/id/);
    expect(fetched).toEqual([]);
  });
});
