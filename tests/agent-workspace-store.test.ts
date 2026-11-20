import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_WORKSPACE_PREFERENCES,
  nextScheduleRunAt,
  parseAgentExperts,
  parseAgentSchedules,
  parseAgentTasks,
  parseAgentWorkspacePreferences,
} from "../src/main/agent-workspace-store";

describe("Agent workspace persistence", () => {
  it("normalizes layout preferences and keeps the right pane closed by default", () => {
    expect(DEFAULT_AGENT_WORKSPACE_PREFERENCES.mode).toBe("sidepanel");
    expect(DEFAULT_AGENT_WORKSPACE_PREFERENCES.rightPanelVisible).toBe(false);
    expect(parseAgentWorkspacePreferences({
      mode: "pure", leftWidth: 999, rightWidth: 100, rightPanelVisible: true, rightPanelTab: "files",
    })).toEqual({
      mode: "pure", leftWidth: 520, rightWidth: 320, rightPanelVisible: true, rightPanelTab: "files",
    });
    expect(parseAgentWorkspacePreferences({ mode: "unknown", rightPanelTab: "unknown" }).mode).toBe("sidepanel");
  });

  it("accepts valid Tasks and drops malformed records", () => {
    const tasks = parseAgentTasks([
      { id: "task-1", sessionId: "session-1", title: "Review", workspacePath: "/workspace", expertId: null, createdAt: 1, updatedAt: 2 },
      { id: "broken", title: "Missing session ID" },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sessionId).toBe("session-1");
  });

  it("validates Expert role definitions", () => {
    const experts = parseAgentExperts([
      { id: "research", name: "Research", description: "Research work", systemPrompt: "Use evidence.", toolPermission: "assisted", skills: ["plugin:research.md"], tools: ["browser_snapshot"], createdAt: 1, updatedAt: 2 },
      { id: "bad", name: "", description: "", systemPrompt: "", toolPermission: "unrestricted", skills: [], tools: [], createdAt: 1, updatedAt: 2 },
    ]);
    expect(experts).toHaveLength(1);
    expect(experts[0].toolPermission).toBe("assisted");
  });

  it("validates persistent Schedules and drops invalid dates", () => {
    const schedules = parseAgentSchedules([
      { id: "schedule-1", title: "Daily", prompt: "Summarize changes", workspacePath: null, expertId: null, runAt: "2026-11-21T09:00:00.000Z", repeat: "daily", enabled: true, createdAt: 1, updatedAt: 2 },
      { id: "bad", title: "Broken", prompt: "", workspacePath: null, expertId: null, runAt: "tomorrow", repeat: "sometimes", enabled: true, createdAt: 1, updatedAt: 2 },
    ]);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].repeat).toBe("daily");
  });

  it("advances recurring schedules beyond the current time and disables one-off schedules", () => {
    const now = Date.parse("2026-11-22T10:00:00.000Z");
    expect(nextScheduleRunAt("2026-11-20T09:00:00.000Z", "daily", now)).toBe("2026-11-23T09:00:00.000Z");
    expect(nextScheduleRunAt("2026-11-20T09:00:00.000Z", "weekly", now)).toBe("2026-11-27T09:00:00.000Z");
    expect(nextScheduleRunAt("2026-11-20T09:00:00.000Z", "none", now)).toBeNull();
  });
});
