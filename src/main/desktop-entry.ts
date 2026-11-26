import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Quotes a path for a desktop entry's Exec key, per the Desktop Entry spec's escaping rules. */
const execQuote = (path: string): string => `"${path.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;

/**
 * The app menu entry for an AppImage. CHROME_DESKTOP gives the window the app id `midad`,
 * which StartupWMClass and the dock use to match the window to this entry.
 */
export const desktopEntry = ({ appImage }: { appImage: string }): string =>
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Midad",
    "GenericName=Arabic book reader",
    "Comment=Read, annotate and study classical Arabic books",
    `Exec=env CHROME_DESKTOP=midad.desktop ${execQuote(appImage)} %U`,
    "Icon=midad",
    "Terminal=false",
    "Categories=Education;",
    "Keywords=arabic;reader;books;مداد;",
    "StartupWMClass=midad",
    "",
  ].join("\n");

const writeIfChanged = ({ file, content }: { file: string; content: string | Buffer }): boolean => {
  if (existsSync(file) && readFileSync(file).equals(Buffer.from(content))) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
};

/**
 * Adds Midad to the app menu when it runs as an AppImage, which doesn't do this itself.
 * Runs on every launch so the entry follows the AppImage if it's moved; only changed files are written.
 */
export const installDesktopEntry = ({ appImage, iconsDir, dataHome }: { appImage: string; iconsDir: string; dataHome: string }): boolean => {
  const icons = [
    { from: join(iconsDir, "icon.svg"), to: join(dataHome, "icons", "hicolor", "scalable", "apps", "midad.svg") },
    { from: join(iconsDir, "icon.png"), to: join(dataHome, "icons", "hicolor", "512x512", "apps", "midad.png") },
  ];
  const iconsChanged = icons.map(({ from, to }) => existsSync(from) && writeIfChanged({ file: to, content: readFileSync(from) }));
  const entryChanged = writeIfChanged({ file: join(dataHome, "applications", "midad.desktop"), content: desktopEntry({ appImage }) });
  return entryChanged || iconsChanged.some(Boolean);
};
