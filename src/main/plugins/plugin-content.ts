import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

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
export function pluginContentFingerprint(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
      const fullPath = path.join(directory, entry);
      const stat = lstatSync(fullPath);
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      if (stat.isSymbolicLink()) throw new Error("插件运行时目录不能包含符号链接：" + relative);
      hash.update(relative).update("\0");
      if (stat.isDirectory()) {
        hash.update("directory\0");
        visit(fullPath);
      } else if (stat.isFile()) {
        hash.update("file\0");
        hash.update(readFileSync(fullPath));
        hash.update("\0");
      } else {
        throw new Error("插件运行时目录包含不支持的文件类型：" + relative);
      }
    }
  };
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("插件运行时源目录必须是普通目录。");
  visit(root);
  return hash.digest("hex");
}

/** Stage a verified, immutable-per-session snapshot; never pass the mutable install path to a provider. */
export function stagePluginRuntimeDirectories(
  entries: readonly PluginRuntimeEntry[],
  runtimeRoot: string,
): StagedPluginRuntimeEntry[] {
  mkdirSync(runtimeRoot, { recursive: true });
  const staged: StagedPluginRuntimeEntry[] = [];
  try {
    for (const entry of entries.slice(0, 50)) {
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id)) throw new Error("无效的插件 ID：" + entry.id);
      if (!path.isAbsolute(entry.directory)) throw new Error("插件目录必须是绝对路径。");
      const destination = path.join(runtimeRoot, entry.id);
      cpSync(entry.directory, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      if (pluginContentFingerprint(destination) !== entry.fingerprint) {
        throw new Error("插件 " + entry.id + " 在运行授权后发生变化，已阻止启动。请重新检查并授权。");
      }
      staged.push({ id: entry.id, directory: destination });
    }
    return staged;
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}
