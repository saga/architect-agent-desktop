import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stagePluginRuntimeDirectories, type PluginRuntimeEntry } from "./plugin-content";

function readJsonObject(filePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Claude Plugin manifest 必须是 JSON 对象：" + filePath);
  }
  return value as Record<string, unknown>;
}

function resolvePluginConfigFile(root: string, value: string, label: string): string {
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
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Copilot 插件投影中的 " + label + " 必须是普通文件。");
  return target;
}

function resolvePluginPath(root: string, value: string, label: string): string {
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
  const stat = lstatSync(target);
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

function normalizeServerConfig(value: unknown, root: string, label: string, wrapper?: string): Record<string, unknown> {
  if (Array.isArray(value)) {
    return value.reduce(
      (merged, item) => mergeObjects(merged, normalizeServerConfig(item, root, label, wrapper)),
      {} as Record<string, unknown>,
    );
  }
  let parsed: Record<string, unknown>;
  if (typeof value === "string") {
    parsed = readJsonObject(resolvePluginConfigFile(root, value, label));
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

function normalizeHooksConfig(value: unknown, root: string): Record<string, unknown> {
  if (Array.isArray(value)) {
    return value.reduce((merged, item) => mergeObjects(merged, normalizeHooksConfig(item, root)), {} as Record<string, unknown>);
  }
  if (typeof value === "string") {
    const file = resolvePluginConfigFile(root, value, "hooks");
    if (path.extname(file).toLowerCase() !== ".json") throw new Error("Claude Plugin Hooks 配置必须是 JSON 文件。");
    return readJsonObject(file);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("Claude Plugin hooks 必须是 JSON 文件路径、路径数组或内联对象。");
}

function collectMarkdownFiles(directory: string): string[] {
  const result: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Copilot 插件投影不能包含符号链接：" + fullPath);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(fullPath);
    }
  };
  visit(directory);
  return result.sort((a, b) => a.localeCompare(b));
}

function pluginRelativePath(root: string, target: string): string {
  return "./" + path.relative(root, target).split(path.sep).join("/");
}

function safeComponentName(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;
}

function projectCopilotAgents(manifest: Record<string, unknown>, root: string): void {
  const raw = manifest.agents;
  const declared = raw === undefined ? (existsSync(path.join(root, "agents")) ? ["./agents"] : [])
    : typeof raw === "string" ? [raw]
      : Array.isArray(raw) && raw.every(item => typeof item === "string") ? raw as string[] : null;
  if (!declared) throw new Error("Claude Plugin agents 必须是包内 Markdown 路径或路径数组。");
  const sourceFiles: string[] = [];
  for (const item of declared) {
    const target = resolvePluginPath(root, item, "agents");
    if (lstatSync(target).isDirectory()) sourceFiles.push(...collectMarkdownFiles(target));
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
      if (existsSync(targetFile)) {
        const existing = readFileSync(targetFile, "utf8");
        const incoming = readFileSync(sourceFile, "utf8");
        if (existing !== incoming) throw new Error("Copilot Agent 文件名冲突：" + path.relative(root, targetFile));
      } else {
        writeFileSync(targetFile, readFileSync(sourceFile), { mode: 0o600 });
      }
    }
    directories.add(pluginRelativePath(root, path.dirname(targetFile)));
  }
  manifest.agents = [...directories].sort();
}

function projectCopilotCommands(manifest: Record<string, unknown>, root: string): void {
  const raw = manifest.commands;
  if (raw === undefined) {
    if (existsSync(path.join(root, "commands"))) manifest.commands = "./commands";
    return;
  }

  const generatedDirectory = path.join(root, ".copilot-adapter-" + randomUUID(), "commands");
  const generatedPaths: string[] = [];
  const sourceDirectories: string[] = [];
  let generatedCount = 0;
  const ensureGeneratedDirectory = (): void => mkdirSync(generatedDirectory, { recursive: true });
  const writeGenerated = (name: string, content: string): void => {
    ensureGeneratedDirectory();
    const filename = safeComponentName(name, "command") + "-" + generatedCount++ + ".md";
    writeFileSync(path.join(generatedDirectory, filename), normalizeCopilotRootText(content), { encoding: "utf8", mode: 0o600 });
  };

  if (typeof raw === "string" || (Array.isArray(raw) && raw.every(item => typeof item === "string"))) {
    const paths = typeof raw === "string" ? [raw] : raw as string[];
    for (const item of paths) {
      const target = resolvePluginPath(root, item, "commands");
      if (lstatSync(target).isDirectory()) {
        sourceDirectories.push(pluginRelativePath(root, target));
      } else {
        if (path.extname(target).toLowerCase() !== ".md") throw new Error("Claude Plugin command source 必须是 Markdown：" + item);
        writeGenerated(path.basename(target, path.extname(target)), readFileSync(target, "utf8"));
      }
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        throw new Error("Claude Plugin command 配置无效：" + name);
      }
      const command = definition as Record<string, unknown>;
      if (typeof command.source === "string" && typeof command.content !== "string") {
        const sourceFile = resolvePluginPath(root, command.source, "commands");
        if (!lstatSync(sourceFile).isFile() || path.extname(sourceFile).toLowerCase() !== ".md") {
          throw new Error("Claude Plugin command source 必须是 Markdown：" + name);
        }
        writeGenerated(name, readFileSync(sourceFile, "utf8"));
      } else if (typeof command.content === "string" && typeof command.source !== "string") {
        writeGenerated(name, command.content);
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

function writeJsonConfig(root: string, fileName: string, value: Record<string, unknown>): void {
  writeFileSync(path.join(root, fileName), JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
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

function normalizeCopilotPluginRootVariables(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const before = readFileSync(fullPath, "utf8");
        const after = normalizeCopilotRootText(before);
        if (after !== before) writeFileSync(fullPath, after, "utf8");
      }
    }
  };
  visit(root);
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
export function prepareCopilotPluginDirectories(
  approvedEntries: readonly PluginRuntimeEntry[],
  runtimeRoot: string,
): string[] {
  const stagedEntries = stagePluginRuntimeDirectories(approvedEntries, runtimeRoot);
  const staged: string[] = [];
  try {
    for (const entry of stagedEntries) {
      const id = entry.id;
      const destination = entry.directory;

      const claudeManifestPath = path.join(destination, ".claude-plugin", "plugin.json");
      const rootManifestPath = path.join(destination, "plugin.json");
      const manifest = existsSync(claudeManifestPath)
        ? readJsonObject(claudeManifestPath)
        : { name: id };
      // Never let a Claude manifest opt the Copilot projection into the
      // incompatible Agent Plugins/Open Plugin Spec schema.
      delete manifest.$schema;

      // Claude Code and Copilot expose different plugin-root environment names.
      // Normalize references only in the disposable Copilot copy.
      normalizeCopilotPluginRootVariables(destination);

      // Copilot CLI accepts Claude plugin manifests at .claude-plugin/plugin.json,
      // as well as legacy manifests at plugin.json. Materializing the root copy
      // makes the format selection explicit and keeps the original directory intact.
      const copilotHooksConfig = path.join(destination, "hooks.json");
      if (manifest.hooks !== undefined) {
        const customHooks = normalizeCopilotRootValue(normalizeHooksConfig(manifest.hooks, destination)) as Record<string, unknown>;
        const existingHooks = existsSync(copilotHooksConfig) ? readJsonObject(copilotHooksConfig) : {};
        writeJsonConfig(destination, "hooks.json", mergeObjects(existingHooks, customHooks));
        delete manifest.hooks;
      } else {
        const hooksConfig = path.join(destination, "hooks", "hooks.json");
        if (existsSync(hooksConfig) && !existsSync(copilotHooksConfig)) {
          cpSync(hooksConfig, copilotHooksConfig, { errorOnExist: true, force: false });
        }
      }

      if (manifest.mcpServers !== undefined) {
        const declaredMcp = normalizeCopilotRootValue(normalizeServerConfig(manifest.mcpServers, destination, "mcpServers", "mcpServers")) as Record<string, unknown>;
        const currentMcpPath = path.join(destination, ".mcp.json");
        const currentMcp = existsSync(currentMcpPath) ? readJsonObject(currentMcpPath) : {};
        writeJsonConfig(destination, ".mcp.json", mergeObjects(currentMcp, declaredMcp));
        delete manifest.mcpServers;
      }

      const lspConfig = path.join(destination, ".lsp.json");
      if (manifest.lspServers !== undefined) {
        const declaredLsp = normalizeCopilotRootValue(normalizeServerConfig(manifest.lspServers, destination, "lspServers", "lspServers")) as Record<string, unknown>;
        const currentLsp = existsSync(lspConfig) ? readJsonObject(lspConfig) : {};
        writeJsonConfig(destination, ".lsp.json", mergeObjects(currentLsp, declaredLsp));
        delete manifest.lspServers;
      }
      const copilotLspConfig = path.join(destination, "lsp.json");
      const claudeLsp = existsSync(lspConfig) ? normalizeLspConfig(readJsonObject(lspConfig)) : {};
      const existingCopilotLsp = existsSync(copilotLspConfig) ? normalizeLspConfig(readJsonObject(copilotLspConfig)) : {};
      if (Object.keys(claudeLsp).length || Object.keys(existingCopilotLsp).length) {
        // Keep the Copilot-specific config while also exposing Claude's servers
        // through the one filename the Legacy loader reads.
        writeJsonConfig(destination, "lsp.json", mergeObjects(existingCopilotLsp, claudeLsp));
      }
      // Copilot Legacy Plugin accepts command directories and *.agent.md agent files.
      // Claude inline command objects and *.md agents are materialized only in
      // this disposable copy; original files and paths remain untouched.
      projectCopilotCommands(manifest, destination);
      projectCopilotAgents(manifest, destination);
      // The root manifest takes precedence in Copilot's legacy format. Always
      // derive it from the trusted Claude manifest rather than an unrelated
      // root plugin.json that happened to be part of the imported tree.
      const copilotManifest = normalizeCopilotRootValue(manifest) as Record<string, unknown>;
      writeFileSync(rootManifestPath, JSON.stringify(copilotManifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      staged.push(destination);
    }
    return staged;
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}
