import { afterEach, describe, expect, it } from "vitest";
import { ProactiveStore } from "../src/main/proactive/proactive-store";
import { ProactiveOpportunityEngine, detectFollowUpCandidate } from "../src/main/proactive/proactive-engine";

const stores: ProactiveStore[] = [];
function setup() {
  const store = new ProactiveStore(":memory:");
  stores.push(store);
  return { store, engine: new ProactiveOpportunityEngine(store) };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

describe("Proactive Opportunity Engine", () => {
  it("deduplicates repeated delivery of the same Trace event", () => {
    const { engine } = setup();
    const event = {
      eventId: "turn-1", type: "agent.turn.completed" as const, occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-1",
      payload: { prompt: "I'll review the supplier contract tomorrow." },
    };
    expect(engine.ingest(event)).not.toBeNull();
    expect(engine.ingest(event)).toBeNull();
    expect(engine.listActive("/workspace/a")).toHaveLength(1);
  });

  it("requires a promise and a parseable date before suggesting a follow-up", () => {
    const now = new Date(2026, 10, 22, 10, 0, 0, 0).getTime();
    const candidate = detectFollowUpCandidate("I'll review the contract tomorrow at 14:30.", now);
    expect(candidate).not.toBeNull();
    expect(new Date(candidate!.dueAt).getHours()).toBe(14);
    expect(new Date(candidate!.dueAt).getMinutes()).toBe(30);
    expect(detectFollowUpCandidate("The contract meeting is tomorrow.", now)).toBeNull();
    expect(detectFollowUpCandidate("I'll get back to you soon.", now)).toBeNull();
  });

  it("parses Chinese next-week weekday and English next-week Friday", () => {
    const sunday = new Date(2026, 10, 22, 10, 0, 0, 0).getTime();
    const chinese = detectFollowUpCandidate("我计划下周五跟进供应商合同。", sunday);
    expect(chinese).not.toBeNull();
    expect(new Date(chinese!.dueAt).getDate()).toBe(27);
    expect(new Date(chinese!.dueAt).getDay()).toBe(5);

    const monday = new Date(2026, 10, 23, 10, 0, 0, 0).getTime();
    const english = detectFollowUpCandidate("I will follow up next week Friday.", monday);
    expect(english).not.toBeNull();
    expect(new Date(english!.dueAt).getDate()).toBe(4);
    expect(new Date(english!.dueAt).getMonth()).toBe(11);
  });

  it("parses explicit relative day and week offsets", () => {
    const now = new Date(2026, 10, 22, 10, 0, 0, 0).getTime();
    const inThreeDays = detectFollowUpCandidate("I'll finish the review in 3 days.", now);
    expect(inThreeDays).not.toBeNull();
    expect(new Date(inThreeDays!.dueAt).getDate()).toBe(25);
    const inTwoWeeks = detectFollowUpCandidate("Remind me in 2 weeks to review the contract.", now);
    expect(inTwoWeeks).not.toBeNull();
    expect(new Date(inTwoWeeks!.dueAt).getDate()).toBe(6);
    expect(new Date(inTwoWeeks!.dueAt).getMonth()).toBe(11);
    const chinese = detectFollowUpCandidate("我计划三天后完成审查。", now);
    expect(chinese).not.toBeNull();
    expect(new Date(chinese!.dueAt).getDate()).toBe(25);
  });

  it("does not leak opportunities between Workspaces", () => {
    const { engine } = setup();
    engine.ingest({
      eventId: "turn-a", type: "agent.turn.completed", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-a",
      payload: { prompt: "我计划明天跟进供应商合同。" },
    });
    expect(engine.listActive("/workspace/b")).toHaveLength(0);
    expect(engine.listActive("/workspace/a")).toHaveLength(1);
  });

  it("creates a reviewable candidate for a directly expressed preference", () => {
    const { engine, store } = setup();
    engine.ingest({
      eventId: "preference-1", type: "memory.preference.candidate", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sessionId: "session-a", sourceRef: "trace-a",
      payload: {
        category: "communication", strength: "explicit",
        statement: "以后请用简洁的中文回复。", scopeSuggestion: "workspace",
      },
    });
    expect(store.listCandidates("/workspace/a")).toHaveLength(1);
    expect(engine.listActive("/workspace/a")[0]?.category).toBe("preference_confirmation");
  });

  it("waits for the third same-tool failure in a 30-minute window", () => {
    const { engine } = setup();
    const now = Date.now();
    for (let index = 0; index < 2; index += 1) {
      engine.ingest({
        eventId: "failure-" + index, type: "agent.tool.failed", occurredAt: now + index,
        scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-" + index,
        payload: { toolName: "browser_snapshot" },
      });
    }
    expect(engine.listActive("/workspace/a")).toHaveLength(0);
    engine.ingest({
      eventId: "failure-2", type: "agent.tool.failed", occurredAt: now + 2,
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-2",
      payload: { toolName: "browser_snapshot" },
    });
    expect(engine.listActive("/workspace/a")[0]?.category).toBe("repeated_tool_failure");
  });

  it("keeps a future follow-up hidden until the user confirms it and it becomes due", () => {
    const { engine, store } = setup();
    engine.ingest({
      eventId: "follow-up", type: "agent.turn.completed", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-a",
      payload: { prompt: "I'll follow up next week." },
    });
    const opportunity = engine.listActive("/workspace/a")[0]!;
    expect(opportunity.category).toBe("follow_up_confirmation");
    engine.feedback({ id: opportunity.id, scope: "/workspace/a", action: "accept" });
    expect(engine.listActive("/workspace/a")).toHaveLength(0);
    store.refreshLifecycle("/workspace/a", opportunity.dueAt! + 1);
    const due = store.listActive("/workspace/a").find(item => item.category === "follow_up_due");
    expect(due).toBeDefined();
    expect(due?.title).toContain("follow up");
  });

  it("suppresses an irrelevant opportunity for the configured cooldown", () => {
    const { engine, store } = setup();
    engine.ingest({
      eventId: "follow-up-a", type: "agent.turn.completed", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-a",
      payload: { prompt: "I'll follow up next week." },
    });
    const opportunity = engine.listActive("/workspace/a")[0]!;
    engine.feedback({ id: opportunity.id, scope: "/workspace/a", action: "irrelevant" });
    engine.ingest({
      eventId: "follow-up-b", type: "agent.turn.completed", occurredAt: Date.now() + 1,
      scope: "/workspace/a", taskId: "task-a", sourceRef: "trace-b",
      payload: { prompt: "I'll follow up next week." },
    });
    expect(engine.listActive("/workspace/a")).toHaveLength(0);
    expect(store.getOpportunity(opportunity.id, "/workspace/a")?.status).toBe("dismissed");
  });

  it("keeps preference candidates reviewable and closes their linked card", () => {
    const { engine, store } = setup();
    engine.ingest({
      eventId: "reviewed-preference", type: "memory.preference.candidate", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sessionId: "session-a", sourceRef: "trace-a",
      payload: { category: "communication", strength: "explicit", statement: "以后请用简洁中文回复。", scopeSuggestion: "workspace" },
    });
    const candidate = store.listCandidates("/workspace/a")[0]!;
    expect(engine.listActive("/workspace/a")).toHaveLength(1);
    store.updateCandidate(candidate.id, "/workspace/a", "accepted", "note-1");
    store.resolveCandidateOpportunity(candidate.id, "/workspace/a", "accepted");
    expect(engine.listActive("/workspace/a")).toHaveLength(0);
  });

  it("keeps preference learning active when proactive suggestions are globally disabled", () => {
    const { engine, store } = setup();
    store.saveSettings({ enabled: false });
    engine.ingest({
      eventId: "preference-while-muted", type: "memory.preference.candidate", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sessionId: "session-a",
      payload: { category: "communication", strength: "explicit", statement: "以后请简洁地回复。", scopeSuggestion: "workspace" },
    });
    expect(store.listCandidates("/workspace/a")).toHaveLength(1);
    expect(engine.listActive("/workspace/a")).toHaveLength(0);
  });

  it("retains pending candidates when one suggestion category is disabled", () => {
    const { engine, store } = setup();
    store.saveSettings({ categories: { preference_confirmation: false } });
    const result = engine.ingest({
      eventId: "preference-disabled", type: "memory.preference.candidate", occurredAt: Date.now(),
      scope: "/workspace/a", taskId: "task-a", sessionId: "session-a",
      payload: { category: "communication", strength: "explicit", statement: "Prefer concise answers.", scopeSuggestion: "workspace" },
    });
    expect(result).toBeNull();
    expect(store.listCandidates("/workspace/a")).toHaveLength(1);
  });
});
