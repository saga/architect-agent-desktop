import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_LIST_FILES = 300;
const MAX_SEARCH_MATCHES = 40;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".venv", "vendor"]);

async function workspaceRoot(root: string): Promise<string> {
  const resolved = await realpath(root);
  if (!(await stat(resolved)).isDirectory()) throw new Error("工作区路径不是目录。");
  return resolved;
}

function isSkippableDirectoryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "ENOTDIR";
}

function assertInside(root: string, target: string, allowRoot = false): void {
  const relative = path.relative(root, target);
  if ((!allowRoot && !relative) || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("文件路径必须位于当前工作区内。");
  }
}

async function resolveWorkspaceFile(rootInput: string, relativePath: string): Promise<{ root: string; file: string }> {
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.includes("\0") ||
      relativePath.includes("\\") || path.isAbsolute(relativePath)) {
    throw new Error("请提供工作区内的相对文件路径。");
  }
  const root = await workspaceRoot(rootInput);
  const file = path.resolve(root, relativePath);
  assertInside(root, file);

  let current = root;
  for (const segment of path.relative(root, file).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("工作区文件操作不跟随符号链接。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { root, file };
}

/**
 * Open with O_NOFOLLOW and verify the descriptor against the canonical path
 * and lstat identity before performing any read/write through that descriptor.
 */
async function verifyOpenedWorkspaceFile(
  root: string,
  file: string,
  handle: Awaited<ReturnType<typeof open>>,
) {
  const [actualFile, pathInfo, openedInfo] = await Promise.all([realpath(file), lstat(file), handle.stat()]);
  assertInside(root, actualFile);
  const samePath = process.platform === "win32"
    ? actualFile.toLowerCase() === file.toLowerCase()
    : actualFile === file;
  const sameIdentity = !pathInfo.ino || !openedInfo.ino
    ? pathInfo.dev === openedInfo.dev
    : pathInfo.dev === openedInfo.dev && pathInfo.ino === openedInfo.ino;
  if (!samePath || pathInfo.isSymbolicLink() || !pathInfo.isFile() || !openedInfo.isFile() || !sameIdentity) {
    throw new Error("工作区文件在访问期间发生变化，请重试。");
  }
  return openedInfo;
}

async function readTextFile(root: string, file: string): Promise<string> {
  const handle = await open(file, fsConstants.O_RDONLY | NO_FOLLOW);
  try {
    const info = await verifyOpenedWorkspaceFile(root, file, handle);
    if (info.size > MAX_TEXT_FILE_BYTES) throw new Error("文件超过 256 KB，暂不支持直接读取。");
    const content = await handle.readFile({ encoding: "utf8" });
    if (content.includes("\0")) throw new Error("不支持读取二进制文件。");
    return content;
  } finally {
    await handle.close();
  }
}

export async function listWorkspaceFiles(rootInput: string): Promise<string> {
  const root = await workspaceRoot(rootInput);
  const files: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5 || files.length >= MAX_LIST_FILES) return;
    const canonicalDirectory = await realpath(directory);
    assertInside(root, canonicalDirectory, true);
    let entries;
    try {
      entries = await readdir(canonicalDirectory, { withFileTypes: true });
    } catch (error) {
      if (canonicalDirectory !== root && isSkippableDirectoryError(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (files.length >= MAX_LIST_FILES) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        const childPath = path.join(canonicalDirectory, entry.name);
        try {
          const canonicalChild = await realpath(childPath);
          assertInside(root, canonicalChild);
          if (canonicalChild !== childPath) continue;
          await walk(canonicalChild, depth + 1);
        } catch (error) {
          if (!isSkippableDirectoryError(error)) throw error;
        }
      } else if (entry.isFile()) {
        files.push(path.relative(root, path.join(canonicalDirectory, entry.name)).split(path.sep).join("/"));
      }
    }
  };
  await walk(root, 0);
  return files.length ? files.join("\n") : "工作区中没有可列出的文件。";
}

export async function readWorkspaceFile(rootInput: string, relativePath: string): Promise<string> {
  const target = await resolveWorkspaceFile(rootInput, relativePath);
  return readTextFile(target.root, target.file);
}

export async function searchWorkspaceFiles(rootInput: string, query: string): Promise<string> {
  const root = await workspaceRoot(rootInput);
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2 || needle.length > 200) throw new Error("搜索关键词长度必须为 2–200 个字符。");
  const listing = await listWorkspaceFiles(root);
  if (listing === "工作区中没有可列出的文件。") return "没有找到匹配内容。";
  const files = listing.split("\n").filter(Boolean);
  const matches: string[] = [];
  for (const relativePath of files) {
    if (matches.length >= MAX_SEARCH_MATCHES) break;
    try {
      const content = await readWorkspaceFile(root, relativePath);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_MATCHES; index += 1) {
        if (lines[index].toLocaleLowerCase().includes(needle)) {
          matches.push(relativePath + ":" + (index + 1) + ": " + lines[index].trim().slice(0, 300));
        }
      }
    } catch {
      // Binary, oversized or concurrently removed files are skipped.
    }
  }
  return matches.length ? matches.join("\n") : "没有找到匹配内容。";
}

export async function writeWorkspaceFile(rootInput: string, relativePath: string, content: string): Promise<string> {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
    throw new Error("写入内容不能超过 256 KB。");
  }
  const target = await resolveWorkspaceFile(rootInput, relativePath);
  const parent = await realpath(path.dirname(target.file));
  assertInside(target.root, parent, true);
  if (!(await stat(parent)).isDirectory()) throw new Error("目标目录不存在。");

  const handle = await open(target.file, fsConstants.O_WRONLY | fsConstants.O_CREAT | NO_FOLLOW, 0o600);
  try {
    await verifyOpenedWorkspaceFile(target.root, target.file, handle);
    await handle.truncate(0);
    await handle.writeFile(content, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  return "已写入 " + path.relative(target.root, target.file).split(path.sep).join("/");
}
