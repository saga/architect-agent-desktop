import { describe, expect, it } from "vitest";
import { filterPluginRuntimeEntries, pluginRuntimeBuiltinTools } from "../src/main/plugins/plugin-runtime-policy";

describe("Claude Plugin runtime permission gate", () => {
  const entries = [
    { id: "research", directory: "/app/userData/plugins/research", skills: ["skills/research/SKILL.md", "skills/writing/SKILL.md"], fingerprint: "hash-research" },
    { id: "git", directory: "/app/userData/plugins/git", skills: [], fingerprint: "hash-git" },
    { id: "relative", directory: "relative/plugin", skills: [], fingerprint: "hash-relative" },
  ];

  it.each(["copilot", "codebuddy"] as const)(
    "allows approved directories for %s only with global Allow all and an unrestricted Expert",
    provider => {
      expect(filterPluginRuntimeEntries(provider, "allow-all", true, undefined, entries).map(entry => entry.id))
        .toEqual(["research", "git"]);
    },
  );

  it.each(["none", "browser-only", "assisted"] as const)(
    "rejects runtime plugins when global permission is %s",
    permission => {
      expect(filterPluginRuntimeEntries("copilot", permission, true, undefined, entries)).toEqual([]);
      expect(filterPluginRuntimeEntries("codebuddy", permission, true, undefined, entries)).toEqual([]);
    },
  );

  it("does not let an Expert broaden the global permission ceiling", () => {
    expect(filterPluginRuntimeEntries("copilot", "allow-all", false, undefined, entries)).toEqual([]);
    expect(filterPluginRuntimeEntries("codebuddy", "allow-all", false, undefined, entries)).toEqual([]);
  });


  it("does not load a plugin runtime beyond an Expert's Skill allowlist", () => {
    expect(filterPluginRuntimeEntries("copilot", "allow-all", true, ["research:skills/research/SKILL.md"], entries).map(entry => entry.id))
      .toEqual(["git"]);
    expect(filterPluginRuntimeEntries("codebuddy", "allow-all", true, ["research:skills/research/SKILL.md", "research:skills/writing/SKILL.md"], entries).map(entry => entry.id))
      .toEqual(["research", "git"]);
  });

  it("only exposes Bash, Skill and Task built-ins when plugin runtime authorization is active", () => {
    expect(pluginRuntimeBuiltinTools(false)).toEqual([]);
    expect(pluginRuntimeBuiltinTools(true)).toEqual(["bash", "skill", "task"]);
  });

  it("caps the number of plugin directories passed to a provider", () => {
    const many = Array.from({ length: 75 }, (_, index) => ({ id: "p" + index, directory: "/plugins/p" + index, skills: [], fingerprint: "hash-" + index }));
    expect(filterPluginRuntimeEntries("copilot", "allow-all", true, undefined, many)).toHaveLength(50);
  });
});
