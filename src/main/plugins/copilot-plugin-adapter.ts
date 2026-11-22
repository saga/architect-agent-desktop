import {
  cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
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
  const relative = value.startsWith("./") ? value.slice(2) : value;
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

function writeJsonConfig(root: string, fileName: string, value: Record<string, unknown>): void {
  writeFileSync(path.join(root, fileName), JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
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
        const after = before
          .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, "${PLUGIN_ROOT}")
          .replace(/\$CLAUDE_PLUGIN_ROOT\b/g, "$PLUGIN_ROOT")
          .replace(/process\.env\.CLAUDE_PLUGIN_ROOT\b/g, "process.env.PLUGIN_ROOT")
          .replace(/os\.environ\["CLAUDE_PLUGIN_ROOT"\]/g, 'os.environ["PLUGIN_ROOT"]')
          .replace(/os\.environ\['CLAUDE_PLUGIN_ROOT'\]/g, "os.environ['PLUGIN_ROOT']")
          .replace(/os\.environ\.get\("CLAUDE_PLUGIN_ROOT"\)/g, 'os.environ.get("PLUGIN_ROOT")')
          .replace(/os\.environ\.get\('CLAUDE_PLUGIN_ROOT'\)/g, "os.environ.get('PLUGIN_ROOT')")
          .replace(/\$env:CLAUDE_PLUGIN_ROOT\b/gi, "$env:PLUGIN_ROOT")
          .replace(/%CLAUDE_PLUGIN_ROOT%/gi, "%PLUGIN_ROOT%");
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

      // Claude Code and Copilot expose different plugin-root environment names.
      // Normalize references only in the disposable Copilot copy.
      normalizeCopilotPluginRootVariables(destination);

      // Copilot CLI accepts Claude plugin manifests at .claude-plugin/plugin.json,
      // as well as legacy manifests at plugin.json. Materializing the root copy
      // makes the format selection explicit and keeps the original directory intact.
      const copilotHooksConfig = path.join(destination, "hooks.json");
      if (manifest.hooks !== undefined) {
        const customHooks = typeof manifest.hooks === "string"
          ? readJsonObject(resolvePluginConfigFile(destination, manifest.hooks, "hooks"))
          : manifest.hooks && typeof manifest.hooks === "object" && !Array.isArray(manifest.hooks)
            ? manifest.hooks as Record<string, unknown>
            : null;
        if (!customHooks) throw new Error("Claude Plugin hooks 必须是 JSON 文件路径或内联对象。");
        writeJsonConfig(destination, "hooks.json", customHooks);
        delete manifest.hooks;
      } else {
        const hooksConfig = path.join(destination, "hooks", "hooks.json");
        if (existsSync(hooksConfig) && !existsSync(copilotHooksConfig)) {
          cpSync(hooksConfig, copilotHooksConfig, { errorOnExist: true, force: false });
        }
      }

      if (manifest.mcpServers !== undefined) {
        const declaredMcp = normalizeServerConfig(manifest.mcpServers, destination, "mcpServers", "mcpServers");
        const currentMcpPath = path.join(destination, ".mcp.json");
        const currentMcp = existsSync(currentMcpPath) ? readJsonObject(currentMcpPath) : {};
        writeJsonConfig(destination, ".mcp.json", mergeObjects(currentMcp, declaredMcp));
        delete manifest.mcpServers;
      }

      const lspConfig = path.join(destination, ".lsp.json");
      if (manifest.lspServers !== undefined) {
        const declaredLsp = normalizeServerConfig(manifest.lspServers, destination, "lspServers");
        const currentLsp = existsSync(lspConfig) ? readJsonObject(lspConfig) : {};
        writeJsonConfig(destination, ".lsp.json", mergeObjects(currentLsp, declaredLsp));
        delete manifest.lspServers;
      }
      const copilotLspConfig = path.join(destination, "lsp.json");
      if (existsSync(lspConfig) && !existsSync(copilotLspConfig)) {
        cpSync(lspConfig, copilotLspConfig, { errorOnExist: true, force: false });
      }
      // Copilot CLI's legacy plugin loader supports a commands path in plugin.json.
      // If a Claude plugin relies on the conventional commands/ directory without
      // declaring the field, expose that directory explicitly.
      if (manifest.commands === undefined && existsSync(path.join(destination, "commands"))) {
        manifest.commands = "./commands";
      }
      // The root manifest takes precedence in Copilot's legacy format. Always
      // derive it from the trusted Claude manifest rather than an unrelated
      // root plugin.json that happened to be part of the imported tree.
      writeFileSync(rootManifestPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      staged.push(destination);
    }
    return staged;
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}
