/** Where the release notes live: GitHub Releases, which is also the update feed. */
export const RELEASES_URL = "https://github.com/Shunseii/midad/releases";

export type UpdatePhase =
  /** This copy doesn't update itself: run from source, or not an AppImage on Linux. */
  | { kind: "managed" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; during: "check" | "download"; message: string };

export interface UpdateStatus {
  currentVersion: string;
  phase: UpdatePhase;
  /** When a check last reached the feed. */
  checkedAt: number | null;
  /** An Ask AI answer is streaming, so Restart waits for it. */
  restartBlocked: boolean;
}

export const releaseNotesUrl = (status: UpdateStatus): string =>
  status.phase.kind === "ready" ? `${RELEASES_URL}/tag/v${status.phase.version}` : RELEASES_URL;
