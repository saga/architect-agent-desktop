import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { cp, lstat, mkdir, opendir, open, rm } from "node:fs/promises";
import path from "node:path";

const MAX_PLUGIN_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_PLUGIN_FILES = 4096;
const MAX_PLUGIN_ENTRIES = 8192;
const MAX_PLUGIN_DEPTH = 32;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

export interface PluginRuntimeEntry {
  id: string;
  directory: string;
  skills: readonly string[];
  fingerprint: string;
}

export interface StagedPluginRuntimeEntry {
  id: string;
  directory: string;
}

/** Deterministic SHA-256 over every file, relative path and entry type. */
export async function pluginContentFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  let totalBytes = 0;
  let fileCount = 0;
  let entryCount = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_PLUGIN_DEPTH) throw new Error("插件目录层级超过限制。");
    const handle = await opendir(directory);
    const entries: import("node:fs").Dirent[] = [];
    try {
      while (true) {
        const entry = await handle.read();
        if (!entry) break;
        entryCount += 1;
        if (entryCount > MAX_PLUGIN_ENTRIES) throw new Error("插件目录条目数量超过限制。");
        entries.push(entry);
      }
    } finally {
      await handle.close();
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const stat = await lstat(fullPath);
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      if (stat.isSymbolicLink()) throw new Error("插件运行时目录不能包含符号链接：" + relative);
      hash.update(relative).update("\\0");
      hash.update(String(stat.mode & 0o7777)).update("\\0");
      if (stat.isDirectory()) {
        hash.update("directory\\0");
        await visit(fullPath, depth + 1);
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        if (fileCount > MAX_PLUGIN_FILES) throw new Error("插件文件数量超过限制。");
        if (stat.size > MAX_PLUGIN_FILE_BYTES) throw new Error("插件文件超过 2 MB 限制：" + relative);
        if (totalBytes > MAX_PLUGIN_TOTAL_BYTES) throw new Error("插件总大小超过 20 MB 限制。");

        const file = await open(fullPath, fsConstants.O_RDONLY | NO_FOLLOW);
        try {
          const opened = await file.stat();
          const sameIdentity = !stat.ino || !opened.ino
            ? stat.dev === opened.dev
            : stat.dev === opened.dev && stat.ino === opened.ino;
          if (!opened.isFile() || opened.size > MAX_PLUGIN_FILE_BYTES || opened.size !== stat.size || !sameIdentity) {
            throw new Error("插件文件在指纹计算期间发生变化：" + relative);
          }

          hash.update("file\\0");
          const contents = Buffer.allocUnsafe(opened.size);
          let offset = 0;
          while (offset < contents.length) {
            const { bytesRead } = await file.read(contents, offset, contents.length - offset, offset);
            if (bytesRead === 0) break;
            offset += bytesRead;
          }
          const after = await file.stat();
          const stableIdentity = !opened.ino || !after.ino
            ? opened.dev === after.dev
            : opened.dev === after.dev && opened.ino === after.ino;
          if (offset !== opened.size || after.size !== opened.size || !stableIdentity) {
            throw new Error("插件文件在指纹计算期间发生变化：" + relative);
          }
          hash.update(contents);
          hash.update("\\0");
        } finally {
          await file.close();
        }
      } else {
        throw new Error("插件运行时目录包含不支持的文件类型：" + relative);
      }
    }
  };

  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("插件运行时源目录必须是普通目录。");
  await visit(root, 0);
  return hash.digest("hex");
}

/** Stage a verified, immutable-per-session snapshot; never pass the mutable install path to a provider. */
export async function stagePluginRuntimeDirectories(
  entries: readonly PluginRuntimeEntry[],
  runtimeRoot: string,
): Promise<StagedPluginRuntimeEntry[]> {
  await mkdir(runtimeRoot, { recursive: true });
  const staged: StagedPluginRuntimeEntry[] = [];
  try {
    for (const entry of entries.slice(0, 50)) {
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id)) throw new Error("无效的插件 ID：" + entry.id);
      if (!path.isAbsolute(entry.directory)) throw new Error("插件目录必须是绝对路径。");
      const destination = path.join(runtimeRoot, entry.id);
      await cp(entry.directory, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      if (await pluginContentFingerprint(destination) !== entry.fingerprint) {
        throw new Error("插件 " + entry.id + " 在运行授权后发生变化，已阻止启动。请重新检查并授权。");
      }
      staged.push({ id: entry.id, directory: destination });
    }
    return staged;
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}
