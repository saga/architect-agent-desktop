import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stagePluginRuntimeDirectories, type PluginRuntimeEntry } from "./plugin-content";

async function pathExists(filePath: string): Promise<boolean> {
  try { await lstat(filePath); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Claude Plugin manifest 必须是 JSON 对象：" + filePath);
  }
  return value as Record<string, unknown>;
}

async function resolvePluginConfigFile(root: string, value: string, label: string): Promise<string> {
  if (!value || value.startsWith("/") || /^[a-zA-Z]:/.test(value)
    || value.includes("\\") || value.includes("\0")) {
    throw new Error("Copilot 插件投影中的 " + label + " 必须是包内相对路径。");
  }
  const relative = (value.startsWith("./") ? value.slice(2) : value).replace(/\/+$/, "");
  const segments = relative.split("/");
  if (!relative || segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("Copilot 插件投影中的 " + label + " 路径越界。");
  }
  const target = path.resolve(root, ...segments);
  const within = path.relative(root, target);
  if (!within || within.startsWith("..") || path.isAbsolute(within)) {
    throw new Error("Copilot 插件投影中的 " + label + " 路径越界。");
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Copilot 插件投影中的 " + label + " 必须是普通文件。");
  return target;
}

async function resolvePluginPath(root: string, value: string, label: string): Promise<string> {
  if (!value || value.startsWith("/") || /^[a-zA-Z]:/.test(value)
    || value.includes("\\") || value.includes("\0")) {
    throw new Error("Copilot 插件投影中的 " + label + " 必须是包内相对路径。");
  }
  const relative = (value.startsWith("./") ? value.slice(2) : value).replace(/\/+$/, "");
  const segments = relative.split("/");
  if (!relative || segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("Copilot 插件投影中的 " + label + " 路径越界。");
  }
  const target = path.resolve(root, ...segments);
  const within = path.relative(root, target);
  if (!within || within.startsWith("..") || path.isAbsolute(within)) {
    throw new Error("Copilot 插件投影中的 " + label + " 路径越界。");
  }
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new Error("Copilot 插件投影中的 " + label + " 必须是普通文件或目录。");
  }
  return target;
}

function mergeObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = result[key];
    if (existing && typeof existing === "object" && !Array.isArray(existing)
      && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeObjects(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      result[key] = [...existing, ...value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function normalizeServerConfig(value: unknown, root: string, label: string, wrapper?: string): Promise<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const merged: Record<string, unknown> = {};
    for (const item of value) {
      Object.assign(merged, mergeObjects(merged, await normalizeServerConfig(item, root, label, wrapper)));
    }
    return merged;
  }
  let parsed: Record<string, unknown>;
  if (typeof value === "string") {
    parsed = await readJsonObject(await resolvePluginConfigFile(root, value, label));
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    parsed = value as Record<string, unknown>;
  } else {
    throw new Error("Claude Plugin " + label + " 配置必须是 JSON 文件路径或内联对象。");
  }
  if (wrapper && !Object.prototype.hasOwnProperty.call(parsed, wrapper)) return { [wrapper]: parsed };
  return parsed;
}

function normalizeLspConfig(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.lspServers;
  const nestedServers = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
  const directServers = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "lspServers"));
  return { lspServers: mergeObjects(directServers, nestedServers) };
}

async function normalizeHooksConfig(value: unknown, root: string): Promise<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const merged: Record<string, unknown> = {};
    for (const item of value) Object.assign(merged, mergeObjects(merged, await normalizeHooksConfig(item, root)));
    return merged;
  }
  if (typeof value === "string") {
    const file = await resolvePluginConfigFile(root, value, "hooks");
    if (path.extname(file).toLowerCase() !== ".json") throw new Error("Claude Plugin Hooks 配置必须是 JSON 文件。");
    return readJsonObject(file);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("Claude Plugin hooks 必须是 JSON 文件路径、路径数组或内联对象。");
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error("Copilot 插件投影不能包含符号链接：" + fullPath);
      if (stat.isDirectory()) await visit(fullPath);
      else if (stat.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(fullPath);
    }
  };
  await visit(directory);
  return result.sort((a, b) => a.localeCompare(b));
}

function pluginRelativePath(root: string, target: string): string {
  return "./" + path.relative(root, target).split(path.sep).join("/");
}

function safeComponentName(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;
}

