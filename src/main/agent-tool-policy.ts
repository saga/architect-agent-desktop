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
