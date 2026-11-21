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
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AgentMemoryStore", () => {
  it("stores sourced notes per workspace, supports review, and injects a bounded index", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const prepared = store.prepareDreaming("/workspace/portfolio", [{
      sessionId: "session-1",
      messageId: "source-1",
      kind: "user",
      content: "The holdings workbook uses one row per security; verify the as-of date before comparing returns.",
      createdAt: Date.now(),
    }]);
    const evidence = prepared!.evidence[0]!;
    const note = store.saveNote({
      scope: "/workspace/portfolio",
      title: "Portfolio data convention",
      content: "The holdings workbook uses one row per security; verify the as-of date before comparing returns.",
      tags: ["portfolio", "excel"],
      sourceSessionId: "session-1",
      sourceTraceId: "trace-1",
      sourceRefs: [evidence.sourceId],
    });

    expect(note.validation).toBe("unverified");
    expect(note.sourceSessionId).toBe("session-1");
    expect(store.search("/workspace/portfolio", "holdings")).toHaveLength(1);
    expect(store.search("/workspace/another-project", "holdings")).toHaveLength(0);

    const reviewed = store.setValidation(note.id, "validated", 0.95, [evidence.sourceId], "/workspace/portfolio");
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

    store.archive(note.id, "/workspace/portfolio");
    expect(store.getNote(note.id, "/workspace/portfolio")).toBeNull();
    store.close();
  });

  it("supports Chinese fallback search and preserves disputed notes as disputed", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/cn",
      title: "组合风控口径",
      content: "组合风险分析必须区分净敞口、总敞口和衍生品名义本金。",
    });
    expect(store.search("/workspace/cn", "衍生品名义本金")).toHaveLength(1);

    const prepared = store.prepareDreaming("/workspace/cn", [{
      sessionId: "session-cn",
      messageId: "source-cn",
      kind: "user",
      content: "已确认组合风险分析必须区分净敞口、总敞口和衍生品名义本金。",
      createdAt: Date.now(),
    }]);
    store.setValidation(note.id, "disputed", 0.2, [prepared!.evidence[0]!.sourceId], "/workspace/cn");
    expect(store.getInjectedContext("/workspace/cn")).toContain("[disputed");
    store.close();
  });

  it("commits evidence-backed Dreaming atomically, advances the cursor, and can roll back", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now();
    const run = store.prepareDreaming("/workspace/dream", [{
      sessionId: "session-dream",
      messageId: "message-dream",
      kind: "assistant",
      content: "成功流程：每次组合收益比较必须核对估值日、币种和费用口径。",
      createdAt,
    }]);
    expect(run?.status).toBe("prepared");
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt: 0, sessionId: "", messageId: "",
    });

    const sourceId = run!.evidence[0]!.sourceId;
    const committed = store.commitDreaming({
      scope: "/workspace/dream",
      runId: run!.id,
      summary: "沉淀组合收益比较前必须核对估值日、币种和费用口径的成功检查流程。",
      operations: [{
        op: "upsert_note",
        title: "组合收益比较检查",
        content: "比较组合收益前，必须先确认估值日、币种和费用口径。",
        tags: ["portfolio", "performance"],
        importance: 0.9,
        sourceRefs: [sourceId],
        reason: "这是可复用且能避免分析错误的稳定成功流程。",
      }],
    });
    expect(committed.status).toBe("completed");
    expect(committed.createdNoteIds).toHaveLength(1);
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt, sessionId: "session-dream", messageId: "message-dream",
    });
    const note = store.getNote(committed.createdNoteIds[0]!, "/workspace/dream");
    expect(note?.validation).toBe("unverified");
    expect(note?.sourceRefs).toContain(sourceId);
    expect(store.listDreamRuns("/workspace/dream")[0]?.status).toBe("completed");

    const rolledBack = store.rollbackDreaming("/workspace/dream", run!.id, "验证回滚功能");
    expect(rolledBack.rolledBackOperations).toBeGreaterThan(0);
    expect(store.getNote(committed.createdNoteIds[0]!, "/workspace/dream")).toBeNull();
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt: 0, sessionId: "", messageId: "",
    });
    store.close();
  });

  it("does not commit a Dreaming plan when a note version has changed", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const first = store.prepareDreaming("/workspace/conflict", [{
      sessionId: "session-conflict",
      messageId: "message-conflict",
      kind: "user",
      content: "项目规定 SQL 表和字段必须使用小写 snake_case。",
      createdAt: Date.now(),
    }]);
    const sourceId = first!.evidence[0]!.sourceId;
    const note = store.saveNote({
      scope: "/workspace/conflict",
      title: "SQL 命名约定",
      content: "SQL 表和字段使用 snake_case。",
      sourceRefs: [sourceId],
    });
    store.saveNote({
      id: note.id,
      scope: "/workspace/conflict",
      title: "SQL 命名约定",
      content: "SQL 表和字段必须使用小写 snake_case，并避免保留字。",
    });

    expect(() => store.commitDreaming({
      scope: "/workspace/conflict",
      runId: first!.id,
      summary: "合并一条同名约定",
      operations: [{
        op: "upsert_note",
        id: note.id,
        baseVersion: note.version,
        title: "SQL 命名约定",
        content: "SQL 表和字段使用 snake_case。",
        sourceRefs: [sourceId],
        reason: "版本冲突应阻止覆盖后续更新。",
      }],
    })).toThrow(/版本已变化/);
    expect(store.getDreamRun(first!.id, "/workspace/conflict")?.status).toBe("prepared");
    expect(store.getDreamCursor("/workspace/conflict").createdAt).toBe(0);
    expect(store.getNote(note.id, "/workspace/conflict")?.content).toContain("避免保留字");
    store.abandonDreaming("/workspace/conflict", first!.id, "版本冲突后放弃");
    store.close();
  });

  it("uses a stable composite cursor to avoid skipping messages with equal timestamps", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const timestamp = Date.now();
    const first = store.prepareDreaming("/workspace/tie", [{
      sessionId: "session-a",
      messageId: "message-1",
      kind: "user",
      content: "第一条消息",
      createdAt: timestamp,
    }]);
    const sourceA = first!.evidence[0]!.sourceId;
    store.commitDreaming({
      scope: "/workspace/tie",
      runId: first!.id,
      summary: "处理第一条消息",
      operations: [{
        op: "upsert_note",
        title: "第一条记录",
        content: "第一条消息内容",
        sourceRefs: [sourceA],
        reason: "记录第一条消息。",
      }],
    });

    const second = store.prepareDreaming("/workspace/tie", [
      { sessionId: "session-b", messageId: "message-2", kind: "user", content: "第二条消息", createdAt: timestamp },
      { sessionId: "session-c", messageId: "message-3", kind: "user", content: "第三条消息", createdAt: timestamp },
    ]);
    expect(second?.evidence.map(source => source.sessionId)).toEqual(["session-b", "session-c"]);
    store.abandonDreaming("/workspace/tie", second!.id, "验证同时间戳游标");
    store.close();
  });
  it("advances the cursor for a reviewed batch with no durable memory changes", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now();
    const run = store.prepareDreaming("/workspace/no-op", [{
      sessionId: "session-no-op",
      messageId: "message-no-op",
      kind: "user",
      content: "这个请求是一次性信息，没有长期适用的项目事实或工作偏好。",
      createdAt,
    }]);
    const result = store.commitDreaming({
      scope: "/workspace/no-op",
      runId: run!.id,
      summary: "已评估证据；该请求没有应沉淀为长期记忆的内容。",
      operations: [],
    });
    expect(result.operationCount).toBe(0);
    expect(store.getDreamRun(run!.id, "/workspace/no-op")?.status).toBe("completed");
    expect(store.getDreamCursor("/workspace/no-op")).toEqual({
      createdAt, sessionId: "session-no-op", messageId: "message-no-op",
    });
    expect(store.listNotes("/workspace/no-op", true)).toHaveLength(0);
    store.close();
  });

});
