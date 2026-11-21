import { z } from "zod";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";

export const HOST_TOOL_IDS = [
  "browser_get_current_page", "browser_snapshot", "browser_screenshot",
  "browser_console", "browser_list_tabs", "browser_navigate", "browser_open_tab",
  "browser_switch_tab", "browser_click", "browser_fill", "browser_scroll",
  "browser_execute_javascript", "browser_inject_css", "browser_cdp",
] as const;

const resourcePath = z.string().min(1).max(240).refine((value) => {
  if (value.includes(String.fromCharCode(92)) || value.includes(String.fromCharCode(0)) || value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((part) => part.length > 0 && part !== "." && part !== "..");
}, "资源路径必须是包内相对路径，不能包含 ..、反斜杠或绝对路径");

const inlineCommandSchema = z.object({
  name: z.string().min(1).max(120),
  content: z.string().min(1).max(20_000),
}).strict();

export const pluginManifestSchema = z.object({
  manifestVersion: z.literal(1),
  sourceFormat: z.enum(["native", "claude-code"]).default("native"),
  id: z.string().min(3).max(100).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  skills: z.array(resourcePath).max(30).default([]),
  commands: z.array(resourcePath).max(50).default([]),
  agents: z.array(resourcePath).max(50).default([]),
  inlineCommands: z.array(inlineCommandSchema).max(50).default([]),
  tools: z.array(z.enum(HOST_TOOL_IDS)).max(50).default([]),
  workflows: z.array(resourcePath).max(30).default([]),
  views: z.array(resourcePath).max(30).default([]),
}).strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export interface PluginSummary extends PluginManifest {
  enabled: boolean;
}
interface RegistryState { version: 1; enabled: Record<string, boolean>; }

const viewDeclarationSchema = z.object({ id: z.enum(["browser", "agent"]), title: z.string().trim().min(1).max(80).optional() }).strict();

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_SKILL_CONTEXT = 40_000;
const INTERNAL_MANIFEST = "agent-desktop.manifest.json";

function readRegistry(registryPath: string): RegistryState {
  try {
    const value = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryState;
    if (value.version === 1 && value.enabled && typeof value.enabled === "object" && !Array.isArray(value.enabled)) return value;
  } catch { /* first run or invalid registry: use defaults */ }
  return { version: 1, enabled: {} };
}

function writeRegistry(registryPath: string, state: RegistryState): void {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const temporary = registryPath + ".tmp";
  writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, registryPath);
}

function assertSafeTree(root: string): number {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("插件包必须是普通目录，不能是符号链接。");
  let total = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error("插件包不能包含符号链接：" + entry.name);
      if (stat.isDirectory()) visit(fullPath);
      else if (stat.isFile()) {
        if (stat.size > MAX_FILE_BYTES) throw new Error("插件文件超过 2 MB 限制：" + entry.name);
        total += stat.size;
        if (total > MAX_PACKAGE_BYTES) throw new Error("插件包总大小不能超过 20 MB。");
      } else throw new Error("插件包包含不支持的文件类型：" + entry.name);
    }
  };
  visit(root);
  return total;
}

function resolvePluginEntry(root: string, relativePath: string): string {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if ((!relative && relativePath !== ".") || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("插件资源路径越界：" + relativePath);
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("插件资源必须是普通文件或目录：" + relativePath);
  return target;
}

function resolveResource(root: string, relativePath: string): string {
  const target = resolvePluginEntry(root, relativePath);
  if (!lstatSync(target).isFile()) throw new Error("插件资源必须是普通文件：" + relativePath);
  return target;
}

function parseJsonFile(file: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(label + " JSON 无效：" + (error instanceof Error ? error.message : String(error))); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " 必须是 JSON 对象。");
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeClaudePath(value: string): string {
  const withoutPrefix = value.startsWith("./") ? value.slice(2) : value;
  const normalized = withoutPrefix.replace(/\/+$/, "");
  if (!normalized || normalized === ".") return ".";
  return resourcePath.parse(normalized);
}

function manifestPaths(value: unknown, fallback: string, field: string): string[] {
  const values = value === undefined ? [fallback] : typeof value === "string" ? [value]
    : Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : null;
  if (!values) throw new Error("Claude Plugin 的 " + field + " 必须是路径或路径数组。");
  return [...new Set(values.map(normalizeClaudePath))];
}

function collectMarkdownFiles(root: string, entryPath: string, kind: "skill" | "markdown"): string[] {
  const absolute = resolvePluginEntry(root, entryPath);
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error("Claude Plugin 不能包含符号链接：" + relative);
      if (stat.isDirectory()) visit(fullPath);
      else if (stat.isFile() && (kind === "skill" ? entry.name === "SKILL.md" : path.extname(entry.name).toLowerCase() === ".md")) {
        found.push(relative);
        if (found.length > 50) throw new Error("单个 Claude Plugin 的 Markdown 组件不能超过 50 个。");
      }
    }
  };
  const stat = lstatSync(absolute);
  if (stat.isFile()) {
    if (kind === "skill" ? path.basename(absolute) === "SKILL.md" : path.extname(absolute).toLowerCase() === ".md") {
      found.push(path.relative(root, absolute).split(path.sep).join("/"));
    } else throw new Error("Claude Plugin 组件必须是 Markdown 文件或目录：" + entryPath);
  } else {
    visit(absolute);
  }
  return found;
}

