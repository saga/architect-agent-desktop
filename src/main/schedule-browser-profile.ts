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
  let firstError: unknown;
  let hasError = false;
  const operations = [
    () => profile.clearStorageData(),
    () => profile.clearCache(),
    () => profile.clearAuthCache(),
  ];
  for (const operation of operations) {
    try { await operation(); }
    catch (error) {
      if (!hasError) { firstError = error; hasError = true; }
    }
  }
  try { profile.flushStorageData(); }
  catch (error) {
    if (!hasError) { firstError = error; hasError = true; }
  }
  if (hasError) throw firstError;
}

export interface ScheduleBrowserProfileWindow {
  isDestroyed(): boolean;
  destroy(): void;
}

export function destroyScheduleBrowserProfileWindows(
  windows: Iterable<ScheduleBrowserProfileWindow>,
): unknown[] {
  const failures: unknown[] = [];
  const seen = new Set<ScheduleBrowserProfileWindow>();
  for (const window of windows) {
    if (seen.has(window)) continue;
    seen.add(window);
    try { if (!window.isDestroyed()) window.destroy(); }
    catch (error) { failures.push(error); }
  }
  return failures;
}

export interface ScheduleBrowserDownloadItem {
  cancel(): void;
}

export function cancelScheduleBrowserDownloads(
  downloads: Iterable<ScheduleBrowserDownloadItem>,
): unknown[] {
  const failures: unknown[] = [];
  const seen = new Set<ScheduleBrowserDownloadItem>();
  for (const item of downloads) {
    if (seen.has(item)) continue;
    seen.add(item);
    try { item.cancel(); }
    catch (error) { failures.push(error); }
  }
  return failures;
}

/** Keep unattended downloads under a directory unique to each Schedule profile. */
export function scheduleBrowserDownloadsDirectory(downloadsRoot: string, scheduleId: string): string {
  if (!path.isAbsolute(downloadsRoot)) throw new Error("Schedule downloads root must be an absolute path.");
  const profileId = scheduleBrowserPartition(scheduleId).slice("persist:".length);
  return path.join(path.resolve(downloadsRoot), "Architect Agent Desktop", "Schedules", profileId);
}

/**
 * Produce a unique, traversal-safe file path inside a Schedule's download folder.
 * The caller must create the directory before registering the will-download handler.
 */
export function scheduleBrowserDownloadPath(
  downloadDirectory: string,
  downloadId: number,
  originalFileName: string,
  timestamp = Date.now(),
): string {
  if (!path.isAbsolute(downloadDirectory)) throw new Error("Schedule download directory must be an absolute path.");
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) throw new Error("Schedule download ID must be a non-negative safe integer.");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Schedule download timestamp must be a non-negative safe integer.");

  const candidate = path.posix.basename(String(originalFileName ?? "").replace(/\\/g, "/"));
  let safeName = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || "download";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safeName)) safeName = "_" + safeName;

  const directory = path.resolve(downloadDirectory);
  const target = path.resolve(directory, String(timestamp) + "-" + String(downloadId) + "-" + safeName);
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
