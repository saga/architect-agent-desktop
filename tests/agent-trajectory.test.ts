import { describe, expect, it } from "vitest";
import { projectAgentTrajectory } from "../src/renderer/trajectory-projector";
import type { AgentTraceEventLike } from "../src/renderer/context-explorer/agent-trace-adapter";

function event(input: Partial<AgentTraceEventLike> & Pick<AgentTraceEventLike, "id" | "type" | "timestamp">): AgentTraceEventLike {
  return {
    id: input.id,
    type: input.type,
    timestamp: input.timestamp,
    sessionId: input.sessionId ?? "session-1",
    traceId: input.traceId ?? "trace-1",
    sequence: input.sequence ?? 0,
    status: input.status,
    provider: input.provider ?? "copilot",
    model: input.model ?? "gpt-test",
    payloadComplete: input.payloadComplete,
    data: input.data,
  };
}

describe("Agent Trajectory projection", () => {
  it("groups model request/response and tool call/result into one turn ledger", () => {
    const rows = [
      event({ id: "start", type: "turn.started", timestamp: "2026-11-21T01:00:00.000Z", sequence: 1, data: { prompt: "Inspect this project" } }),
      event({ id: "request", type: "provider.request", timestamp: "2026-11-21T01:00:01.000Z", sequence: 2, status: "started", payloadComplete: false, data: { requestId: "request-1", prompt: "Inspect this project" } }),
      event({ id: "call", type: "tool.call", timestamp: "2026-11-21T01:00:02.000Z", sequence: 3, status: "running", data: { name: "workspace_list_files", toolCallId: "call-1", input: {} } }),
      event({ id: "tool-result", type: "tool.result", timestamp: "2026-11-21T01:00:03.500Z", sequence: 4, status: "completed", data: { name: "workspace_list_files", toolCallId: "call-1", result: "README.md" } }),
      event({ id: "response", type: "provider.response", timestamp: "2026-11-21T01:00:05.000Z", sequence: 5, status: "completed", data: { requestId: "request-1", text: "Found README.md" } }),
      event({ id: "finish", type: "turn.completed", timestamp: "2026-11-21T01:00:05.200Z", sequence: 6, status: "completed" }),
    ];
    const [turn] = projectAgentTrajectory(rows);
    expect(turn?.status).toBe("completed");
    expect(turn?.durationMs).toBe(5200);
    expect(turn?.rows.map(row => row.kind)).toEqual(["user", "model", "tool"]);
    expect(turn?.rows[1]?.durationMs).toBe(4000);
    expect(turn?.rows[1]?.payloadComplete).toBe(false);
    expect(turn?.rows[2]?.durationMs).toBe(1500);
    expect(turn?.rows[2]?.status).toBe("completed");
    expect(turn?.rows[2]?.output).toBe("README.md");
  });

  it("does not invent durations for still-running model and tool operations", () => {
    const rows = [
      event({ id: "request", type: "provider.request", timestamp: "2026-11-21T01:00:00.000Z", sequence: 1, status: "started", data: { requestId: "request-2", prompt: "Wait" } }),
      event({ id: "call", type: "tool.call", timestamp: "2026-11-21T01:00:02.000Z", sequence: 2, status: "running", data: { name: "browser_snapshot", toolCallId: "call-2" } }),
    ];
    const [turn] = projectAgentTrajectory(rows);
    expect(turn?.status).toBe("running");
    expect(turn?.rows.every(row => row.durationMs === undefined)).toBe(true);
    expect(turn?.rows.every(row => row.status === "running")).toBe(true);
  });

  it("keeps unmatched tool results visible instead of dropping them", () => {
    const [turn] = projectAgentTrajectory([
      event({ id: "result", type: "tool.failed", timestamp: "2026-11-21T01:00:02.000Z", sequence: 1, status: "failed", data: { name: "browser_click", error: "Element missing" } }),
    ]);
    expect(turn?.rows).toHaveLength(1);
    expect(turn?.rows[0]?.summary).toContain("没有匹配");
    expect(turn?.rows[0]?.status).toBe("failed");
  });
});
