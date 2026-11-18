import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ScanBytes {
  bytes: Uint8Array;
  contentType: string;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/tiff": "tiff" };
const TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));
const SAFE_ID = /^[\w-]+$/;

/**
 * Page scans, fetched from the corpus the first time a page's scan is opened
 * and kept on disk after that, so pages already seen work offline.
 */
export const createScans = ({
  dir,
  fetchScan,
}: {
  dir: string;
  fetchScan: (input: { bookId: string; fileId: string }) => Promise<ScanBytes>;
}) => ({
  async get({ bookId, fileId }: { bookId: string; fileId: string }): Promise<ScanBytes> {
    if (!SAFE_ID.test(bookId) || !SAFE_ID.test(fileId)) throw new Error("That isn't a valid book or file id.");
    const folder = join(dir, bookId);
    const cached = existsSync(folder) ? readdirSync(folder).find((f) => f.startsWith(`${fileId}.`)) : undefined;
    if (cached) {
      const ext = cached.slice(fileId.length + 1);
      return { bytes: readFileSync(join(folder, cached)), contentType: TYPES[ext] ?? "application/octet-stream" };
    }
    const scan = await fetchScan({ bookId, fileId });
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${fileId}.${EXTENSIONS[scan.contentType] ?? "bin"}`);
    writeFileSync(`${file}.tmp`, scan.bytes);
    renameSync(`${file}.tmp`, file);
    return scan;
  },
});

export type Scans = ReturnType<typeof createScans>;
