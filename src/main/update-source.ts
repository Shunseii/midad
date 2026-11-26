import { type UpdateSource, updateErrorMessage } from "./updater";

/**
 * electron-updater as an UpdateSource. Loaded only when the updater is on. The feed is the
 * `publish` entry electron-builder writes into the build (resources/app-update.yml).
 */
export const electronUpdateSource = async (): Promise<UpdateSource> => {
  const { default: electronUpdater } = await import("electron-updater");
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  return {
    listen: (onEvent) => {
      autoUpdater.on("checking-for-update", () => onEvent({ type: "checking" }));
      autoUpdater.on("update-available", (info) => onEvent({ type: "available", version: info.version }));
      autoUpdater.on("update-not-available", () => onEvent({ type: "notAvailable" }));
      autoUpdater.on("download-progress", (progress) => onEvent({ type: "progress", percent: progress.percent }));
      autoUpdater.on("update-downloaded", (info) => onEvent({ type: "downloaded", version: info.version }));
      autoUpdater.on("error", (err) => onEvent({ type: "error", message: updateErrorMessage(err) }));
    },
    check: () => autoUpdater.checkForUpdates(),
    // Silent on Windows, so the installer runs without its wizard; relaunches Midad afterwards.
    install: () => autoUpdater.quitAndInstall(true, true),
  };
};