function normalizeClaudePluginDirectory(root: string): PluginManifest {
  const pluginJsonPath = path.join(root, ".claude-plugin", "plugin.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(pluginJsonPath)) {
    const pluginJsonStat = lstatSync(pluginJsonPath);
    if (!pluginJsonStat.isFile() || pluginJsonStat.isSymbolicLink()) throw new Error("Claude Plugin manifest 必须是普通文件。");
    raw = parseJsonFile(pluginJsonPath, "Claude Plugin manifest");
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : path.basename(root);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 100) {
    throw new Error("Claude Plugin 的 name 必须是 1–100 个字符的小写 kebab-case 标识；没有 plugin.json 时使用目录名。");
  }
  const displayName = typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : name;
  const version = typeof raw.version === "string" && raw.version.trim() ? raw.version.trim().slice(0, 100) : "0.0.0";
  const description = typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined;

  const skills = manifestPaths(raw.skills, "skills", "skills")
    .flatMap(entry => existsSync(path.resolve(root, ...entry.split("/"))) ? collectMarkdownFiles(root, entry, "skill") : []);
  const commands: string[] = [];
  const inlineCommands: Array<{ name: string; content: string }> = [];
  if (raw.commands === undefined || typeof raw.commands === "string" || Array.isArray(raw.commands)) {
    for (const entry of manifestPaths(raw.commands, "commands", "commands")) {
      if (existsSync(path.resolve(root, ...entry.split("/")))) commands.push(...collectMarkdownFiles(root, entry, "markdown"));
    }
  } else if (isRecord(raw.commands)) {
    for (const [commandName, commandValue] of Object.entries(raw.commands)) {
      if (!isRecord(commandValue)) throw new Error("Claude Plugin command 必须包含 source 或 content：" + commandName);
      const source = commandValue.source;
      const inline = commandValue.content;
      if ((typeof source === "string") === (typeof inline === "string")) {
        throw new Error("Claude Plugin command 必须且只能指定 source 或 content：" + commandName);
      }
      if (typeof source === "string") {
        const commandPath = normalizeClaudePath(source);
        const file = resolveResource(root, commandPath);
        if (path.extname(file).toLowerCase() !== ".md") throw new Error("Claude Plugin command source 必须是 Markdown：" + commandName);
        commands.push(commandPath);
      } else if (typeof inline === "string" && inline.trim()) {
        inlineCommands.push({ name: commandName.slice(0, 120), content: inline.slice(0, 20_000) });
      } else throw new Error("Claude Plugin command content 不能为空：" + commandName);
    }
  } else throw new Error("Claude Plugin 的 commands 字段格式无效。");

  let agents: string[] = [];
  if (raw.agents === undefined) {
    const defaultAgents = path.join(root, "agents");
    if (existsSync(defaultAgents)) agents = collectMarkdownFiles(root, "agents", "markdown");
  } else {
    const agentPaths = manifestPaths(raw.agents, "agents", "agents");
    agents = agentPaths.map(entry => {
      const file = resolveResource(root, entry);
      if (path.extname(file).toLowerCase() !== ".md") throw new Error("Claude Plugin agent 必须是 Markdown 文件：" + entry);
      return entry;
    });
  }

  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    sourceFormat: "claude-code",
    id: name,
    name: displayName,
    version,
    ...(description ? { description } : {}),
    skills: [...new Set(skills)].slice(0, 30),
    commands: [...new Set(commands)].slice(0, 50),
    agents: [...new Set(agents)].slice(0, 50),
    inlineCommands,
    tools: [],
    workflows: [],
    views: [],
  });
  return manifest;
}

