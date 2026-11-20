import { describe, expect, it } from "vitest";
import { parseAgentSessionItems } from "../src/main/agent-session";

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

  it("keeps the complete transcript instead of truncating it to 200 items", () => {
    const items = Array.from({ length: 250 }, (_, index) => ({
      kind: "user",
      content: "message " + index,
    }));

    const parsed = parseAgentSessionItems(items);

    expect(parsed).toHaveLength(250);
    expect(parsed[0]!.content).toBe("message 0");
    expect(parsed.at(-1)!.content).toBe("message 249");
  });

  it("retains only the newest 2,000 items when loading an oversized legacy transcript", () => {
    const parsed = parseAgentSessionItems(Array.from({ length: 2_010 }, (_, index) => ({ kind: "user", content: String(index) })));
    expect(parsed).toHaveLength(2_000);
    expect(parsed[0]!.content).toBe("10");
    expect(parsed.at(-1)!.content).toBe("2009");
  });

  it("ignores unknown tool states", () => {
    const [item] = parseAgentSessionItems([{ kind: "tool", content: "x", toolState: "running" }]);
    expect(item!.toolState).toBeUndefined();
  });
});
