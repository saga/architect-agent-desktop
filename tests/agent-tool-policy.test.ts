import { describe, expect, it } from "vitest";
import {
  codeBuddyBuiltinToolSelection,
  filterAgentHostTools,
  resolveCodeBuddyBuiltinToolPolicy,
} from "../src/main/agent-tool-policy";

describe("CodeBuddy native builtin policy", () => {
  const readonlyTools = ["WebFetch", "WebSearch", "ListMcpResources", "ReadMcpResource", "ViewImage"];
  const allBuiltinTools = [
    "Read", "Write", "Edit", "Bash", "PowerShell", "Glob", "Grep",
    ...readonlyTools,
    "Skill", "SkillManage", "LSP", "ComputerUse",
  ];

  it("does not expose native filesystem tools in assisted mode", () => {
    expect(codeBuddyBuiltinToolSelection("assisted", true, readonlyTools)).toEqual(readonlyTools);
  });

  it("keeps Expert-restricted Tasks on Host-checked tools only", () => {
    const policy = resolveCodeBuddyBuiltinToolPolicy("allow-all", false, allBuiltinTools, readonlyTools);
    expect(policy.unrestricted).toBe(false);
    expect(policy.tools).toEqual([]);
    expect(policy.disallowedTools).toEqual(allBuiltinTools);
    for (const name of ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "PowerShell"]) {
      expect(policy.disallowedTools).toContain(name);
    }
  });

  it("allows unrestricted native tools only when both permission layers allow it", () => {
    const policy = resolveCodeBuddyBuiltinToolPolicy("allow-all", true, allBuiltinTools, readonlyTools);
    expect(policy.unrestricted).toBe(true);
    expect(policy.tools).toEqual(readonlyTools);
    expect(policy.disallowedTools).toEqual([]);
  });

  it("restricts assisted mode to read-only native tools", () => {
    const policy = resolveCodeBuddyBuiltinToolPolicy("assisted", true, allBuiltinTools, readonlyTools);
    expect(policy.unrestricted).toBe(false);
    expect(policy.tools).toEqual(readonlyTools);
    expect(policy.disallowedTools).toEqual(allBuiltinTools.filter(name => !readonlyTools.includes(name)));
  });

  it("denies native tools for none and browser-only modes", () => {
    for (const permission of ["none", "browser-only"] as const) {
      const policy = resolveCodeBuddyBuiltinToolPolicy(permission, true, allBuiltinTools, readonlyTools);
      expect(policy.unrestricted).toBe(false);
      expect(policy.tools).toEqual([]);
      expect(policy.disallowedTools).toEqual(allBuiltinTools);
    }
  });
});

describe("Expert host-tool allowlist", () => {
  const tools = [
    { name: "goal_context_list" },
    { name: "workspace_list_files" },
    { name: "workspace_read_file" },
    { name: "workspace_search_files" },
    { name: "workspace_write_file" },
    { name: "browser_list_tabs" },
    { name: "browser_execute_javascript" },
    { name: "browser_inject_css" },
    { name: "browser_cdp" },
    { name: "duckdb_query" },
    { name: "memory_search" },
  ];

  it("exposes only the explicitly selected read tool in a restricted Expert", () => {
    const selected = filterAgentHostTools(tools, "allow-all", ["workspace_read_file"], false);
    expect(selected.map(tool => tool.name)).toEqual(["workspace_read_file"]);
  });

  it("keeps the normal permission ceiling when an Expert allows all its tools", () => {
    const selected = filterAgentHostTools(tools, "assisted", [], true);
    expect(selected.map(tool => tool.name)).toEqual([
      "goal_context_list",
      "workspace_list_files",
      "workspace_read_file",
      "workspace_search_files",
      "browser_list_tabs",
      "duckdb_query",
      "memory_search",
    ]);
    expect(selected.some(tool => [
      "workspace_write_file",
      "browser_execute_javascript",
      "browser_inject_css",
      "browser_cdp",
    ].includes(tool.name))).toBe(false);
  });

  it("does not expose workspace tools when the user's permission is browser-only", () => {
    const selected = filterAgentHostTools(tools, "browser-only", [], true);
    expect(selected.map(tool => tool.name)).toEqual(["browser_list_tabs"]);
  });

  it("retains only goal context tools when all tools are disabled", () => {
    const selected = filterAgentHostTools(tools, "none", [], true);
    expect(selected).toEqual([]);
  });
});

describe("Elevated Host tools", () => {
  const elevated = [
    { name: "workspace_write_file" },
    { name: "browser_execute_javascript" },
    { name: "browser_inject_css" },
    { name: "browser_cdp" },
  ];

  it("keeps elevated file and browser operations exclusive to Allow all", () => {
    for (const permission of ["none", "browser-only", "assisted"] as const) {
      expect(filterAgentHostTools(elevated, permission, [], true)).toEqual([]);
    }
    expect(filterAgentHostTools(elevated, "allow-all", [], true)).toEqual(elevated);
  });

  it("still applies the Expert allowlist in Allow all mode", () => {
    expect(filterAgentHostTools(elevated, "allow-all", ["workspace_write_file"], false))
      .toEqual([{ name: "workspace_write_file" }]);
  });
});

describe("Tool permission and Expert ceilings", () => {
  const tools = [
    { name: "goal_context_list" },
    { name: "goal_context_update" },
    { name: "goal_context_set_status" },
    { name: "browser_list_tabs" },
    { name: "workspace_read_file" },
    { name: "memory_dreaming_commit" },
  ];

  it("exposes no Host tools in none mode, including Goal reads and writes", () => {
    expect(filterAgentHostTools(tools, "none", [], true)).toEqual([]);
  });

  it("does not let Goal tools bypass a restricted Expert allowlist", () => {
    expect(filterAgentHostTools(tools, "allow-all", ["workspace_read_file"], false))
      .toEqual([{ name: "workspace_read_file" }]);
  });

  it("allows Goal tools in assisted mode only when the Expert permits them", () => {
    const unrestrictedExpert = filterAgentHostTools(tools, "assisted", [], true);
    expect(unrestrictedExpert.map(tool => tool.name)).toEqual([
      "goal_context_list",
      "goal_context_update",
      "goal_context_set_status",
      "browser_list_tabs",
      "workspace_read_file",
      "memory_dreaming_commit",
    ]);
    const restrictedExpert = filterAgentHostTools(tools, "assisted", ["goal_context_list"], false);
    expect(restrictedExpert.map(tool => tool.name)).toEqual(["goal_context_list"]);
  });
});
