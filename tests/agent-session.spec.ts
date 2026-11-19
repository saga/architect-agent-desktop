import { describe, expect, it } from "vitest";
import { MAX_AGENT_SESSION_ITEMS, parseAgentSessionItems } from "../src/main/agent-session";

describe("parseAgentSessionItems", () => {
  it("returns an empty list for non-arrays", () => {
    expect(parseAgentSessionItems(null)).toEqual([]);
    expect(parseAgentSessionItems({ items: [] })).toEqual([]);
  });

  it("drops malformed entries and keeps valid ones", () => {
    const parsed = parseAgentSessionItems([
      { kind: "user", content: "hello", id: "a", createdAt: 1 },
      { kind: "system", content: "unknown kind" },
      { kind: "assistant", content: 42 },
      null,
      "text",
      { kind: "tool", content: "clicked", toolName: "Click element", toolState: "done" },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ kind: "user", content: "hello", id: "a", createdAt: 1 });
    expect(parsed[1]).toMatchObject({ kind: "tool", toolName: "Click element", toolState: "done" });
    expect(typeof parsed[1]!.createdAt).toBe("number");
  });

  it("generates ids for items without one", () => {
    const [item] = parseAgentSessionItems([{ kind: "user", content: "hi" }]);
    expect(item!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("clamps oversized content and tool names", () => {
    const [item] = parseAgentSessionItems([
      { kind: "assistant", content: "x".repeat(30000), toolName: "y".repeat(500), id: "z".repeat(500) },
    ]);

    expect(item!.content).toHaveLength(20000);
    expect(item!.toolName).toHaveLength(200);
    expect(item!.id).toHaveLength(100);
  });

  it("keeps only the newest items", () => {
    const items = Array.from({ length: MAX_AGENT_SESSION_ITEMS + 25 }, (_, index) => ({
      kind: "user",
      content: "message " + index,
    }));

    const parsed = parseAgentSessionItems(items);

    expect(parsed).toHaveLength(MAX_AGENT_SESSION_ITEMS);
    expect(parsed[0]!.content).toBe("message 25");
    expect(parsed.at(-1)!.content).toBe("message " + (MAX_AGENT_SESSION_ITEMS + 24));
  });

  it("ignores unknown tool states", () => {
    const [item] = parseAgentSessionItems([{ kind: "tool", content: "x", toolState: "running" }]);
    expect(item!.toolState).toBeUndefined();
  });
});
