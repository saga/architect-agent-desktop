import type { AgentToolPermission } from "../shared/types";

/** Restricted Experts use Host-checked tools; Provider-native tools are broader. */
export function codeBuddyBuiltinToolSelection(
  permission: AgentToolPermission,
  expertAllowsAllTools: boolean,
  readOnlyBuiltinTools: readonly string[],
): string[] | null {
  if (permission === "none" || permission === "browser-only" || !expertAllowsAllTools) return [];
  if (permission === "assisted") return [...readOnlyBuiltinTools];
  return null;
}

export interface CodeBuddyBuiltinToolPolicy {
  unrestricted: boolean;
  tools: string[];
  disallowedTools: string[];
}

/** Build the exact native-tool allow/deny lists passed to the CodeBuddy SDK. */
export function resolveCodeBuddyBuiltinToolPolicy(
  permission: AgentToolPermission,
  expertAllowsAllTools: boolean,
  builtinTools: readonly string[],
  readOnlyBuiltinTools: readonly string[],
): CodeBuddyBuiltinToolPolicy {
  const selected = codeBuddyBuiltinToolSelection(permission, expertAllowsAllTools, readOnlyBuiltinTools);
  const unrestricted = permission === "allow-all" && selected === null;
  const tools = permission === "none" || permission === "browser-only"
    ? []
    : selected ?? [...readOnlyBuiltinTools];
  const disallowedTools = permission === "none" || permission === "browser-only"
    ? [...builtinTools]
    : selected
      ? builtinTools.filter(name => !selected.includes(name))
      : [];
  return { unrestricted, tools, disallowedTools };
}

/** Apply both the user permission ceiling and the Expert's explicit tool allowlist. */
export function filterAgentHostTools<T extends { name: string }>(
  tools: readonly T[],
  permission: AgentToolPermission,
  expertTools: readonly string[],
  expertAllowsAllTools: boolean,
): T[] {
  const expertAllowsTool = (toolName: string) => expertAllowsAllTools || expertTools.includes(toolName);
  const elevatedTools = new Set([
    "workspace_write_file",
    "browser_execute_javascript",
    "browser_inject_css",
    "browser_cdp",
  ]);
  return tools.filter(tool => {
    const permissionAllowsTool =
      tool.name.startsWith("goal_context_") || permission === "allow-all" ||
      (permission !== "none" && tool.name.startsWith("browser_")) ||
      (permission === "assisted" && (
        tool.name.startsWith("workspace_") ||
        tool.name.startsWith("duckdb_") ||
        tool.name.startsWith("document_") ||
        tool.name.startsWith("memory_") ||
        tool.name.startsWith("a2ui_")
      ));
    const permissionDeniesElevatedTool = permission !== "allow-all" && elevatedTools.has(tool.name);
    return permissionAllowsTool &&
      !permissionDeniesElevatedTool &&
      (expertAllowsTool(tool.name) || tool.name.startsWith("goal_context_"));
  });
}
