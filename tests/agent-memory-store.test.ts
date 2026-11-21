import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryStore } from "../src/main/memory/agent-memory-store";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-memory-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("AgentMemoryStore", () => {
  it("stores sourced notes per workspace, supports review, and injects a bounded index", () => {
    const directory = temporaryDirectory();
    const store = new AgentMemoryStore(path.join(directory, "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/portfolio",
      title: "Portfolio data convention",
      content: "The holdings workbook uses one row per security; verify the as-of date before comparing returns.",
      tags: ["portfolio", "excel"],
      sourceSessionId: "session-1",
      sourceTraceId: "trace-1",
    });

    expect(note.validation).toBe("unverified");
    expect(note.sourceSessionId).toBe("session-1");
    expect(store.search("/workspace/portfolio", "holdings")).toHaveLength(1);
    expect(store.search("/workspace/another-project", "holdings")).toHaveLength(0);

    const reviewed = store.setValidation(note.id, "validated", 0.95);
    expect(reviewed.validation).toBe("validated");
    expect(reviewed.confidence).toBe(0.95);

    store.publishRepresentation({
      scope: "/workspace/portfolio",
      slug: "portfolio-data",
      title: "Portfolio data model",
      content: "Holdings data contains one row per security and requires an explicit as-of date.",
      sourceNoteIds: [note.id],
    });
    const context = store.getInjectedContext("/workspace/portfolio", 1200);
    expect(context).toContain("Portfolio data model");
    expect(context).toContain("[validated");
    expect(context.length).toBeLessThanOrEqual(1300);

    store.archive(note.id);
    expect(store.getNote(note.id)).toBeNull();
    store.close();
  });

  it("supports Chinese fallback search and keeps disputed notes out of the trusted layer", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/cn",
      title: "组合风控口径",
      content: "组合风险分析必须区分净敞口、总敞口和衍生品名义本金。",
    });
    expect(store.search("/workspace/cn", "衍生品名义本金")).toHaveLength(1);
    store.setValidation(note.id, "disputed", 0.2);
    expect(store.getInjectedContext("/workspace/cn")).toContain("[disputed");
    store.close();
  });
});
