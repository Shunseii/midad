import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseNotesUrl, type UpdatePhase, type UpdateStatus } from "../shared/update";
import { CHECK_EVERY_MS, createUpdater, nextPhase, type UpdaterEvent, updateErrorMessage, updaterMode, type UpdateSource } from "./updater";

describe("updaterMode", () => {
  it("is managed when run from source, on every platform", () => {
    expect(updaterMode({ isPackaged: false, platform: "win32", env: {} })).toBe("managed");
    expect(updaterMode({ isPackaged: false, platform: "linux", env: { APPIMAGE: "/home/me/Midad.AppImage" } })).toBe("managed");
  });

  it("is on for a packaged Windows build", () => {
    expect(updaterMode({ isPackaged: true, platform: "win32", env: {} })).toBe("on");
  });

  it("is on for Linux only when running as an AppImage", () => {
    expect(updaterMode({ isPackaged: true, platform: "linux", env: { APPIMAGE: "/home/me/Midad.AppImage" } })).toBe("on");
    expect(updaterMode({ isPackaged: true, platform: "linux", env: {} })).toBe("managed");
    expect(updaterMode({ isPackaged: true, platform: "linux", env: { APPIMAGE: "" } })).toBe("managed");
  });

  it("is managed on platforms Midad isn't released for", () => {
    expect(updaterMode({ isPackaged: true, platform: "darwin", env: {} })).toBe("managed");
  });
});

describe("nextPhase", () => {
  const run = (events: UpdaterEvent[], from: UpdatePhase = { kind: "idle" }) => events.reduce((phase, event) => nextPhase({ phase, event }), from);

  it("goes from checking to up to date", () => {
    expect(run([{ type: "checking" }, { type: "notAvailable" }])).toEqual({ kind: "upToDate" });
  });

  it("downloads an available update with rounded, clamped progress, then is ready", () => {
    expect(run([{ type: "checking" }, { type: "available", version: "0.3.0" }])).toEqual({ kind: "downloading", version: "0.3.0", percent: 0 });
    expect(run([{ type: "available", version: "0.3.0" }, { type: "progress", percent: 41.6 }])).toEqual({ kind: "downloading", version: "0.3.0", percent: 42 });
    expect(run([{ type: "available", version: "0.3.0" }, { type: "progress", percent: 140 }])).toEqual({ kind: "downloading", version: "0.3.0", percent: 100 });
    expect(run([{ type: "available", version: "0.3.0" }, { type: "downloaded", version: "0.3.0" }])).toEqual({ kind: "ready", version: "0.3.0" });
  });

  it("stays ready whatever a later check says", () => {
    const ready: UpdatePhase = { kind: "ready", version: "0.3.0" };
    expect(run([{ type: "checking" }, { type: "error", message: "no connection" }, { type: "notAvailable" }], ready)).toEqual(ready);
    expect(run([{ type: "downloaded", version: "0.4.0" }], ready)).toEqual({ kind: "ready", version: "0.4.0" });
  });

  it("tells a failed check from a failed download", () => {
    expect(run([{ type: "checking" }, { type: "error", message: "no connection" }])).toEqual({ kind: "error", during: "check", message: "no connection" });
    expect(run([{ type: "available", version: "0.3.0" }, { type: "error", message: "the download was damaged" }])).toEqual({
      kind: "error",
      during: "download",
      message: "the download was damaged",
    });
  });

  it("keeps a download going through a checking event", () => {
    const downloading: UpdatePhase = { kind: "downloading", version: "0.3.0", percent: 10 };
    expect(run([{ type: "checking" }], downloading)).toEqual(downloading);
  });

  it("never leaves managed", () => {
    expect(run([{ type: "checking" }, { type: "available", version: "9.9.9" }, { type: "downloaded", version: "9.9.9" }], { kind: "managed" })).toEqual({ kind: "managed" });
  });
});

