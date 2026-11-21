import { randomUUID } from "node:crypto";
import type { AgentSessionItem } from "../shared/types";

/** Session messages are stored individually in SQLite with a bounded per-task transcript. */
/**
 * Validate and normalize persisted transcript items.
 * Unknown kinds and malformed entries are dropped rather than failing the load.
 */
export const MAX_AGENT_SESSION_ITEMS = 2_000;

export function parseAgentSessionItems(value: unknown): AgentSessionItem[] {
  if (!Array.isArray(value)) return [];
  const items: AgentSessionItem[] = [];
  for (const raw of value.slice(-MAX_AGENT_SESSION_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<AgentSessionItem>;
    if (!["user", "assistant", "thinking", "tool", "error", "a2ui"].includes(item.kind ?? "")) continue;
    if (typeof item.content !== "string") continue;
    items.push({
      id: typeof item.id === "string" && item.id ? item.id.slice(0, 100) : randomUUID(),
      kind: item.kind as AgentSessionItem["kind"],
      content: item.content.slice(0, 20000),
      ...(typeof item.toolName === "string" ? { toolName: item.toolName.slice(0, 200) } : {}),
      ...(item.toolState === "running" || item.toolState === "done" || item.toolState === "error" ? { toolState: item.toolState } : {}),
      createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    });
  }
  return items;
}
