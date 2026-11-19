import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RuntimeCapability,
  RuntimeCapabilityContext,
  RuntimeCapabilityHandlers,
} from "./runtime-types";

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 2_000;

function assertCapability(context: RuntimeCapabilityContext, capability: RuntimeCapability): void {
  if (!context.capabilities.has(capability)) {
    throw new Error("Capability not granted: " + capability);
  }
}

async function resolveWorkspacePath(rootValue: string | undefined, relativeValue: unknown, allowMissing = false): Promise<string> {
  if (!rootValue) throw new Error("No workspace is attached to this execution.");
  if (typeof relativeValue !== "string" || !relativeValue.trim() || relativeValue.includes(String.fromCharCode(0))) {
    throw new Error("A non-empty relative workspace path is required.");
  }
  if (path.isAbsolute(relativeValue) || /^[a-zA-Z]:/.test(relativeValue) || relativeValue.includes("\\")) {
    throw new Error("Workspace paths must be relative and use forward slashes.");
  }
  const segments = relativeValue.split("/");
  if (segments.some(part => !part || part === "." || part === "..")) {
    throw new Error("Workspace path traversal is not allowed.");
  }

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
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace root itself is not a file target.");
  }

  let resolved: string;
  if (allowMissing) {
    const parent = await realpath(path.dirname(candidate));
    const parentRelative = path.relative(root, parent);
    if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
      throw new Error("Workspace path escapes the selected workspace.");
    }
    const parentStat = await stat(parent);
    if (!parentStat.isDirectory()) throw new Error("Workspace parent must be a directory.");
    try {
      const targetStat = await lstat(candidate);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new Error("Workspace target must be a regular file.");
      }
      resolved = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      resolved = candidate;
    }
  } else {
    resolved = await realpath(candidate);
  }

  const finalRelative = path.relative(root, resolved);
  if (finalRelative.startsWith("..") || path.isAbsolute(finalRelative)) {
    throw new Error("Workspace path escapes the selected workspace.");
  }
  return resolved;
}

export function createWorkspaceCapabilityHandlers(): RuntimeCapabilityHandlers {
  return {
    "workspace.list": async (context, args) => {
      assertCapability(context, "workspace.list");
      const input = args as { path?: unknown; recursive?: unknown };
      const relative = typeof input?.path === "string" && input.path ? input.path : " .";
      const directory = relative === " ." ? await realpath(context.workspaceRoot ?? "") : await resolveWorkspacePath(context.workspaceRoot, relative);
      const entries: Array<{ path: string; type: "file" | "directory" }> = [];
      const visit = async (current: string, prefix: string, depth: number): Promise<void> => {
        if (depth > 8 || entries.length >= MAX_LIST_ITEMS) return;
        for (const entry of await readdir(current, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
          const childPath = path.join(current, entry.name);
          const childRelative = prefix ? prefix + "/" + entry.name : entry.name;
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            entries.push({ path: childRelative, type: "directory" });
            if (input?.recursive === true) await visit(childPath, childRelative, depth + 1);
          } else if (entry.isFile()) {
            entries.push({ path: childRelative, type: "file" });
          }
          if (entries.length >= MAX_LIST_ITEMS) break;
        }
      };
      const directoryStat = await stat(directory);
      if (!directoryStat.isDirectory()) throw new Error("Workspace list target must be a directory.");
      await visit(directory, "", 0);
      return entries;
    },
    "workspace.read": async (context, args) => {
      assertCapability(context, "workspace.read");
      const input = args as { path?: unknown };
      const file = await resolveWorkspacePath(context.workspaceRoot, input?.path);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular files can be read.");
      if (info.size > MAX_READ_BYTES) throw new Error("File exceeds the 256 KB read limit.");
      return readFile(file, "utf8");
    },
    "workspace.write": async (context, args) => {
      assertCapability(context, "workspace.write");
      const input = args as { path?: unknown; content?: unknown };
      if (typeof input?.content !== "string" || Buffer.byteLength(input.content, "utf8") > MAX_WRITE_BYTES) {
        throw new Error("Workspace content must be text no larger than 256 KB.");
      }
      const file = await resolveWorkspacePath(context.workspaceRoot, input.path, true);
      await writeFile(file, input.content, { encoding: "utf8", flag: "w", mode: 0o600 });
      return { path: input.path, bytesWritten: Buffer.byteLength(input.content, "utf8") };
    },
  };
}
