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
function makePlugin(root: string, manifest: Record<string, unknown> = {}): string {
  const directory = path.join(root, "research");
  mkdirSync(path.join(directory, "skills"), { recursive: true });
  writeFileSync(path.join(directory, "skills", "research.md"), "Use the research memo format.");
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    manifestVersion: 1, id: "team.research", name: "Research", version: "1.0.0",
    skills: ["skills/research.md"], tools: ["browser_get_current_page"],
    workflows: [], views: [], ...manifest,
  }));
  return directory;
}
afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("declarative plugin packages", () => {
  it("validates a package and its referenced resource files", () => {
    const root = makeDirectory();
    const source = makePlugin(root);
    expect(validatePluginDirectory(source).id).toBe("team.research");
  });

  it("rejects traversal paths and unknown host tools", () => {
    const root = makeDirectory();
    expect(() => validatePluginDirectory(makePlugin(root, { skills: ["../outside.md"] }))).toThrow();
    const other = makeDirectory();
    expect(() => validatePluginDirectory(makePlugin(other, { tools: ["shell.exec"] }))).toThrow();
  });

  it("imports, enables, disables, lists and removes a plugin", () => {
    const root = makeDirectory();
    const source = makePlugin(root);
    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    expect(importPlugin(source, pluginRoot, registry).enabled).toBe(true);
    expect(listPlugins(pluginRoot, registry)).toHaveLength(1);
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toContain("research.md");
    expect(readEnabledPluginInstructions(pluginRoot, registry, [], [])).not.toContain("research.md");
    expect(readEnabledPluginInstructions(pluginRoot, registry, ["team.research:skills/research.md"], [])).toContain("research.md");
    const exported = exportPlugin("team.research", pluginRoot, path.join(root, "export"), registry);
    expect(exported).toContain("team.research");
    expect(setPluginEnabled("team.research", false, pluginRoot, registry)[0].enabled).toBe(false);
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toBe("");
    expect(removePlugin("team.research", pluginRoot, registry)).toHaveLength(0);
  });

  it("imports the Claude Code Plugin directory format and loads Markdown components only", () => {
    const root = makeDirectory();
    const source = path.join(root, "claude-research");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "skills", "research"), { recursive: true });
    mkdirSync(path.join(source, "commands"), { recursive: true });
    mkdirSync(path.join(source, "agents"), { recursive: true });
    mkdirSync(path.join(source, "hooks"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "research-toolkit",
      displayName: "Research Toolkit",
      version: "1.2.0",
      description: "Research workflows for Claude Code",
    }));
    writeFileSync(path.join(source, "skills", "research", "SKILL.md"), "---\nname: research\ndescription: Research carefully\n---\nUse primary sources.");
    writeFileSync(path.join(source, "commands", "summarize.md"), "---\ndescription: Summarize findings\n---\nWrite a concise evidence-based summary.");
    writeFileSync(path.join(source, "agents", "reviewer.md"), "---\ndescription: Review research\n---\nCheck citations and unsupported claims.");
    writeFileSync(path.join(source, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(path.join(source, ".mcp.json"), JSON.stringify({ mcpServers: {} }));

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.sourceFormat).toBe("claude-code");
    expect(imported.id).toBe("research-toolkit");
    expect(imported.skills).toContain("skills/research/SKILL.md");
    expect(imported.commands).toContain("commands/summarize.md");
    expect(imported.agents).toContain("agents/reviewer.md");

    const instructions = readEnabledPluginInstructions(pluginRoot, registry);
    expect(instructions).toContain("Use primary sources.");
    expect(instructions).toContain("Write a concise evidence-based summary.");
    expect(instructions).toContain("Check citations and unsupported claims.");
    expect(listPlugins(pluginRoot, registry)[0].sourceFormat).toBe("claude-code");
  });


  it("supports standard Claude Code custom component paths and inline commands", () => {
    const root = makeDirectory();
    const source = path.join(root, "team-tools");
    mkdirSync(path.join(source, "extra-skills", "portfolio"), { recursive: true });
    mkdirSync(path.join(source, "extra-commands"), { recursive: true });
    mkdirSync(path.join(source, "agents"), { recursive: true });
    writeFileSync(path.join(source, "extra-skills", "portfolio", "SKILL.md"), "Use portfolio-specific review steps.");
    writeFileSync(path.join(source, "extra-commands", "summarize.md"), "Summarize the current analysis.");
    writeFileSync(path.join(source, "agents", "reviewer.md"), "Review evidence quality.");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "team-tools",
      skills: ["./extra-skills/"],
      commands: {
        summarize: { source: "./extra-commands/summarize.md" },
        "quick-note": { content: "Write a dated research note." },
      },
      agents: ["./agents/reviewer.md"],
    }));

    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.skills).toEqual(["extra-skills/portfolio/SKILL.md"]);
    expect(imported.commands).toEqual(["extra-commands/summarize.md"]);
    expect(imported.inlineCommands).toEqual([{ name: "quick-note", content: "Write a dated research note." }]);
    const instructions = readEnabledPluginInstructions(pluginRoot, registry);
    expect(instructions).toContain("Write a dated research note.");
    expect(instructions).toContain("Review evidence quality.");
  });


  it("imports a Claude Code plugin without an optional plugin.json manifest", () => {
    const root = makeDirectory();
    const source = path.join(root, "portable-tools");
    mkdirSync(path.join(source, "skills", "notes"), { recursive: true });
    writeFileSync(path.join(source, "skills", "notes", "SKILL.md"), "Write useful notes.");
    const pluginRoot = path.join(root, "installed");
    const registry = path.join(root, "plugins.json");
    const imported = importPlugin(source, pluginRoot, registry);
    expect(imported.id).toBe("portable-tools");
    expect(imported.sourceFormat).toBe("claude-code");
    expect(readEnabledPluginInstructions(pluginRoot, registry)).toContain("Write useful notes.");
  });

});
