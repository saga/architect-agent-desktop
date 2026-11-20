import { z } from "zod";
import type {
  AgentExpert, AgentSchedule, AgentTask, AgentWorkspacePreferences,
  AgentWorkspaceRightTab, AgentWorkspaceMode, AgentScheduleRepeat,
} from "../shared/types";

export const DEFAULT_AGENT_WORKSPACE_PREFERENCES: AgentWorkspacePreferences = {
  mode: "sidepanel",
  leftWidth: 280,
  rightWidth: 560,
  rightPanelVisible: false,
  rightPanelTab: "browser",
};

const taskSchema = z.object({
  id: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  workspacePath: z.string().max(4096).nullable(),
  expertId: z.string().max(100).nullable(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  lastRunAt: z.number().finite().optional(),
}).strict();

const expertSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  systemPrompt: z.string().max(12000),
  toolPermission: z.enum(["browser-only", "assisted", "allow-all"]),
  skills: z.array(z.string().min(1).max(200)).max(100),
  tools: z.array(z.string().min(1).max(100)).max(100),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
}).strict();

const scheduleSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(30000),
  workspacePath: z.string().max(4096).nullable(),
  expertId: z.string().max(100).nullable(),
  runAt: z.string().datetime({ offset: true }),
  repeat: z.enum(["none", "daily", "weekly"]),
  enabled: z.boolean(),
  lastRunAt: z.number().finite().optional(),
  lastRunStatus: z.enum(["success", "error"]).optional(),
  lastError: z.string().max(2000).optional(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
}).strict();

export function parseAgentTasks(value: unknown): AgentTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = taskSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function parseAgentExperts(value: unknown): AgentExpert[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = expertSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseAgentSchedules(value: unknown): AgentSchedule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = scheduleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

export function parseAgentWorkspacePreferences(value: unknown): AgentWorkspacePreferences {
  const input = value && typeof value === "object" ? value as Partial<AgentWorkspacePreferences> : {};
  const mode: AgentWorkspaceMode = input.mode === "pure" ? "pure" : "sidepanel";
  const rightPanelTab: AgentWorkspaceRightTab =
    input.rightPanelTab === "files" || input.rightPanelTab === "results" ? input.rightPanelTab : "browser";
  return {
    mode,
    leftWidth: typeof input.leftWidth === "number" && Number.isFinite(input.leftWidth)
      ? Math.round(Math.max(220, Math.min(520, input.leftWidth))) : DEFAULT_AGENT_WORKSPACE_PREFERENCES.leftWidth,
    rightWidth: typeof input.rightWidth === "number" && Number.isFinite(input.rightWidth)
      ? Math.round(Math.max(320, Math.min(900, input.rightWidth))) : DEFAULT_AGENT_WORKSPACE_PREFERENCES.rightWidth,
    rightPanelVisible: typeof input.rightPanelVisible === "boolean" ? input.rightPanelVisible : false,
    rightPanelTab,
  };
}

/** Advance a recurring local schedule without replaying every missed interval. */
export function nextScheduleRunAt(runAt: string, repeat: AgentScheduleRepeat, now = Date.now()): string | null {
  if (repeat === "none") return null;
  const next = new Date(runAt);
  if (!Number.isFinite(next.getTime())) return null;
  while (next.getTime() <= now) next.setDate(next.getDate() + (repeat === "daily" ? 1 : 7));
  return next.toISOString();
}