async function projectCopilotAgents(manifest: Record<string, unknown>, root: string): Promise<void> {
  const raw = manifest.agents;
  const declared = raw === undefined ? (await pathExists(path.join(root, "agents")) ? ["./agents"] : [])
    : typeof raw === "string" ? [raw]
      : Array.isArray(raw) && raw.every(item => typeof item === "string") ? raw as string[] : null;
  if (!declared) throw new Error("Claude Plugin agents 必须是包内 Markdown 路径或路径数组。");
  const sourceFiles: string[] = [];
  for (const item of declared) {
    const target = await resolvePluginPath(root, item, "agents");
    if ((await lstat(target)).isDirectory()) sourceFiles.push(...await collectMarkdownFiles(target));
    else {
      if (path.extname(target).toLowerCase() !== ".md") throw new Error("Claude Plugin agent 必须是 Markdown 文件：" + item);
      sourceFiles.push(target);
    }
  }
  if (!sourceFiles.length) {
    delete manifest.agents;
    return;
  }
  const directories = new Set<string>();
  for (const sourceFile of sourceFiles) {
    const targetFile = sourceFile.toLowerCase().endsWith(".agent.md")
      ? sourceFile
      : sourceFile.slice(0, -3) + ".agent.md";
    if (targetFile !== sourceFile) {
      if (await pathExists(targetFile)) {
        const existing = await readFile(targetFile, "utf8");
        const incoming = await readFile(sourceFile, "utf8");
        if (existing !== incoming) throw new Error("Copilot Agent 文件名冲突：" + path.relative(root, targetFile));
      } else {
        await writeFile(targetFile, await readFile(sourceFile), { mode: 0o600 });
      }
    }
    directories.add(pluginRelativePath(root, path.dirname(targetFile)));
  }
  manifest.agents = [...directories].sort();
}

async function projectCopilotCommands(manifest: Record<string, unknown>, root: string): Promise<void> {
  const raw = manifest.commands;
  if (raw === undefined) {
    if (await pathExists(path.join(root, "commands"))) manifest.commands = "./commands";
    return;
  }

  const generatedDirectory = path.join(root, ".copilot-adapter-" + randomUUID(), "commands");
  const generatedPaths: string[] = [];
  const sourceDirectories: string[] = [];
  let generatedCount = 0;
  const ensureGeneratedDirectory = async (): Promise<void> => { await mkdir(generatedDirectory, { recursive: true }); };
  const writeGenerated = async (name: string, content: string): Promise<void> => {
    await ensureGeneratedDirectory();
    const filename = safeComponentName(name, "command") + "-" + generatedCount++ + ".md";
    await writeFile(path.join(generatedDirectory, filename), normalizeCopilotRootText(content), { encoding: "utf8", mode: 0o600 });
  };

  if (typeof raw === "string" || (Array.isArray(raw) && raw.every(item => typeof item === "string"))) {
    const paths = typeof raw === "string" ? [raw] : raw as string[];
    for (const item of paths) {
      const target = await resolvePluginPath(root, item, "commands");
      if ((await lstat(target)).isDirectory()) {
        sourceDirectories.push(pluginRelativePath(root, target));
      } else {
        if (path.extname(target).toLowerCase() !== ".md") throw new Error("Claude Plugin command source 必须是 Markdown：" + item);
        await writeGenerated(path.basename(target, path.extname(target)), await readFile(target, "utf8"));
      }
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        throw new Error("Claude Plugin command 配置无效：" + name);
      }
      const command = definition as Record<string, unknown>;
      if (typeof command.source === "string" && typeof command.content !== "string") {
        const sourceFile = await resolvePluginPath(root, command.source, "commands");
        if (!(await lstat(sourceFile)).isFile() || path.extname(sourceFile).toLowerCase() !== ".md") {
          throw new Error("Claude Plugin command source 必须是 Markdown：" + name);
        }
        await writeGenerated(name, await readFile(sourceFile, "utf8"));
      } else if (typeof command.content === "string" && typeof command.source !== "string") {
        await writeGenerated(name, command.content);
      } else {
        throw new Error("Claude Plugin command 必须且只能指定 source 或 content：" + name);
      }
    }
  } else {
    throw new Error("Claude Plugin commands 必须是路径、路径数组或命令定义对象。");
  }

  if (generatedCount > 0) generatedPaths.push(pluginRelativePath(root, generatedDirectory));
  const allPaths = [...new Set([...sourceDirectories, ...generatedPaths])];
  if (allPaths.length === 0) delete manifest.commands;
  else manifest.commands = allPaths.length === 1 ? allPaths[0] : allPaths;
}

async function writeJsonConfig(root: string, fileName: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(root, fileName), JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

function normalizeCopilotRootText(value: string): string {
  return value
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, "$" + "{PLUGIN_ROOT}")
    .replace(/\$CLAUDE_PLUGIN_ROOT\b/g, "$PLUGIN_ROOT")
    .replace(/process\.env\.CLAUDE_PLUGIN_ROOT\b/g, "process.env.PLUGIN_ROOT")
    .replace(/os\.environ\["CLAUDE_PLUGIN_ROOT"\]/g, 'os.environ["PLUGIN_ROOT"]')
    .replace(/os\.environ\['CLAUDE_PLUGIN_ROOT'\]/g, "os.environ['PLUGIN_ROOT']")
    .replace(/os\.environ\.get\("CLAUDE_PLUGIN_ROOT"\)/g, 'os.environ.get("PLUGIN_ROOT")')
    .replace(/os\.environ\.get\('CLAUDE_PLUGIN_ROOT'\)/g, "os.environ.get('PLUGIN_ROOT')")
    .replace(/\$env:CLAUDE_PLUGIN_ROOT\b/gi, "$env:PLUGIN_ROOT")
    .replace(/%CLAUDE_PLUGIN_ROOT%/gi, "%PLUGIN_ROOT%");
}

function normalizeCopilotRootValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeCopilotRootText(value);
  if (Array.isArray(value)) return value.map(normalizeCopilotRootValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, normalizeCopilotRootValue(item)]));
  }
  return value;
}

const TEXT_EXTENSIONS = new Set([
  ".md", ".json", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
  ".sh", ".bash", ".py", ".ps1", ".cmd", ".bat", ".yaml", ".yml", ".toml", ".txt",
]);

async function normalizeCopilotPluginRootVariables(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error("Copilot 插件投影不能包含符号链接：" + fullPath);
      if (stat.isDirectory()) {
        await visit(fullPath);
      } else if (stat.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const before = await readFile(fullPath, "utf8");
        const after = normalizeCopilotRootText(before);
        if (after !== before) await writeFile(fullPath, after, "utf8");
      }
    }
  };
  await visit(root);
}

/**
 * Copilot CLI accepts Claude-style .claude-plugin/plugin.json packages, but
 * its legacy plugin discovery uses a root plugin.json, a root hooks.json
 * convention and lsp.json. The temporary projection maps those defaults and
 * translates Claude's plugin-root variable to Copilot's plugin-root variable.
 *
 * The source plugin remains untouched. A temporary runtime projection is
 * built for the Copilot process and removed when that process stops.
 */
export async function prepareCopilotPluginDirectories(
  approvedEntries: readonly PluginRuntimeEntry[],
  runtimeRoot: string,
): Promise<string[]> {
  const stagedEntries = await stagePluginRuntimeDirectories(approvedEntries, runtimeRoot);
  const staged: string[] = [];
  try {
    for (const entry of stagedEntries) {
      const id = entry.id;
      const destination = entry.directory;
      const claudeManifestPath = path.join(destination, ".claude-plugin", "plugin.json");
      const rootManifestPath = path.join(destination, "plugin.json");
      const manifest = await pathExists(claudeManifestPath)
        ? await readJsonObject(claudeManifestPath)
        : { name: id };
      delete manifest.$schema;
      await normalizeCopilotPluginRootVariables(destination);

      const copilotHooksConfig = path.join(destination, "hooks.json");
      if (manifest.hooks !== undefined) {
        const customHooks = normalizeCopilotRootValue(await normalizeHooksConfig(manifest.hooks, destination)) as Record<string, unknown>;
        const existingHooks = await pathExists(copilotHooksConfig) ? await readJsonObject(copilotHooksConfig) : {};
        await writeJsonConfig(destination, "hooks.json", mergeObjects(existingHooks, customHooks));
        delete manifest.hooks;
      } else {
        const hooksConfig = path.join(destination, "hooks", "hooks.json");
        if (await pathExists(hooksConfig) && !await pathExists(copilotHooksConfig)) {
          await cp(hooksConfig, copilotHooksConfig, { errorOnExist: true, force: false });
        }
      }

      if (manifest.mcpServers !== undefined) {
        const declaredMcp = normalizeCopilotRootValue(await normalizeServerConfig(manifest.mcpServers, destination, "mcpServers", "mcpServers")) as Record<string, unknown>;
        const currentMcpPath = path.join(destination, ".mcp.json");
        const currentMcp = await pathExists(currentMcpPath) ? await readJsonObject(currentMcpPath) : {};
        await writeJsonConfig(destination, ".mcp.json", mergeObjects(currentMcp, declaredMcp));
        delete manifest.mcpServers;
      }

      const lspConfig = path.join(destination, ".lsp.json");
      if (manifest.lspServers !== undefined) {
        const declaredLsp = normalizeCopilotRootValue(await normalizeServerConfig(manifest.lspServers, destination, "lspServers", "lspServers")) as Record<string, unknown>;
        const currentLsp = await pathExists(lspConfig) ? await readJsonObject(lspConfig) : {};
        await writeJsonConfig(destination, ".lsp.json", mergeObjects(currentLsp, declaredLsp));
        delete manifest.lspServers;
      }
      const copilotLspConfig = path.join(destination, "lsp.json");
      const claudeLsp = await pathExists(lspConfig) ? normalizeLspConfig(await readJsonObject(lspConfig)) : {};
      const existingCopilotLsp = await pathExists(copilotLspConfig) ? normalizeLspConfig(await readJsonObject(copilotLspConfig)) : {};
      if (Object.keys(claudeLsp).length || Object.keys(existingCopilotLsp).length) {
        await writeJsonConfig(destination, "lsp.json", mergeObjects(existingCopilotLsp, claudeLsp));
      }

      await projectCopilotCommands(manifest, destination);
      await projectCopilotAgents(manifest, destination);
      const copilotManifest = normalizeCopilotRootValue(manifest) as Record<string, unknown>;
      await writeFile(rootManifestPath, JSON.stringify(copilotManifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      staged.push(destination);
    }
    return staged;
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}
