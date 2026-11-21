import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportPlugin, importPlugin, listPlugins, readEnabledPluginInstructions, removePlugin, setPluginEnabled, validatePluginDirectory } from "../src/main/plugins/plugin-registry";

const temporaryRoots: string[] = [];
function makeDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "architect-plugin-test-"));
  temporaryRoots.push(directory);
  return directory;
}

function makeClaudePlugin(root: string, name = "research-toolkit"): string {
  const directory = path.join(root, name);
  mkdirSync(path.join(directory, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(directory, "skills", "research"), { recursive: true });
  writeFileSync(path.join(directory, ".claude-plugin", "plugin.json"), JSON.stringify({
    name,
    version: "1.0.0",
    description: "Research tools for Claude Code",
  }));
  writeFileSync(path.join(directory, "skills", "research", "SKILL.md"), "---\nname: research\ndescription: Research carefully\n---\nUse primary sources.");
  return directory;
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Claude Code Plugin packages", () => {
  it("validates the standard Claude Code plugin directory and resources", () => {
    const source = makeClaudePlugin(makeDirectory());
    const manifest = validatePluginDirectory(source);
    expect(manifest.id).toBe("research-toolkit");
    expect(manifest.skills).toContain("skills/research/SKILL.md");
  });

  it("rejects traversal paths and directories without supported Claude components", () => {
    const source = makeClaudePlugin(makeDirectory());
    const pluginJson = path.join(source, ".claude-plugin", "plugin.json");
    writeFileSync(pluginJson, JSON.stringify({
      name: "research-toolkit",
      skills: ["../outside"],
    }));
    expect(() => validatePluginDirectory(source)).toThrow();

    const unprefixed = makeClaudePlugin(makeDirectory());
    writeFileSync(path.join(unprefixed, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "research-toolkit",
      skills: ["skills"],
    }));
    expect(() => validatePluginDirectory(unprefixed)).toThrow("必须以 ./ 开头");

    const missingName = makeClaudePlugin(makeDirectory());
    writeFileSync(path.join(missingName, ".claude-plugin", "plugin.json"), JSON.stringify({
      skills: ["./skills"],
    }));
    expect(() => validatePluginDirectory(missingName)).toThrow("必须包含 name 字段");

    const unsupported = path.join(makeDirectory(), "unsupported-plugin");
    mkdirSync(path.join(unsupported, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(unsupported, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "unsupported-plugin" }));
    expect(() => validatePluginDirectory(unsupported)).toThrow("不包含可加载的 Claude Code");
  });

  it("rejects the retired application-specific manifest.json format", () => {
    const root = makeDirectory();
    const source = path.join(root, "legacy-research");
    mkdirSync(path.join(source, "skills"), { recursive: true });
    mkdirSync(path.join(source, "workflows"), { recursive: true });
    writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
      manifestVersion: 1,
      id: "legacy.research",
      name: "Legacy Research",
      version: "1.0.0",
      skills: ["skills/research.md"],
      tools: ["browser_get_current_page"],
      workflows: ["workflows/brief.md"],
      views: [],
    }));
    writeFileSync(path.join(source, "skills", "research.md"), "Legacy project-specific skill.");
    writeFileSync(path.join(source, "workflows", "brief.md"), "Legacy workflow.");

    expect(() => validatePluginDirectory(source)).toThrow("项目自有 manifest.json 插件格式不受支持");
  });

  it("imports, enables, disables, lists, exports and removes a Claude plugin", () => {
    const root = makeDirectory();
    const source = makeClaudePlugin(root);
    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");

    expect(importPlugin(source, pluginRoot, registry).enabled).toBe(true);
    expect(listPlugins(pluginRoot, registry)).toHaveLength(1);
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toContain("Use primary sources.");
    expect(readEnabledPluginInstructions(pluginRoot, registry, [])).not.toContain("Use primary sources.");
    expect(readEnabledPluginInstructions(pluginRoot, registry, ["research-toolkit:skills/research/SKILL.md"]))
      .toContain("Use primary sources.");

    const exported = exportPlugin("research-toolkit", pluginRoot, path.join(root, "export"), registry);
    expect(exported).toContain("research-toolkit");
    expect(setPluginEnabled("research-toolkit", false, pluginRoot, registry)[0].enabled).toBe(false);
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toBe("");
    expect(removePlugin("research-toolkit", pluginRoot, registry)).toHaveLength(0);
  });

  it("loads Claude Code Skills, Commands and Agents but does not execute hooks or MCP services", () => {
    const root = makeDirectory();
    const source = makeClaudePlugin(root);
    mkdirSync(path.join(source, "commands"), { recursive: true });
    mkdirSync(path.join(source, "agents"), { recursive: true });
    mkdirSync(path.join(source, "hooks"), { recursive: true });
    writeFileSync(path.join(source, "commands", "summarize.md"), "---\ndescription: Summarize findings\n---\nWrite a concise evidence-based summary.");
    writeFileSync(path.join(source, "agents", "reviewer.md"), "---\ndescription: Review research\n---\nCheck citations and unsupported claims.");
    writeFileSync(path.join(source, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(path.join(source, ".mcp.json"), JSON.stringify({ mcpServers: {} }));

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.commands).toContain("commands/summarize.md");
    expect(imported.agents).toContain("agents/reviewer.md");

    const instructions = readEnabledPluginInstructions(pluginRoot, registry);
    expect(instructions).toContain("Use primary sources.");
    expect(instructions).toContain("Write a concise evidence-based summary.");
    expect(instructions).toContain("Check citations and unsupported claims.");
    expect(instructions).not.toContain("hooks.json");
    expect(instructions).not.toContain("mcpServers");
  });

  it("supports declared Claude Code custom component paths and inline commands", () => {
    const root = makeDirectory();
    const source = makeClaudePlugin(root, "team-tools");
    mkdirSync(path.join(source, "extra-skills", "portfolio"), { recursive: true });
    mkdirSync(path.join(source, "extra-commands"), { recursive: true });
    writeFileSync(path.join(source, "extra-skills", "portfolio", "SKILL.md"), "Use portfolio-specific review steps.");
    writeFileSync(path.join(source, "extra-commands", "summarize.md"), "Summarize the current analysis.");
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "team-tools",
      skills: ["./extra-skills/"],
      commands: {
        summarize: { source: "./extra-commands/summarize.md" },
        "quick-note": { content: "Write a dated research note." },
      },
    }));

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.skills).toEqual(["extra-skills/portfolio/SKILL.md"]);
    expect(imported.commands).toEqual(["extra-commands/summarize.md"]);
    expect(imported.inlineCommands).toEqual([{ name: "quick-note", content: "Write a dated research note." }]);
    const instructions = readEnabledPluginInstructions(pluginRoot, registry);
    expect(instructions).toContain("Write a dated research note.");
    expect(instructions).toContain("Use portfolio-specific review steps.");
  });

  it("loads a manifest-less single-skill plugin with SKILL.md at the plugin root", () => {
    const root = makeDirectory();
    const source = path.join(root, "root-skill-plugin");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "SKILL.md"), "Use the root-level skill instructions.");

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    importPlugin(source, pluginRoot, registry);
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toContain("Use the root-level skill instructions.");
  });

  it("accepts a standard Claude Code plugin without the optional plugin.json manifest", () => {
    const root = makeDirectory();
    const source = path.join(root, "portable-tools");
    mkdirSync(path.join(source, "skills", "notes"), { recursive: true });
    writeFileSync(path.join(source, "skills", "notes", "SKILL.md"), "Write useful notes.");

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.id).toBe("portable-tools");
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toContain("Write useful notes.");
  });
});
