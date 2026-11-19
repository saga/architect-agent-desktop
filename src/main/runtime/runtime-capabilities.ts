import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  RuntimeCapability,
  RuntimeCapabilityContext,
  RuntimeCapabilityHandlers,
} from "./runtime-types";

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 2_000;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

function assertCapability(context: RuntimeCapabilityContext, capability: RuntimeCapability): void {
  if (!context.capabilities.has(capability)) throw new Error("Capability not granted: " + capability);
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Workspace path escapes the selected workspace.");
  }
}

async function resolveWorkspacePath(rootValue: string | undefined, relativeValue: unknown, allowMissing = false): Promise<{ root: string; file: string }> {
  if (!rootValue) throw new Error("No workspace is attached to this execution.");
  if (typeof relativeValue !== "string" || !relativeValue.trim() || relativeValue.includes(String.fromCharCode(0))) {
    throw new Error("A non-empty relative workspace path is required.");
  }
  if (path.isAbsolute(relativeValue) || /^[a-zA-Z]:/.test(relativeValue) || relativeValue.includes("\\")) {
    throw new Error("Workspace paths must be relative and use forward slashes.");
  }
  const segments = relativeValue.split("/");
  if (segments.some(part => !part || part === "." || part === "..")) throw new Error("Workspace path traversal is not allowed.");

  const root = await realpath(rootValue);
  let cursor = root;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]!);
    try {
      const component = await lstat(cursor);
      if (component.isSymbolicLink()) throw new Error("Workspace symlink traversal is not allowed.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing && index === segments.length - 1) break;
      throw error;
    }
  }

  const candidate = path.resolve(root, ...segments);
  if (candidate === root) throw new Error("Workspace root itself is not a file target.");
  let resolved: string;
  if (allowMissing) {
    const parent = await realpath(path.dirname(candidate));
    assertInside(root, parent);
    if (!(await stat(parent)).isDirectory()) throw new Error("Workspace parent must be a directory.");
    try {
      const targetStat = await lstat(candidate);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) throw new Error("Workspace target must be a regular file.");
      resolved = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      resolved = candidate;
    }
  } else resolved = await realpath(candidate);
  assertInside(root, resolved);
  return { root, file: resolved };
}

async function verifyOpenedWorkspaceFile(
  root: string,
  expectedFile: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<Awaited<ReturnType<typeof handle.stat>>> {
  const [actualFile, pathInfo, openedInfo] = await Promise.all([realpath(expectedFile), lstat(expectedFile), handle.stat()]);
  assertInside(root, actualFile);
  const samePath = process.platform === "win32"
    ? actualFile.toLowerCase() === expectedFile.toLowerCase()
    : actualFile === expectedFile;
  const sameIdentity = !pathInfo.ino || !openedInfo.ino
    ? pathInfo.dev === openedInfo.dev
    : pathInfo.dev === openedInfo.dev && pathInfo.ino === openedInfo.ino;
  if (!samePath || pathInfo.isSymbolicLink() || !pathInfo.isFile() || !sameIdentity || !openedInfo.isFile()) {
    throw new Error("Workspace file changed during access; retry the operation.");
  }
  return openedInfo;
}

export function createWorkspaceCapabilityHandlers(): RuntimeCapabilityHandlers {
  return {
    "workspace.list": async (context, args) => {
      assertCapability(context, "workspace.list");
      if (!context.workspaceRoot) throw new Error("No workspace is attached to this execution.");
      const input = args as { path?: unknown; recursive?: unknown };
      const root = await realpath(context.workspaceRoot);
      const requestedPath = typeof input?.path === "string" ? input.path.trim() : "";
      const directory = requestedPath ? (await resolveWorkspacePath(context.workspaceRoot, requestedPath)).file : root;
      const canonicalDirectory = await realpath(directory);
      assertInside(root, canonicalDirectory);
      if (!(await stat(canonicalDirectory)).isDirectory()) throw new Error("Workspace list target must be a directory.");

      const entries: Array<{ path: string; type: "file" | "directory" }> = [];
      const visit = async (current: string, prefix: string, depth: number): Promise<void> => {
        if (depth > 8 || entries.length >= MAX_LIST_ITEMS) return;
        const canonicalCurrent = await realpath(current);
        assertInside(root, canonicalCurrent);
        for (const entry of await readdir(canonicalCurrent, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.isSymbolicLink()) continue;
          const childPath = path.join(canonicalCurrent, entry.name);
          const childRelative = prefix ? prefix + "/" + entry.name : entry.name;
          if (entry.isDirectory()) {
            const canonicalChild = await realpath(childPath);
            assertInside(root, canonicalChild);
            if (canonicalChild !== childPath) continue;
            entries.push({ path: childRelative, type: "directory" });
            if (input?.recursive === true) await visit(canonicalChild, childRelative, depth + 1);
          } else if (entry.isFile()) entries.push({ path: childRelative, type: "file" });
          if (entries.length >= MAX_LIST_ITEMS) break;
        }
      };
      await visit(canonicalDirectory, "", 0);
      return entries;
    },
    "workspace.read": async (context, args) => {
      assertCapability(context, "workspace.read");
      const input = args as { path?: unknown };
      const { root, file } = await resolveWorkspacePath(context.workspaceRoot, input?.path);
      const handle = await open(file, fsConstants.O_RDONLY | NO_FOLLOW);
      try {
        const info = await verifyOpenedWorkspaceFile(root, file, handle);
        if (info.size > MAX_READ_BYTES) throw new Error("File exceeds the 256 KB read limit.");
        return await handle.readFile({ encoding: "utf8" });
      } finally { await handle.close(); }
    },
    "workspace.write": async (context, args) => {
      assertCapability(context, "workspace.write");
      const input = args as { path?: unknown; content?: unknown };
      if (typeof input?.content !== "string" || Buffer.byteLength(input.content, "utf8") > MAX_WRITE_BYTES) {
        throw new Error("Workspace content must be text no larger than 256 KB.");
      }
      const { root, file } = await resolveWorkspacePath(context.workspaceRoot, input.path, true);
      const handle = await open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | NO_FOLLOW, 0o600);
      try {
        await verifyOpenedWorkspaceFile(root, file, handle);
        await handle.truncate(0);
        await handle.writeFile(input.content, { encoding: "utf8" });
      } finally { await handle.close(); }
      return { path: input.path, bytesWritten: Buffer.byteLength(input.content, "utf8") };
    },
  };
}