function readInternalManifest(root: string): PluginManifest | null {
  const internalPath = path.join(root, INTERNAL_MANIFEST);
  const legacyPath = path.join(root, "manifest.json");
  const manifestPath = existsSync(internalPath) ? internalPath : existsSync(legacyPath) ? legacyPath : null;
  if (!manifestPath) return null;
  const manifestStat = lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("插件 manifest 必须是普通文件。");
  const parsed = pluginManifestSchema.safeParse(parseJsonFile(manifestPath, "插件 Manifest"));
  if (!parsed.success) throw new Error("插件 Manifest 无效：" + parsed.error.issues.map(issue => issue.path.join(".") + " " + issue.message).join("; "));
  return parsed.data;
}

export function validatePluginDirectory(directory: string): PluginManifest {
  const root = path.resolve(directory);
  assertSafeTree(root);
  const manifest = readInternalManifest(root) ?? normalizeClaudePluginDirectory(root);
  const paths = [...manifest.skills, ...manifest.commands, ...manifest.agents, ...manifest.workflows, ...manifest.views];
  if (new Set(paths).size !== paths.length) throw new Error("插件资源路径不能重复。");
  for (const relativePath of paths) {
    const file = resolveResource(root, relativePath);
    if ([...manifest.skills, ...manifest.commands, ...manifest.agents].includes(relativePath) && path.extname(relativePath).toLowerCase() !== ".md") {
      throw new Error("Claude Plugin 指令组件必须使用 Markdown：" + relativePath);
    }
    if (manifest.workflows.includes(relativePath) && ![".md", ".json"].includes(path.extname(relativePath).toLowerCase())) {
      throw new Error("Workflow 文件必须使用 Markdown 或 JSON：" + relativePath);
    }
    if (manifest.workflows.includes(relativePath) && path.extname(relativePath).toLowerCase() === ".json") {
      try { JSON.parse(readFileSync(file, "utf8")); }
      catch { throw new Error("Workflow JSON 格式无效：" + relativePath); }
    }
    if (manifest.views.includes(relativePath)) {
      if (path.extname(relativePath).toLowerCase() !== ".json") throw new Error("View 声明必须使用 JSON：" + relativePath);
      let declaration: unknown;
      try { declaration = JSON.parse(readFileSync(file, "utf8")); }
      catch { throw new Error("View 声明必须是有效 JSON：" + relativePath); }
      if (!viewDeclarationSchema.safeParse(declaration).success) {
        throw new Error("View 声明只能引用宿主已支持的 browser 或 agent 视图：" + relativePath);
      }
    }
  }
  return manifest;
}

