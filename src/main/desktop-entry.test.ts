import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desktopEntry, installDesktopEntry } from "./desktop-entry";

let dir: string;
let iconsDir: string;
let dataHome: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "midad-desktop-"));
  iconsDir = join(dir, "resources");
  dataHome = join(dir, "share");
  mkdirSync(iconsDir);
  writeFileSync(join(iconsDir, "icon.svg"), "<svg/>");
  writeFileSync(join(iconsDir, "icon.png"), "png-bytes");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entryFile = () => join(dataHome, "applications", "midad.desktop");

describe("desktopEntry", () => {
  it("launches the AppImage with the window id the dock matches on", () => {
    const entry = desktopEntry({ appImage: "/home/u/Applications/Midad.AppImage" });
    expect(entry).toContain('Exec=env CHROME_DESKTOP=midad.desktop "/home/u/Applications/Midad.AppImage" %U');
    expect(entry).toContain("StartupWMClass=midad");
    expect(entry).toContain("Icon=midad");
  });

  it("escapes characters that would break the Exec line", () => {
    expect(desktopEntry({ appImage: '/home/u/My "Apps"/$x/Midad.AppImage' })).toContain('"/home/u/My \\"Apps\\"/\\$x/Midad.AppImage"');
  });
});

describe("installDesktopEntry", () => {
  it("adds the menu entry and both icons on first run", () => {
    expect(installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome })).toBe(true);
    expect(readFileSync(entryFile(), "utf8")).toBe(desktopEntry({ appImage: "/opt/Midad.AppImage" }));
    expect(readFileSync(join(dataHome, "icons/hicolor/scalable/apps/midad.svg"), "utf8")).toBe("<svg/>");
    expect(readFileSync(join(dataHome, "icons/hicolor/512x512/apps/midad.png"), "utf8")).toBe("png-bytes");
  });

  it("leaves everything untouched when nothing changed", () => {
    installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome });
    const before = statSync(entryFile()).mtimeMs;
    expect(installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome })).toBe(false);
    expect(statSync(entryFile()).mtimeMs).toBe(before);
  });

  it("points the entry at the AppImage's new place after it moves", () => {
    installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome });
    expect(installDesktopEntry({ appImage: "/home/u/Midad.AppImage", iconsDir, dataHome })).toBe(true);
    expect(readFileSync(entryFile(), "utf8")).toContain('"/home/u/Midad.AppImage"');
  });

  it("replaces a hand-made entry with its own", () => {
    mkdirSync(join(dataHome, "applications"), { recursive: true });
    writeFileSync(entryFile(), "[Desktop Entry]\nExec=/old/launcher\n");
    installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome });
    expect(readFileSync(entryFile(), "utf8")).not.toContain("/old/launcher");
  });

  it("still adds the entry when the icons are missing", () => {
    rmSync(iconsDir, { recursive: true });
    installDesktopEntry({ appImage: "/opt/Midad.AppImage", iconsDir, dataHome });
    expect(existsSync(entryFile())).toBe(true);
    expect(existsSync(join(dataHome, "icons"))).toBe(false);
  });
});
