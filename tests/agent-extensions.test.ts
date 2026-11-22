import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import {
  importAgentSkill, importAgentSkillArchive, listAgentSkills, listMcpServers, readEnabledAgentSkillInstructions,
  removeAgentSkill, removeMcpServer, resolveMcpServerConfigs, saveMcpServer,
  setAgentSkillEnabled, setMcpServerEnabled,
} from "../src/main/agent-extensions";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "architect-agent-extensions-"));
  roots.push(root);
  return root;
}
function zipCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const crc = zipCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
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
  it("saves, enables, resolves environment references and removes local servers", async () => {
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

  it("supports remote HTTP configuration and rejects untrusted protocols or invalid ids", async () => {
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

  it("fails closed when a referenced environment variable is missing", async () => {
    const file = path.join(temporaryRoot(), "mcp.json");
    saveMcpServer({ id: "private-api", transport: "stdio", enabled: true, command: "node", args: [], env: { TOKEN: "\${NOT_CONFIGURED}" } }, file);
    expect(() => resolveMcpServerConfigs(listMcpServers(file), "copilot", {})).toThrow(/NOT_CONFIGURED/);
  });
});

describe("Agent Skills", () => {
  it("imports SKILL.md directories, injects enabled instructions and toggles state", async () => {
    const root = temporaryRoot();
    const source = makeSkill(root);
    const installed = path.join(root, "installed");
    const registry = path.join(root, "skills.json");

    expect(await importAgentSkill(source, installed, registry)).toMatchObject({ id: "review-code", enabled: true });
    expect(await listAgentSkills(installed, registry)).toHaveLength(1);
    expect(await readEnabledAgentSkillInstructions(installed, registry)).toContain("Read the changed files");
    expect((await setAgentSkillEnabled("review-code", false, installed, registry))[0]?.enabled).toBe(false);
    expect(await readEnabledAgentSkillInstructions(installed, registry)).toBe("");
    expect((await setAgentSkillEnabled("review-code", true, installed, registry))[0]?.enabled).toBe(true);
    expect(await removeAgentSkill("review-code", installed, registry)).toEqual([]);
  });

  it("imports Claude Desktop-style ZIP files with a named folder and lowercase skill.md", async () => {
    const root = temporaryRoot();
    const archivePath = path.join(root, "web-research.zip");
    const installed = path.join(root, "installed");
    const registry = path.join(root, "skills.json");
    const markdown = [
      "---",
      "name: web-research",
      "description: Research current web sources and cite material claims.",
      "---",
      "",
      "Use primary sources and cite each important claim.",
    ].join("\n");
    writeFileSync(archivePath, makeZip([
      ["web-research/skill.md", markdown],
      ["web-research/references/sources.md", "Prefer official documentation."],
    ]));

    expect(await importAgentSkillArchive(archivePath, installed, registry)).toMatchObject({
      id: "web-research", enabled: true,
    });
    expect(await readEnabledAgentSkillInstructions(installed, registry)).toContain("Use primary sources");
    expect(await listAgentSkills(installed, registry)).toHaveLength(1);
  });

  it("rejects ZIP path traversal before extracting any file", async () => {
    const root = temporaryRoot();
    const archivePath = path.join(root, "unsafe.zip");
    writeFileSync(archivePath, makeZip([
      ["web-research/SKILL.md", [
        "---", "name: web-research",
        "description: Research current web sources and cite material claims.",
        "---", "", "Research safely.",
      ].join("\n")],
      ["../escaped.txt", "must not be written"],
    ]));
    await expect(importAgentSkillArchive(archivePath, path.join(root, "installed"), path.join(root, "skills.json"))).rejects.toThrow(/路径穿越/);
  });

  it("rejects Skill folders without standard metadata", async () => {
    const root = temporaryRoot();
    const source = path.join(root, "broken-skill");
    mkdirSync(source);
    writeFileSync(path.join(source, "SKILL.md"), "# No frontmatter");
    await expect(importAgentSkill(source, path.join(root, "installed"), path.join(root, "skills.json"))).rejects.toThrow(/frontmatter/);
  });
});
