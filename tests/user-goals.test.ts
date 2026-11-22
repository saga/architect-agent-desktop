import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryStore } from "../src/main/memory/agent-memory-store";

const directories: string[] = [];
function createStore(): AgentMemoryStore {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-goals-"));
  directories.push(directory);
  return new AgentMemoryStore(path.join(directory, "agent-memory.sqlite"));
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("AgentMemoryStore Goals", () => {
  it("isolates project and task goals by Workspace and Task", () => {
    const store = createStore();
    const project = store.upsertGoal({
      scope: "/workspace/a", taskId: null, level: "project",
      objective: "Build the department data architecture", expectedOutcome: "An approved target architecture",
      constraints: ["Do not specialize the platform for one business unit"],
      acceptanceCriteria: ["Covers multiple business domains"], evidence: ["目标是建立部门级数据架构"],
    });
    const task = store.upsertGoal({
      scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "Assess the current ingestion design", evidence: ["评估当前数据接入设计"],
    });

    expect(store.listGoals("/workspace/a", "task-a").map(goal => goal.id)).toEqual([task.id, project.id]);
    expect(store.listGoals("/workspace/a", "task-b").map(goal => goal.id)).toEqual([project.id]);
    expect(store.listGoals("/workspace/b", "task-a")).toHaveLength(0);
    store.close();
  });

  it("updates the same Goal using optimistic version checks", () => {
    const store = createStore();
    const initial = store.upsertGoal({
      scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "Implement the agreed workflow", evidence: ["实现已经确定的工作流"],
    });
    const updated = store.upsertGoal({
      id: initial.id, baseVersion: initial.version, scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "Implement the agreed workflow without changing the existing runtime",
      constraints: ["Keep the existing runtime"], evidence: ["不要改变现有 Runtime"],
    });
    expect(updated.id).toBe(initial.id);
    expect(updated.version).toBe(initial.version + 1);
    expect(updated.constraints).toContain("Keep the existing runtime");
    expect(updated.evidence).toContain("实现已经确定的工作流");
    expect(updated.evidence).toContain("不要改变现有 Runtime");
    expect(() => store.upsertGoal({
      id: initial.id, scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "Update without concurrency token", evidence: ["不要改变现有 Runtime"],
    })).toThrow(/必须提供 baseVersion/);
    expect(() => store.upsertGoal({
      id: initial.id, baseVersion: initial.version, scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "A stale update", evidence: ["不要改变现有 Runtime"],
    })).toThrow(/版本已变化/);
    store.close();
  });

  it("rejects unscoped project Goals and requires explicit cancellation evidence", () => {
    const store = createStore();
    expect(() => store.upsertGoal({
      scope: null, taskId: null, level: "project",
      objective: "A project goal", evidence: ["建立项目目标"],
    })).toThrow(/没有选择 Workspace/);
    const goal = store.upsertGoal({
      scope: "/workspace/a", taskId: "task-a", level: "task",
      objective: "Complete a migration", evidence: ["完成当前迁移"],
    });
    expect(() => store.setGoalStatus("/workspace/a", "task-a", goal.id, "cancelled", [])).toThrow(/取消 Goal/);
    const cancelled = store.setGoalStatus("/workspace/a", "task-a", goal.id, "cancelled", ["取消当前迁移"]);
    expect(cancelled.status).toBe("cancelled");
    store.close();
  });
});
