import { createHash } from "node:crypto";

/** Stable, opaque Electron partition per Schedule. Never shares the user's main browser profile. */
export function scheduleBrowserPartition(scheduleId: string): string {
  if (typeof scheduleId !== "string" || !scheduleId.trim() || scheduleId.length > 100) {
    throw new Error("A valid Schedule ID is required for its Browser Profile.");
  }
  const digest = createHash("sha256").update(scheduleId.trim(), "utf8").digest("hex").slice(0, 32);
  return "persist:architect-agent-schedule-" + digest;
}

/**
 * Initialize a Schedule Browser Context atomically from the caller's perspective.
 * If any setup step fails, release the partially-created resources before rethrowing.
 */
export async function initializeScheduleBrowserContext<T>(
  context: T,
  initialize: (context: T) => Promise<void>,
  dispose: (context: T) => void,
): Promise<T> {
  try {
    await initialize(context);
    return context;
  } catch (error) {
    // Cleanup is best-effort; preserve the setup error as the actionable failure.
    try { dispose(context); } catch { /* preserve original initialization error */ }
    throw error;
  }
}

/** Only safe HTTP(S)/about:blank URLs may create OAuth popups, with bounded nesting. */
export function canOpenScheduleBrowserPopup(isSafeUrl: boolean, depth: number): boolean {
  return isSafeUrl && Number.isInteger(depth) && depth >= 0 && depth < 3;
}
