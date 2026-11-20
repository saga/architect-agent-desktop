import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Persisted state is private to the current user. */
const DEFAULT_MODE = 0o600;

export interface JsonWriteOptions {
  /** Permission bits for the new file. Defaults to 0o600. */
  mode?: number;
}

/**
 * Write JSON to a file without ever leaving a partially written document behind.
 *
 * The previous implementation overwrote the target in place, so a crash, a full
 * disk or a forced quit during `writeFileSync` truncated settings and sessions.
 * Here the payload goes to a sibling temporary file, is flushed with fsync and
 * then renamed over the target, which is atomic on a single filesystem.
 */
export function writeJsonAtomic(filePath: string, value: unknown, options: JsonWriteOptions = {}): void {
  const mode = options.mode ?? DEFAULT_MODE;
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  let handle: number | undefined;
  try {
    handle = openSync(tempPath, "wx", mode);
    writeSync(handle, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    // Rename replaces the inode, so an existing file also picks up `mode`.
    renameSync(tempPath, filePath);
  } catch (error) {
    if (handle !== undefined) {
      try { closeSync(handle); } catch { /* best effort cleanup */ }
    }
    try { rmSync(tempPath, { force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
}
