import { createHash } from "node:crypto";
import path from "node:path";

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

export interface ScheduleBrowserProfileStore {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  clearAuthCache(): Promise<void>;
  flushStorageData(): void;
}

/** Explicit Profile reset clears browser storage, network caches and HTTP authentication state. */
export async function clearScheduleBrowserProfileData(profile: ScheduleBrowserProfileStore): Promise<void> {
  await profile.clearStorageData();
  await profile.clearCache();
  await profile.clearAuthCache();
  profile.flushStorageData();
}

/**
 * Generate a safe, collision-resistant destination under the user's Downloads
 * directory. Never let a Content-Disposition filename escape the Schedule's
 * isolated download folder or overwrite a previous run's file.
 */
export function scheduleBrowserDownloadPath(
  downloadRoot: string,
  scheduleId: string,
  requestedFileName: string,
  downloadKey: string,
): string {
  if (!path.isAbsolute(downloadRoot)) throw new Error("Schedule download root must be an absolute path.");
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(downloadKey)) throw new Error("Invalid Schedule download identifier.");

  const partitionPrefix = "persist:architect-agent-schedule-";
  const profileKey = scheduleBrowserPartition(scheduleId).slice(partitionPrefix.length);
  let fileName = String(requestedFileName ?? "download")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 160) || "download";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(fileName)) fileName = "_" + fileName;

  const directory = path.resolve(downloadRoot, "Architect Agent Desktop", "Schedules", profileKey);
  const target = path.resolve(directory, downloadKey + "-" + fileName);
  const relative = path.relative(directory, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Schedule download path escapes its Profile directory.");
  }
  return target;
}

/** Only safe HTTP(S)/about:blank URLs may create OAuth popups, with bounded nesting. */
export function canOpenScheduleBrowserPopup(isSafeUrl: boolean, depth: number): boolean {
  return isSafeUrl && Number.isInteger(depth) && depth >= 0 && depth < 3;
}
