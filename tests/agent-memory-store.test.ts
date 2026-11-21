import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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

    expect(store.search("/workspace/dream", "组合收益比较")).toHaveLength(1);
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

  it("rejects a Dreaming knowledge-page update when its base version is stale", () => {
    const directory = temporaryDirectory();
    const store = new AgentMemoryStore(path.join(directory, "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/knowledge-conflict",
      title: "Portfolio calculation rule",
      content: "Use the approved valuation date.",
    });
    const initialPage = store.publishRepresentation({
      scope: "/workspace/knowledge-conflict",
      slug: "portfolio-method",
      title: "Portfolio method",
      content: "Version one.",
      sourceNoteIds: [note.id],
    });
    const run = store.prepareDreaming("/workspace/knowledge-conflict", [{
      sessionId: "session-knowledge",
      messageId: "message-knowledge",
      kind: "user",
      content: "Use the approved valuation date and reporting currency.",
      createdAt: Date.now(),
    }]);
    store.publishRepresentation({
      scope: "/workspace/knowledge-conflict",
      slug: "portfolio-method",
      title: "Portfolio method",
      content: "A newer manual revision.",
      sourceNoteIds: [note.id],
    });

    expect(() => store.commitDreaming({
      scope: "/workspace/knowledge-conflict",
      runId: run!.id,
      summary: "Attempt to update a knowledge page from a stale snapshot.",
      operations: [{
        op: "publish_knowledge",
        slug: "portfolio-method",
        title: "Portfolio method",
        content: "A stale Dreaming revision.",
        sourceNoteIds: [note.id],
        baseVersion: initialPage.version,
        sourceRefs: [run!.evidence[0]!.sourceId],
        reason: "This update must not overwrite a newer knowledge-page revision.",
      }],
    })).toThrow(/知识页版本已变化/);
    expect(store.getRepresentations("/workspace/knowledge-conflict")[0]?.content).toBe("A newer manual revision.");
    expect(store.getDreamCursor("/workspace/knowledge-conflict").createdAt).toBe(0);
    store.abandonDreaming("/workspace/knowledge-conflict", run!.id, "stale knowledge page");
    store.close();
  });

  it("stores before and after versions when expired notes are pruned", () => {
    const directory = temporaryDirectory();
    const databasePath = path.join(directory, "memory.sqlite");
    const store = new AgentMemoryStore(databasePath);
    const note = store.saveNote({
      scope: "/workspace/expiry",
      title: "Temporary project decision",
      content: "This decision is valid only for a short period.",
      expiresAt: 100,
    });

    expect(store.pruneExpired("/workspace/expiry", 101)).toEqual({ archived: 1 });
    const archived = store.listNotes("/workspace/expiry", true).find(item => item.id === note.id);
    expect(archived?.status).toBe("archived");
    expect(archived?.version).toBe(note.version + 1);
    store.close();

    const database = new DatabaseSync(databasePath);
    try {
      const rows = database.prepare(
        "SELECT version,snapshot_json FROM memory_versions WHERE entity_type='note' AND entity_id=? ORDER BY version"
      ).all(note.id) as Array<{ version: number; snapshot_json: string }>;
      expect(rows.map(row => row.version)).toContain(note.version + 1);
      const archivedSnapshot = rows.find(row => row.version === note.version + 1);
      expect(archivedSnapshot).toBeDefined();
      expect(JSON.parse(archivedSnapshot!.snapshot_json).status).toBe("archived");
    } finally {
      database.close();
    }
  });

  it("keeps priority notes ahead of large knowledge-page context", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const pinned = store.saveNote({
      scope: "/workspace/context-priority",
      title: "Critical workspace convention",
      content: "Always reconcile the reporting currency before comparing portfolio returns.",
      pinned: true,
      importance: 1,
    });
    for (let index = 0; index < 8; index++) {
      const note = store.saveNote({
        scope: "/workspace/context-priority",
        title: "Knowledge source " + index,
        content: "A reusable knowledge source.",
      });
      store.publishRepresentation({
        scope: "/workspace/context-priority",
        slug: "knowledge-" + index,
        title: "Large knowledge page " + index,
        content: "A long knowledge summary. ".repeat(400),
        sourceNoteIds: [note.id],
      });
    }

    const context = store.getInjectedContext("/workspace/context-priority", 1000);
    expect(context).toContain(pinned.title);
    expect(context.indexOf(pinned.title)).toBeLessThan(context.indexOf("Knowledge Page Index"));
    expect(context.length).toBeLessThanOrEqual(1000);
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

  it("scopes manual pin and archive operations to the selected Workspace", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/alpha",
      title: "Workspace Alpha convention",
      content: "Alpha-specific rule.",
    });
    expect(() => store.setPinned(note.id, true, "/workspace/beta")).toThrow(/当前 Workspace/);
    expect(() => store.archive(note.id, "/workspace/beta")).toThrow(/当前 Workspace/);
    expect(store.getNote(note.id, "/workspace/alpha")?.pinned).toBe(false);

    const pinned = store.setPinned(note.id, true, "/workspace/alpha");
    expect(pinned.pinned).toBe(true);
    expect(() => store.archive(note.id, "/workspace/alpha")).toThrow(/置顶/);
    store.setPinned(note.id, false, "/workspace/alpha");
    store.archive(note.id, "/workspace/alpha");
    expect(store.getNote(note.id, "/workspace/alpha")).toBeNull();
    expect(store.listNotes("/workspace/alpha", true).find(item => item.id === note.id)?.status).toBe("archived");
    store.close();
  });

  it("redacts common credentials from direct Memory and Knowledge writes", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const apiKey = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const note = store.saveNote({
      scope: "/workspace/redaction",
      title: "Credential " + apiKey,
      content: "Do not retain this token: " + apiKey,
    });
    expect(note.title).not.toContain(apiKey);
    expect(note.content).not.toContain(apiKey);
    expect(note.content).toContain("[REDACTED_SECRET]");

    const run = store.prepareDreaming("/workspace/redaction", [{
      sessionId: "session-redaction",
      messageId: "source-redaction",
      kind: "user",
      content: "Please review an ordinary workflow, with no secrets.",
      createdAt: Date.now(),
    }]);
    const page = store.publishRepresentation({
      scope: "/workspace/redaction",
      slug: "safe-knowledge",
      title: "Safe knowledge " + apiKey,
      content: "This page must not retain " + apiKey,
      sourceNoteIds: [note.id],
    });
    expect(page.title).not.toContain(apiKey);
    expect(page.content).not.toContain(apiKey);
    store.abandonDreaming("/workspace/redaction", run!.id, "test complete");
    store.close();
  });


  it("prevents rollback while a later evidence batch is prepared", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const firstTime = Date.now();
    const first = store.prepareDreaming("/workspace/pending-rollback", [{
      sessionId: "session-a",
      messageId: "message-1",
      kind: "user",
      content: "第一批已整理的证据。",
      createdAt: firstTime,
    }]);
    store.commitDreaming({
      scope: "/workspace/pending-rollback",
      runId: first!.id,
      summary: "提交第一批证据。",
      operations: [{
        op: "upsert_note",
        title: "第一批记忆",
        content: "第一批长期知识。",
        sourceRefs: [first!.evidence[0]!.sourceId],
        reason: "记录有来源的长期知识。",
      }],
    });

    const second = store.prepareDreaming("/workspace/pending-rollback", [{
      sessionId: "session-a",
      messageId: "message-2",
      kind: "assistant",
      content: "第二批尚未提交的证据。",
      createdAt: firstTime + 1,
    }]);
    expect(second?.status).toBe("prepared");
    expect(() => store.rollbackDreaming("/workspace/pending-rollback", first!.id, "不应跨越待提交批次回滚"))
      .toThrow(/存在待提交的 Dreaming Run/);
    store.abandonDreaming("/workspace/pending-rollback", second!.id, "先放弃下一批");
    expect(store.rollbackDreaming("/workspace/pending-rollback", first!.id, "放弃后可以安全回滚").rolledBackOperations)
      .toBeGreaterThan(0);
    expect(store.getDreamCursor("/workspace/pending-rollback").createdAt).toBe(0);
    store.close();
  });

});
