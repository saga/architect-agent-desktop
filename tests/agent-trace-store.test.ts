import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTraceStore } from "../src/main/agent-trace-store";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-trace-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("AgentTraceStore", () => {
  it("preserves shared object references while still redacting true cycles", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    const shared = { label: "shared-safe-value" };
    const cyclic: Record<string, unknown> = { label: "cycle" };
    cyclic.self = cyclic;
    store.record({ sessionId: "session-shared", traceId: "trace-shared", workspacePath: null, type: "test", data: { first: shared, second: shared, cyclic } });
    const data = store.query({ traceId: "trace-shared" })[0]?.data as Record<string, any>;
    expect(data.first).toEqual({ label: "shared-safe-value" });
    expect(data.second).toEqual({ label: "shared-safe-value" });
    expect(data.cyclic.self).toBe("[Circular]");
    store.close();
  });

  it("keeps the old store open when switching to an unavailable directory", () => {
    const root = temporaryDirectory();
    const blockedPath = path.join(root, "not-a-directory");
    writeFileSync(blockedPath, "file");
    const store = new AgentTraceStore(root);
    expect(() => store.setDirectory(blockedPath)).toThrow();
    expect(store.getDirectory()).toBe(path.resolve(root));
    store.record({ sessionId: "session-after-failure", traceId: "trace-after-failure", workspacePath: null, type: "still-open" });
    expect(store.query({ traceId: "trace-after-failure" })).toHaveLength(1);
    store.close();
  });

  it("supports in-memory fallback storage", () => {
    const store = new AgentTraceStore(":memory:");
    store.record({ sessionId: "memory-session", traceId: "memory-trace", workspacePath: null, type: "memory.test" });
    expect(store.query({ traceId: "memory-trace" })).toHaveLength(1);
    expect(store.getDirectory()).toBe(":memory:");
    store.close();
  });

  it("persists session and trace events with ordered sequence numbers", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.record({ sessionId: "session-a", traceId: "trace-a", workspacePath: "/workspace/a", type: "turn.started", status: "running", data: { prompt: "hello" } });
    store.record({ sessionId: "session-a", traceId: "trace-a", workspacePath: "/workspace/a", type: "turn.completed", status: "completed", data: { answer: "world" } });

    const events = store.query({ traceId: "trace-a" });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sequence)).toEqual([2, 1]);
    expect(store.listSessions()).toHaveLength(1);
    store.close();
  });

  it("redacts credentials before writing event payloads", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.record({
      sessionId: "session-b", traceId: "trace-b", workspacePath: null, type: "tool.call",
      data: { api_key: "do-not-store", authorization: "Bearer abc123", query: "safe" },
    });
    const event = store.query({ traceId: "trace-b" })[0];
    expect(event?.data).toEqual({ api_key: "[REDACTED]", authorization: "[REDACTED]", query: "safe" });
    store.close();
  });

  it("redacts credentials embedded in free-form text and URLs", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.record({
      sessionId: "session-redaction", traceId: "trace-redaction", workspacePath: null, type: "provider.request",
      data: {
        prompt: "Call https://alice:super-secret@example.com with Authorization: Bearer header-token",
        query: 'api_key="inline-secret" access_token=access-secret',
        output: "github_pat_abcdefghijklmnopqrstuvwxyz0123456789",
        privateKey: `-----BEGIN PRIVATE KEY-----
private-material
-----END PRIVATE KEY-----`,
      },
    });
    const event = store.query({ traceId: "trace-redaction" })[0]?.data as Record<string, unknown>;
    expect(event.prompt).not.toContain("super-secret");
    expect(event.prompt).not.toContain("header-token");
    expect(event.query).not.toContain("inline-secret");
    expect(event.query).not.toContain("access-secret");
    expect(event.output).not.toContain("github_pat_");
    expect(event.privateKey).toBe("[REDACTED PRIVATE KEY]");
    store.close();
  });

  it("persists the complete session transcript independently of the 200-item legacy window", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    const items = Array.from({ length: 250 }, (_, index) => ({
      id: "message-" + index,
      kind: index % 2 === 0 ? "user" : "assistant",
      content: "message body " + index,
      createdAt: 1_700_000_000_000 + index,
    }));
    store.saveSessionItems("session-long", "/workspace/long", items);
    const restored = store.listSessionItems("session-long");
    expect(restored).toHaveLength(250);
    expect(restored[0]?.id).toBe("message-0");
    expect(restored[249]?.id).toBe("message-249");
    expect(store.listSessions()[0]).toMatchObject({ id: "session-long", messageCount: 250, eventCount: 0 });

    store.clearSessionItems("session-long");
    expect(store.listSessionItems("session-long")).toHaveLength(0);
    store.close();
  });

  it("returns session previews and latest activity metadata for Session Explorer", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.saveSessionItems("session-preview", "/workspace/project", [
      { id: "user-1", kind: "user", content: "Review the latest portfolio exposure", createdAt: 100 },
      { id: "assistant-1", kind: "assistant", content: "The main concentration is in technology.", createdAt: 200 },
    ]);
    store.record({
      sessionId: "session-preview",
      traceId: "run-preview",
      workspacePath: "/workspace/project",
      type: "turn.completed",
      status: "completed",
      timestamp: "2026-11-21T09:00:00.000Z",
      data: { outcome: "completed" },
    });

    expect(store.listSessions()[0]).toMatchObject({
      id: "session-preview",
      messageCount: 2,
      eventCount: 1,
      lastMessagePreview: "The main concentration is in technology.",
      lastMessageKind: "assistant",
      lastEventType: "turn.completed",
    });
    store.close();
  });

  it("searches transcript history within the selected Workspace", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.saveSessionItems("session-search-a", "/workspace/project-a", [
      { id: "message-a1", kind: "user", content: "分析投资组合行业敞口和集中度", createdAt: 100 },
      { id: "message-a2", kind: "assistant", content: "科技行业占组合市值的 35%。", createdAt: 200 },
    ]);
    store.saveSessionItems("session-search-b", "/workspace/project-b", [
      { id: "message-b1", kind: "user", content: "分析投资组合行业敞口", createdAt: 300 },
    ]);

    const matches = store.searchSessionMessages("/workspace/project-a", "投资组合", 10);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((item) => item.sessionId === "session-search-a")).toBe(true);
    expect(store.searchSessionMessages("/workspace/project-b", "投资组合", 10).every((item) => item.sessionId === "session-search-b")).toBe(true);
    store.close();
  });

  it("uses the legacy composite cursor when migrating an existing Transcript to revisions", () => {
    const directory = temporaryDirectory();
    const store = new AgentTraceStore(directory);
    store.saveSessionItems("session-legacy", "/workspace/legacy", [
      { id: "old-message", kind: "user", content: "Already processed legacy message.", createdAt: 100 },
      { id: "new-message", kind: "assistant", content: "Newer legacy message after the old cursor.", createdAt: 300 },
    ]);
    store.close();

    const database = new DatabaseSync(path.join(directory, "agent-traces.sqlite"));
    try {
      database.prepare("DELETE FROM session_message_revisions WHERE session_id=?").run("session-legacy");
    } finally {
      database.close();
    }

    const migrated = new AgentTraceStore(directory);
    const evidence = migrated.listMemorySources("/workspace/legacy", {
      createdAt: 200,
      sessionId: "session-legacy",
      messageId: "old-message",
      transcriptRevision: 0,
    }, 10);
    expect(evidence.map(item => item.messageId)).toEqual(["new-message"]);
    expect(evidence[0]?.changeType).toBe("baseline");
    migrated.close();
  });

  it("re-surfaces an old Transcript message when its content is revised", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.saveSessionItems("session-revision", "/workspace/revision", [
      { id: "old-message", kind: "user", content: "Old project assumption.", createdAt: 100 },
      { id: "later-message", kind: "assistant", content: "Initial answer.", createdAt: 200 },
    ]);
    const initial = store.listMemorySources("/workspace/revision", {
      createdAt: 0, sessionId: "", messageId: "", transcriptRevision: 0,
    }, 20);
    const initialCursor = Math.max(...initial.map(item => item.revision));
    expect(initial.map(item => item.messageId)).toEqual(["old-message", "later-message"]);

    store.saveSessionItems("session-revision", "/workspace/revision", [
      { id: "old-message", kind: "user", content: "Corrected project assumption with the approved rule.", createdAt: 100 },
      { id: "later-message", kind: "assistant", content: "Initial answer.", createdAt: 200 },
    ]);
    const revised = store.listMemorySources("/workspace/revision", {
      createdAt: 200, sessionId: "session-revision", messageId: "later-message", transcriptRevision: initialCursor,
    }, 20);
    expect(revised).toHaveLength(1);
    expect(revised[0]).toMatchObject({
      messageId: "old-message",
      createdAt: 100,
      changeType: "updated",
    });
    expect(revised[0]!.content).toContain("Corrected project assumption");
    expect(revised[0]!.revision).toBeGreaterThan(initialCursor);
    store.close();
  });

  it("switches the active data directory without deleting the previous store", () => {
    const first = temporaryDirectory();
    const second = temporaryDirectory();
    const store = new AgentTraceStore(first);
    store.record({ sessionId: "session-c", traceId: "trace-c", workspacePath: null, type: "session.started" });
    store.setDirectory(second);
    expect(store.getDirectory()).toBe(path.resolve(second));
    expect(store.query()).toHaveLength(0);
    store.close();

    const previous = new AgentTraceStore(first);
    expect(previous.query({ traceId: "trace-c" })).toHaveLength(1);
    previous.close();
  });
  it("returns ordered, non-empty interaction transcript evidence in stable batches", () => {
    const store = new AgentTraceStore(temporaryDirectory());
    store.saveSessionItems("session-evidence", "/workspace/evidence", [
      { id: "a-message", kind: "user", content: "请查看图表中的高集中度发行人。", createdAt: 1000 },
      { id: "b-interaction", kind: "interaction", content: "{\"action\":\"select\",\"issuer\":\"ACME\"}", createdAt: 1000 },
      { id: "c-message", kind: "assistant", content: "该发行人权重为 18%。", createdAt: 1000 },
      { id: "empty-d", kind: "assistant", content: "   ", createdAt: 1001 },
      { id: "surface-e", kind: "a2ui-v1", content: "[{\"version\":\"1.0\"}]", createdAt: 1002 },
    ]);

    const cursor = { createdAt: 0, sessionId: "", messageId: "", transcriptRevision: 0 };
    const first = store.listMemorySources("/workspace/evidence", cursor, 1);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ messageId: "a-message", kind: "user", changeType: "created" });

    const second = store.listMemorySources("/workspace/evidence", {
      ...cursor, transcriptRevision: first[0]!.revision,
    }, 1);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ messageId: "b-interaction", kind: "interaction" });

    const remaining = store.listMemorySources("/workspace/evidence", {
      ...cursor, transcriptRevision: second[0]!.revision,
    }, 10);
    expect(remaining.map(item => item.messageId)).toEqual(["c-message"]);
    expect(remaining.some(item => item.messageId === "empty-d" || item.messageId === "surface-e")).toBe(false);
    store.close();
  });

});