describe("updateErrorMessage", () => {
  it("shortens what electron-updater and the network say", () => {
    expect(updateErrorMessage(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("no connection");
    expect(updateErrorMessage(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("no connection");
    expect(updateErrorMessage(new Error("Cannot find latest-linux.yml in the latest release artifacts (https://…): HttpError: 404"))).toBe("no update published yet");
    expect(updateErrorMessage(new Error("HttpError: 403 rate limit exceeded"))).toBe("GitHub is busy, try later");
    expect(updateErrorMessage(new Error("sha512 checksum mismatch, expected abc"))).toBe("the download was damaged");
    expect(updateErrorMessage(new Error(`${"x".repeat(100)}\nstack`))).toHaveLength(80);
    expect(updateErrorMessage("")).toBe("unknown error");
  });
});

/** A stand-in for electron-updater: each check runs the scripted events. */
const fakeSource = (script: () => UpdaterEvent[] | Error) => {
  let emit: (event: UpdaterEvent) => void = () => {};
  const source = {
    checks: 0,
    installs: 0,
    listen: (onEvent: (event: UpdaterEvent) => void) => {
      emit = onEvent;
    },
    check: async () => {
      source.checks += 1;
      emit({ type: "checking" });
      const result = script();
      if (result instanceof Error) {
        emit({ type: "error", message: updateErrorMessage(result) });
        throw result;
      }
      for (const event of result) emit(event);
    },
    install: () => {
      source.installs += 1;
    },
    emit: (event: UpdaterEvent) => emit(event),
  } satisfies UpdateSource & Record<string, unknown>;
  return source;
};

describe("createUpdater", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = ({ mode = "on" as const, source }: { mode?: "on" | "managed"; source: ReturnType<typeof fakeSource> | null }) => {
    const seen: UpdateStatus[] = [];
    const updater = createUpdater({ mode, currentVersion: "0.2.0", source, onStatus: (s) => seen.push(s), now: () => 1_000 });
    return { updater, seen };
  };

  it("never checks or installs when managed", async () => {
    const source = fakeSource(() => [{ type: "available", version: "0.3.0" }]);
    const { updater } = make({ mode: "managed", source });
    updater.start();
    await updater.check();
    expect(source.checks).toBe(0);
    expect(updater.status().phase).toEqual({ kind: "managed" });
    expect(() => updater.restart()).toThrow();
    expect(source.installs).toBe(0);
  });

  it("checks on start and every 6 hours, recording when it reached the feed", async () => {
    const source = fakeSource(() => [{ type: "notAvailable" }]);
    const { updater, seen } = make({ source });
    updater.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.checks).toBe(1);
    expect(updater.status()).toMatchObject({ phase: { kind: "upToDate" }, checkedAt: 1_000, currentVersion: "0.2.0" });
    expect(seen.map((s) => s.phase.kind)).toEqual(["checking", "upToDate"]);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    expect(source.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(source.checks).toBe(2);
    updater.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(source.checks).toBe(2);
  });

  it("reports a failed check with its reason, and Check now tries again", async () => {
    let offline = true;
    const source = fakeSource(() => (offline ? new Error("getaddrinfo EAI_AGAIN github.com") : [{ type: "notAvailable" }]));
    const { updater } = make({ source });
    await updater.check();
    expect(updater.status().phase).toEqual({ kind: "error", during: "check", message: "no connection" });
    expect(updater.status().checkedAt).toBeNull();
    offline = false;
    await updater.check();
    expect(updater.status().phase).toEqual({ kind: "upToDate" });
  });

  it("doesn't check again while downloading or once ready", async () => {
    const source = fakeSource(() => [{ type: "available", version: "0.3.0" }]);
    const { updater } = make({ source });
    await updater.check();
    expect(updater.status().phase.kind).toBe("downloading");
    await updater.check();
    expect(source.checks).toBe(1);
    source.emit({ type: "downloaded", version: "0.3.0" });
    await updater.check();
    expect(source.checks).toBe(1);
    expect(releaseNotesUrl(updater.status())).toBe("https://github.com/Shunseii/midad/releases/tag/v0.3.0");
  });

  it("holds Restart while an answer streams, and installs once it's done", async () => {
    const source = fakeSource(() => [{ type: "available", version: "0.3.0" }, { type: "downloaded", version: "0.3.0" }]);
    const { updater, seen } = make({ source });
    expect(() => updater.restart()).toThrow("No update is ready yet.");
    await updater.check();
    updater.setBusy(true);
    expect(seen.at(-1)).toMatchObject({ phase: { kind: "ready", version: "0.3.0" }, restartBlocked: true });
    expect(() => updater.restart()).toThrow("Restart once Claude finishes answering.");
    expect(source.installs).toBe(0);
    updater.setBusy(false);
    expect(seen.at(-1)?.restartBlocked).toBe(false);
    updater.restart();
    expect(source.installs).toBe(1);
  });
});
