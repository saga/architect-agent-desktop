import { createHash } from "node:crypto";

/** Stable, opaque Electron partition per Schedule. Never shares the user's main browser profile. */
export function scheduleBrowserPartition(scheduleId: string): string {
  if (typeof scheduleId !== "string" || !scheduleId.trim() || scheduleId.length > 100) {
    throw new Error("A valid Schedule ID is required for its Browser Profile.");
  }
  const digest = createHash("sha256").update(scheduleId.trim(), "utf8").digest("hex").slice(0, 32);
  return "persist:architect-agent-schedule-" + digest;
}

/** Only safe HTTP(S)/about:blank URLs may create OAuth popups, with bounded nesting. */
export function canOpenScheduleBrowserPopup(isSafeUrl: boolean, depth: number): boolean {
  return isSafeUrl && Number.isInteger(depth) && depth >= 0 && depth < 3;
}
