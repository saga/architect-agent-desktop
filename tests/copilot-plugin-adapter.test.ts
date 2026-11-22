import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareCopilotPluginDirectories } from "../src/main/plugins/copilot-plugin-adapter";
import { pluginContentFingerprint } from "../src/main/plugins/plugin-content";

const roots: string[] = [];
function temp(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "copilot-plugin-adapter-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stage(sourceDirectories: string[], runtimeRoot: string): string[] {
  return prepareCopilotPluginDirectories(sourceDirectories.map(directory => ({
    id: path.basename(directory),
    directory,
    skills: [],
    fingerprint: pluginContentFingerprint(directory),
  })), runtimeRoot);
}

describe("Copilot Claude Plugin runtime projection", () => {
  it("stages a Claude plugin without changing the installed source", () => {
    const root = temp();
    const source = path.join(root, "installed", "research-tools");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "skills", "research"), { recursive: true });
    mkdirSync(path.join(source, "hooks"), { recursive: true });
    mkdirSync(path.join(source, "scripts"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "research-tools", version: "1.2.0",
    }));
    writeFileSync(path.join(source, "skills", "research", "SKILL.md"), "Run node ${CLAUDE_PLUGIN_ROOT}/scripts/run.js");
    writeFileSync(path.join(source, "hooks", "hooks.json"), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/scripts/check.sh" }] }] },
    }));
    writeFileSync(path.join(source, "scripts", "run.js"), "console.log(process.env.CLAUDE_PLUGIN_ROOT, process.env.CLAUDE_PLUGIN_DATA);");
    writeFileSync(path.join(source, "scripts", "check.sh"), "echo ${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA}");
    writeFileSync(path.join(source, "scripts", "check.ps1"), "Write-Output $env:CLAUDE_PLUGIN_ROOT");
    writeFileSync(path.join(source, ".lsp.json"), JSON.stringify({
      typescript: { command: "typescript-language-server", args: ["--stdio"] },
    }));
    writeFileSync(path.join(source, "plugin.json"), JSON.stringify({ name: "wrong-provider-manifest" }));

    const runtimeRoot = path.join(root, "runtime");
    const [staged] = stage([source], runtimeRoot);
    expect(staged).toBe(path.join(runtimeRoot, "research-tools"));
    expect(JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"))).toMatchObject({
      name: "research-tools",
    });
    expect(JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"))).not.toHaveProperty("hooks");
    expect(JSON.parse(readFileSync(path.join(source, "plugin.json"), "utf8"))).toEqual({ name: "wrong-provider-manifest" });
    expect(existsSync(path.join(staged!, "hooks.json"))).toBe(true);
    expect(readFileSync(path.join(staged!, "hooks.json"), "utf8")).toContain("PreToolUse");
    expect(JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"))).not.toHaveProperty("commands");
    expect(existsSync(path.join(staged!, "lsp.json"))).toBe(true);
    expect(existsSync(path.join(staged!, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(readFileSync(path.join(staged!, "skills", "research", "SKILL.md"), "utf8")).toContain("${PLUGIN_ROOT}");
    expect(readFileSync(path.join(staged!, "hooks", "hooks.json"), "utf8")).toContain("${PLUGIN_ROOT}");
    expect(readFileSync(path.join(staged!, "scripts", "run.js"), "utf8")).toContain("process.env.PLUGIN_ROOT");
    expect(readFileSync(path.join(staged!, "scripts", "run.js"), "utf8")).toContain("process.env.CLAUDE_PLUGIN_DATA");
    expect(readFileSync(path.join(staged!, "scripts", "check.sh"), "utf8")).toContain("${PLUGIN_ROOT}");
    expect(readFileSync(path.join(staged!, "scripts", "check.sh"), "utf8")).toContain("${CLAUDE_PLUGIN_DATA}");
    expect(readFileSync(path.join(staged!, "scripts", "check.ps1"), "utf8")).toContain("$env:PLUGIN_ROOT");
    expect(readFileSync(path.join(source, "scripts", "run.js"), "utf8")).toContain("process.env.CLAUDE_PLUGIN_ROOT");
    expect(readFileSync(path.join(source, "scripts", "run.js"), "utf8")).toContain("process.env.CLAUDE_PLUGIN_DATA");
    expect(readFileSync(path.join(source, "scripts", "check.sh"), "utf8")).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(readFileSync(path.join(source, "scripts", "check.ps1"), "utf8")).toContain("$env:CLAUDE_PLUGIN_ROOT");
    expect(readFileSync(path.join(source, "skills", "research", "SKILL.md"), "utf8")).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(readFileSync(path.join(source, "hooks", "hooks.json"), "utf8")).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(JSON.parse(readFileSync(path.join(source, "plugin.json"), "utf8"))).toEqual({ name: "wrong-provider-manifest" });
    expect(existsSync(path.join(source, "lsp.json"))).toBe(false);
  });

  it("projects custom Hooks, MCP and LSP manifest configuration to Copilot defaults", () => {
    const root = temp();
    const source = path.join(root, "custom-runtime");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "configs"), { recursive: true });
    mkdirSync(path.join(source, "custom-commands"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "custom-runtime",
      hooks: "configs/hooks.json",
      mcpServers: ["configs/mcp.json", { second: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/second.js"] } }],
      lspServers: ["configs/lsp.json", { second: { command: "${CLAUDE_PLUGIN_ROOT}/bin/second-lsp", args: ["--stdio"] } }],
      commands: "custom-commands",
    }));
    writeFileSync(path.join(source, "configs", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [] } }));
    writeFileSync(path.join(source, "configs", "mcp.json"), JSON.stringify({
      mcpServers: { custom: { command: "node", args: ["server.js"] } },
    }));
    writeFileSync(path.join(source, "configs", "lsp.json"), JSON.stringify({
      custom: { command: "custom-lsp", args: ["--stdio"] },
    }));

    const [staged] = stage([source], path.join(root, "runtime"));
    expect(existsSync(path.join(staged!, "hooks.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(staged!, ".mcp.json"), "utf8"))).toHaveProperty("mcpServers.custom");
    expect(JSON.parse(readFileSync(path.join(staged!, ".mcp.json"), "utf8"))).toHaveProperty("mcpServers.second");
    expect(readFileSync(path.join(staged!, ".mcp.json"), "utf8")).toContain("${PLUGIN_ROOT}/second.js");
    expect(JSON.parse(readFileSync(path.join(staged!, ".lsp.json"), "utf8"))).toHaveProperty("lspServers.custom");
    expect(JSON.parse(readFileSync(path.join(staged!, ".lsp.json"), "utf8"))).toHaveProperty("lspServers.second");
    expect(readFileSync(path.join(staged!, ".lsp.json"), "utf8")).toContain("${PLUGIN_ROOT}/bin/second-lsp");
    expect(existsSync(path.join(staged!, "lsp.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"));
    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(manifest).not.toHaveProperty("lspServers");
    expect(manifest.commands).toBe("custom-commands");
  });

  it("preserves explicit LSP configuration and existing Copilot lsp.json", () => {
    const root = temp();
    const source = path.join(root, "lint-tools");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "lint-tools", lspServers: "./custom-lsp.json",
    }));
    writeFileSync(path.join(source, ".lsp.json"), JSON.stringify({ go: { command: "gopls" } }));
    writeFileSync(path.join(source, "custom-lsp.json"), JSON.stringify({ rust: { command: "rust-analyzer" } }));
    writeFileSync(path.join(source, "lsp.json"), JSON.stringify({ python: { command: "pyright" } }));

    const [staged] = stage([source], path.join(root, "runtime"));
    const manifest = JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"));
    expect(manifest).not.toHaveProperty("lspServers");
    expect(readFileSync(path.join(staged!, ".lsp.json"), "utf8")).toContain("rust-analyzer");
    const mergedLsp = JSON.parse(readFileSync(path.join(staged!, "lsp.json"), "utf8"));
    expect(mergedLsp.lspServers).toHaveProperty("go");
    expect(mergedLsp.lspServers).toHaveProperty("rust");
    expect(mergedLsp.lspServers).toHaveProperty("python");
  });

  it("exposes the Claude commands directory to Copilot's native legacy plugin loader", () => {
    const root = temp();
    const source = path.join(root, "command-tools");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "commands"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "command-tools" }));
    writeFileSync(path.join(source, "commands", "review.md"), "Review this repository");
    const [staged] = stage([source], path.join(root, "runtime"));
    const manifest = JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"));
    expect(manifest.name).toBe("command-tools");
    expect(manifest.commands).toBe("./commands");
    expect(readFileSync(path.join(staged!, "commands", "review.md"), "utf8")).toContain("Review this repository");
  });

  it("creates a root manifest for a manifest-less skill plugin", () => {
    const root = temp();
    const source = path.join(root, "portable-skill");
    mkdirSync(path.join(source, "skills", "notes"), { recursive: true });
    writeFileSync(path.join(source, "skills", "notes", "SKILL.md"), "Write concise notes");
    const [staged] = stage([source], path.join(root, "runtime"));
    expect(JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"))).toEqual({ name: "portable-skill" });
  });
  it("accepts common package-relative paths without a leading ./", () => {
    const root = temp();
    const source = path.join(root, "relative-paths");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "hooks"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "relative-paths", hooks: "hooks/hooks.json",
    }));
    writeFileSync(path.join(source, "hooks", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [] } }));
    const [staged] = stage([source], path.join(root, "runtime"));
    expect(readFileSync(path.join(staged!, "hooks.json"), "utf8")).toContain("SessionStart");
  });

  it("rejects manifest config paths that escape the plugin package", () => {
    const root = temp();
    const source = path.join(root, "unsafe-path");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "unsafe-path", hooks: "../outside.json",
    }));
    expect(() => stage([source], path.join(root, "runtime"))).toThrow(/路径越界/);
  });


  it("merges multiple Claude Hook configuration sources", () => {
    const root = temp();
    const source = path.join(root, "hook-array");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "hooks"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "hook-array",
      hooks: ["./hooks/first.json", { hooks: { Stop: [{ hooks: [{ type: "command", command: "bash " + "${CLAUDE_PLUGIN_ROOT}/scripts/stop.sh" }] }] } }],
    }));
    writeFileSync(path.join(source, "hooks", "first.json"), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }] },
    }));
    const [staged] = stage([source], path.join(root, "runtime"));
    const config = JSON.parse(readFileSync(path.join(staged!, "hooks.json"), "utf8"));
    expect(config.hooks).toHaveProperty("SessionStart");
    expect(config.hooks).toHaveProperty("Stop");
    expect(JSON.stringify(config)).toContain("${PLUGIN_ROOT}/scripts/stop.sh");
  });

  it("projects Claude Markdown Agents and source/content Commands into Copilot Legacy format", () => {
    const root = temp();
    const source = path.join(root, "markdown-components");
    mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(source, "agents"), { recursive: true });
    mkdirSync(path.join(source, "extra-agents"), { recursive: true });
    mkdirSync(path.join(source, "commands"), { recursive: true });
    writeFileSync(path.join(source, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "markdown-components",
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      agents: ["./agents/", "./extra-agents/researcher.md"],
      commands: {
        review: { source: "./commands/review.md" },
        "quick-note": { content: "Create a concise research note." },
      },
    }));
    writeFileSync(path.join(source, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Review the repository\n---\nReview carefully. Use ${CLAUDE_PLUGIN_ROOT}/templates/review.md.");
    writeFileSync(path.join(source, "extra-agents", "researcher.md"), "Research with primary sources.");
    writeFileSync(path.join(source, "commands", "review.md"), "Review the current findings.");

    const [staged] = stage([source], path.join(root, "runtime"));
    const manifest = JSON.parse(readFileSync(path.join(staged!, "plugin.json"), "utf8"));
    expect(manifest.agents).toEqual(["./agents", "./extra-agents"]);
    expect(manifest).not.toHaveProperty("$schema");
    expect(existsSync(path.join(staged!, "agents", "reviewer.agent.md"))).toBe(true);
    expect(existsSync(path.join(staged!, "extra-agents", "researcher.agent.md"))).toBe(true);
    expect(readFileSync(path.join(staged!, "agents", "reviewer.agent.md"), "utf8")).toContain("${PLUGIN_ROOT}/templates/review.md");
    expect(typeof manifest.commands).toBe("string");
    const commandDirectory = path.resolve(staged!, manifest.commands);
    const generated = readdirSync(commandDirectory).filter(name => name.endsWith(".md"));
    expect(generated).toHaveLength(2);
    expect(generated.map(name => readFileSync(path.join(commandDirectory, name), "utf8")).join("\n"))
      .toContain("Create a concise research note.");
    expect(readFileSync(path.join(source, "agents", "reviewer.md"), "utf8")).toContain("Review carefully.");
    expect(existsSync(path.join(source, "agents", "reviewer.agent.md"))).toBe(false);
  });

});
