import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  importAgentSkill, listAgentSkills, listMcpServers, readEnabledAgentSkillInstructions,
  removeAgentSkill, removeMcpServer, resolveMcpServerConfigs, saveMcpServer,
  setAgentSkillEnabled, setMcpServerEnabled,
} from "../src/main/agent-extensions";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "architect-agent-extensions-"));
  roots.push(root);
  return root;
}
function makeSkill(root: string, name = "review-code"): string {
  const source = path.join(root, name);
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, "SKILL.md"), [
    "---",
    "name: " + name,
    "description: Review code changes for correctness and maintainability.",
    "---",
    "",
    "Read the changed files before suggesting a patch.",
  ].join("\n"));
  return source;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("MCP server configuration", () => {
  it("saves, enables, resolves environment references and removes local servers", () => {
    const root = temporaryRoot();
    const configFile = path.join(root, "mcp-servers.json");
    const server = {
      id: "filesystem", transport: "stdio", enabled: true, command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      env: { API_TOKEN: "\${API_TOKEN}" }, cwd: "/workspace", timeout: 45000,
    } as const;

    expect(saveMcpServer(server, configFile)).toHaveLength(1);
    expect(listMcpServers(configFile)[0]?.id).toBe("filesystem");
    expect(resolveMcpServerConfigs(listMcpServers(configFile), "copilot", { API_TOKEN: "test-token" })).toEqual({
      filesystem: {
        type: "local", command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        env: { API_TOKEN: "test-token" }, workingDirectory: "/workspace", timeout: 45000, tools: ["*"],
      },
    });

    expect(setMcpServerEnabled("filesystem", false, configFile)[0]?.enabled).toBe(false);
    expect(resolveMcpServerConfigs(listMcpServers(configFile), "codebuddy", {})).toEqual({});
    expect(setMcpServerEnabled("filesystem", true, configFile)[0]?.enabled).toBe(true);
    expect(removeMcpServer("filesystem", configFile)).toEqual([]);
  });

  it("supports remote HTTP configuration and rejects untrusted protocols or invalid ids", () => {
    const file = path.join(temporaryRoot(), "mcp.json");
    saveMcpServer({
      id: "remote-api", transport: "http", enabled: true, url: "https://example.com/mcp",
      headers: { Authorization: "Bearer \${MCP_TOKEN}" }, timeout: 30000,
    }, file);
    expect(resolveMcpServerConfigs(listMcpServers(file), "copilot", { MCP_TOKEN: "secret" })["remote-api"]).toMatchObject({
      type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer secret" },
    });
    expect(() => saveMcpServer({ id: "bad id", transport: "stdio", enabled: true, command: "npx" }, file)).toThrow();
    expect(() => saveMcpServer({ id: "remote", transport: "http", enabled: true, url: "file:///etc/passwd" }, file)).toThrow();
  });

  it("fails closed when a referenced environment variable is missing", () => {
    const file = path.join(temporaryRoot(), "mcp.json");
    saveMcpServer({ id: "private-api", transport: "stdio", enabled: true, command: "node", args: [], env: { TOKEN: "\${NOT_CONFIGURED}" } }, file);
    expect(() => resolveMcpServerConfigs(listMcpServers(file), "copilot", {})).toThrow(/NOT_CONFIGURED/);
  });
});

describe("Agent Skills", () => {
  it("imports SKILL.md directories, injects enabled instructions and toggles state", () => {
    const root = temporaryRoot();
    const source = makeSkill(root);
    const installed = path.join(root, "installed");
    const registry = path.join(root, "skills.json");

    expect(importAgentSkill(source, installed, registry)).toMatchObject({ id: "review-code", enabled: true });
    expect(listAgentSkills(installed, registry)).toHaveLength(1);
    expect(readEnabledAgentSkillInstructions(installed, registry)).toContain("Read the changed files");
    expect(setAgentSkillEnabled("review-code", false, installed, registry)[0]?.enabled).toBe(false);
    expect(readEnabledAgentSkillInstructions(installed, registry)).toBe("");
    expect(setAgentSkillEnabled("review-code", true, installed, registry)[0]?.enabled).toBe(true);
    expect(removeAgentSkill("review-code", installed, registry)).toEqual([]);
  });

  it("rejects Skill folders without standard metadata", () => {
    const root = temporaryRoot();
    const source = path.join(root, "broken-skill");
    mkdirSync(source);
    writeFileSync(path.join(source, "SKILL.md"), "# No frontmatter");
    expect(() => importAgentSkill(source, path.join(root, "installed"), path.join(root, "skills.json"))).toThrow(/frontmatter/);
  });
});
