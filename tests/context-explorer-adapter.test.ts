import { describe, expect, it } from "vitest";
import { contextSessionsFromAgentEvents, type AgentTraceEventLike } from "../src/renderer/context-explorer/agent-trace-adapter";

function snapshot(response?: string) {
  return {
    id: "request-1",
    provider: "copilot",
    model: "gpt-test",
    createdAt: "2026-11-21T01:00:00.000Z",
    system: "Use the desktop tools.",
    messages: [
      { id: "system", index: 0, role: "system", parts: [{ kind: "text", text: "Use the desktop tools." }], raw: { role: "system" } },
      { id: "user", index: 1, role: "user", parts: [{ kind: "text", text: "Inspect this project" }], raw: { role: "user" } },
    ],
    tools: [{ name: "workspace_list_files", description: "List files", inputSchema: { type: "object" }, raw: { name: "workspace_list_files" } }],
    parameters: { toolPermission: "assisted" },
    rawRequest: { prompt: "Inspect this project" },
    ...(response ? { rawResponse: { content: response } } : {}),
    responseMessages: response ? [
      { id: "assistant", index: 0, role: "assistant", parts: [{ kind: "text", text: response }], raw: { role: "assistant", content: response } },
    ] : [],
    warnings: ["SDK boundary capture only."],
    provenance: { source: "test" },
  };
}

function event(id: string, type: string, timestamp: string, status: string, data: Record<string, unknown>): AgentTraceEventLike {
  return {
    id, type, timestamp, status, sessionId: "session-1", traceId: "turn-1",
    sequence: timestamp.endsWith("01.000Z") ? 1 : 2,
    provider: "copilot", model: "gpt-test", payloadComplete: false, data,
  };
}

describe("common-agent-lib Context Explorer adapter", () => {
  it("merges SDK request and response events into one incomplete, inspectable model run", () => {
    const session = contextSessionsFromAgentEvents([
      event("request-event", "provider.request", "2026-11-21T01:00:01.000Z", "started", {
        requestId: "request-1",
        snapshot: snapshot(),
        captureLevel: "sdk-call-input",
      }),
      event("response-event", "provider.response", "2026-11-21T01:00:03.000Z", "completed", {
        requestId: "request-1",
        snapshot: snapshot("Found README.md"),
        response: "Found README.md",
      }),
    ], { sessionId: "session-1" })[0];

    expect(session?.runs).toHaveLength(1);
    expect(session?.runs[0]?.status).toBe("completed");
    expect(session?.runs[0]?.startedAt).toBe("2026-11-21T01:00:01.000Z");
    expect(session?.runs[0]?.completedAt).toBe("2026-11-21T01:00:03.000Z");
    expect(session?.runs[0]?.payloadComplete).toBe(false);
    expect(session?.runs[0]?.snapshot.rawRequest).toEqual({ prompt: "Inspect this project" });
    expect(session?.runs[0]?.snapshot.rawResponse).toEqual({ content: "Found README.md" });
    expect(session?.runs[0]?.snapshot.responseMessages[0]?.parts[0]).toEqual({ kind: "text", text: "Found README.md" });
  });
});
