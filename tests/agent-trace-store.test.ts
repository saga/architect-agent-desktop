import { mkdtempSync, rmSync } from "node:fs";
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
});
