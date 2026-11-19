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