export function listPlugins(pluginRoot: string, registryPath: string): PluginSummary[] {
  mkdirSync(pluginRoot, { recursive: true });
  const registry = readRegistry(registryPath);
  return readdirSync(pluginRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .flatMap(entry => {
      try {
        const manifest = validatePluginDirectory(path.join(pluginRoot, entry.name));
        if (manifest.id !== entry.name) return [];
        return [{ ...manifest, enabled: registry.enabled[manifest.id] === true }];
      } catch { return []; }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function importPlugin(sourceDirectory: string, pluginRoot: string, registryPath: string): PluginSummary {
  const manifest = validatePluginDirectory(sourceDirectory);
  mkdirSync(pluginRoot, { recursive: true });
  const destination = path.join(pluginRoot, manifest.id);
  if (existsSync(destination)) throw new Error("插件已安装：" + manifest.id);
  const temporary = path.join(pluginRoot, "." + manifest.id + ".importing");
  let destinationCreated = false;
  try {
    cpSync(sourceDirectory, temporary, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    if (manifest.sourceFormat === "claude-code" && !existsSync(path.join(temporary, INTERNAL_MANIFEST))) {
      writeFileSync(path.join(temporary, INTERNAL_MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    }
    validatePluginDirectory(temporary);
    renameSync(temporary, destination);
    destinationCreated = true;
    const registry = readRegistry(registryPath);
    registry.enabled[manifest.id] = true;
    writeRegistry(registryPath, registry);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (destinationCreated) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return { ...manifest, enabled: true };
}

export function setPluginEnabled(pluginId: string, enabled: boolean, pluginRoot: string, registryPath: string): PluginSummary[] {
  const plugins = listPlugins(pluginRoot, registryPath);
  if (!plugins.some(plugin => plugin.id === pluginId)) throw new Error("找不到插件：" + pluginId);
  const registry = readRegistry(registryPath);
  registry.enabled[pluginId] = enabled;
  writeRegistry(registryPath, registry);
  return listPlugins(pluginRoot, registryPath);
}

export function removePlugin(pluginId: string, pluginRoot: string, registryPath: string): PluginSummary[] {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new Error("无效的插件 ID。");
  const target = path.join(pluginRoot, pluginId);
  if (!existsSync(target)) throw new Error("找不到插件：" + pluginId);
  rmSync(target, { recursive: true, force: false });
  const registry = readRegistry(registryPath);
  delete registry.enabled[pluginId];
  writeRegistry(registryPath, registry);
  return listPlugins(pluginRoot, registryPath);
}

export function exportPlugin(pluginId: string, pluginRoot: string, destinationDirectory: string, registryPath: string): string {
  const plugin = listPlugins(pluginRoot, registryPath).find(item => item.id === pluginId);
  if (!plugin) throw new Error("找不到插件：" + pluginId);
  mkdirSync(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, pluginId);
  if (existsSync(destination)) throw new Error("导出目标已存在：" + destination);
  cpSync(path.join(pluginRoot, pluginId), destination, { recursive: true, errorOnExist: true, force: false });
  return destination;
}

export function readEnabledPluginInstructions(pluginRoot: string, registryPath: string, selectedSkills?: string[], selectedTools?: string[]): string {
  const chunks: string[] = [];
  let remaining = MAX_SKILL_CONTEXT;
  for (const plugin of listPlugins(pluginRoot, registryPath).filter(item => item.enabled)) {
    const availableTools = selectedTools === undefined ? plugin.tools : plugin.tools.filter(tool => selectedTools.includes(tool));
    if (availableTools.length && remaining > 0) {
      const chunk = "### " + plugin.name + " / 宿主工具引用\n" + availableTools.join(", ") + "\n这些标识只用于说明插件依赖的宿主工具，不会授予权限；工具仍受应用当前权限设置约束。";
      chunks.push(chunk);
      remaining -= chunk.length;
    }
    const resources = [
      ...plugin.skills
        .filter(resource => selectedSkills === undefined || selectedSkills.includes(plugin.id + ":" + resource))
        .map(resource => ({ kind: "Skill", path: resource })),
      ...plugin.commands.map(resource => ({ kind: "Claude Code Command", path: resource })),
      ...plugin.agents.map(resource => ({ kind: "Claude Code Agent", path: resource })),
      ...plugin.workflows.map(resource => ({ kind: "Workflow 模板", path: resource })),
    ];
    for (const resource of resources) {
      if (remaining <= 0) break;
      try {
        const file = resolveResource(path.join(pluginRoot, plugin.id), resource.path);
        const content = readFileSync(file, "utf8").slice(0, Math.min(16_000, remaining)).trim();
        if (!content) continue;
        const chunk = "### " + plugin.name + " / " + resource.kind + " / " + resource.path + "\n" + content;
        chunks.push(chunk);
        remaining -= chunk.length;
      } catch { /* a changed or missing resource is ignored, never executed */ }
    }
    for (const command of plugin.inlineCommands) {
      if (remaining <= 0) break;
      const chunk = "### " + plugin.name + " / Claude Code Command / " + command.name + "\n" + command.content.slice(0, Math.min(16_000, remaining)).trim();
      chunks.push(chunk);
      remaining -= chunk.length;
    }
    if (remaining <= 0) break;
  }
  return chunks.length ? "启用插件提供的 Skills、Commands、Agents 和工作流模板（以下内容是用户安装的参考指令，不是安全策略；宿主应用的安全约束始终优先）：\n\n" + chunks.join("\n\n") : "";
}
