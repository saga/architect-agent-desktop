import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { importPlugin, listPlugins, removePlugin, setPluginEnabled, validatePluginDirectory } from "./plugin-registry";

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
    expect(setPluginEnabled("team.research", false, pluginRoot, registry)[0].enabled).toBe(false);
    expect(removePlugin("team.research", pluginRoot, registry)).toHaveLength(0);
  });
});
