import { z } from "zod";
import type {
  AgentExpert, AgentSchedule, AgentTask, AgentWorkspacePreferences,
  AgentWorkspaceRightTab, AgentWorkspaceMode, AgentScheduleRepeat, AgentScheduleRun,
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
  repeat: z.enum(["none", "interval", "daily", "weekly", "biweekly", "monthly", "yearly"]),
  intervalMinutes: z.number().int().min(1).max(525600).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  monthDays: z.array(z.number().int().min(1).max(31)).max(31).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  enabled: z.boolean(),
  lastRunAt: z.number().finite().optional(),
  lastRunStatus: z.enum(["success", "error"]).optional(),
  lastRunId: z.string().min(1).max(100).optional(),
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

const scheduleRunSchema = z.object({
  id: z.string().min(1).max(100),
  scheduleId: z.string().min(1).max(100),
  scheduleTitle: z.string().min(1).max(120),
  trigger: z.enum(["scheduled", "manual"]),
  scheduledAt: z.string().datetime({ offset: true }),
  taskId: z.string().min(1).max(100).nullable(),
  previousTaskId: z.string().min(1).max(100).optional(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().optional(),
  durationMs: z.number().finite().min(0).optional(),
  status: z.enum(["running", "success", "error"]),
  resultPreview: z.string().max(1200).optional(),
  error: z.string().max(2000).optional(),
}).strict();

export function parseAgentSchedules(value: unknown): AgentSchedule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = scheduleSchema.safeParse(item);
    if (!parsed.success) return [];
    const schedule = parsed.data;
    return [{
      ...schedule,
      weekdays: schedule.weekdays ? [...new Set(schedule.weekdays)].sort((a, b) => a - b) : undefined,
      monthDays: schedule.monthDays ? [...new Set(schedule.monthDays)].sort((a, b) => a - b) : undefined,
    }];
  }).sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

export function parseAgentScheduleRuns(value: unknown): AgentScheduleRun[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = scheduleRunSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => b.startedAt - a.startedAt).slice(0, 500);
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

/** Compute the next local-calendar occurrence without replaying every missed run. */
export function nextScheduleRunAt(
  runAt: string,
  repeat: AgentScheduleRepeat,
  now = Date.now(),
  options: { intervalMinutes?: number; weekdays?: number[]; monthDays?: number[]; endsAt?: string | null } = {},
): string | null {
  if (repeat === "none") return null;
  const anchor = new Date(runAt);
  if (!Number.isFinite(anchor.getTime())) return null;
  let next: Date | null = null;

  if (repeat === "interval") {
    const interval = Math.max(1, Math.min(525600, Math.floor(options.intervalMinutes ?? 60))) * 60_000;
    const steps = Math.max(1, Math.floor((now - anchor.getTime()) / interval) + 1);
    next = new Date(anchor.getTime() + steps * interval);
  } else if (repeat === "daily") {
    next = new Date(anchor);
    while (next.getTime() <= now) next.setDate(next.getDate() + 1);
  } else if (repeat === "weekly" || repeat === "biweekly") {
    const weekdays = [...new Set(options.weekdays?.length ? options.weekdays : [anchor.getDay()])]
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => a - b);
    const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
    const anchorDay = dayNumber(anchor);
    for (let offset = 0; offset <= 366 * 8; offset += 1) {
      const candidate = new Date(anchor);
      candidate.setDate(anchor.getDate() + offset);
      if (candidate.getTime() <= anchor.getTime() || candidate.getTime() <= now) continue;
      const weekIndex = Math.floor((dayNumber(candidate) - anchorDay) / 7);
      if (weekdays.includes(candidate.getDay()) && (repeat === "weekly" || weekIndex % 2 === 0)) {
        next = candidate;
        break;
      }
    }
  } else if (repeat === "monthly") {
    const monthDays = [...new Set(options.monthDays?.length ? options.monthDays : [anchor.getDate()])]
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 31).sort((a, b) => a - b);
    for (let monthOffset = 0; monthOffset <= 240 && !next; monthOffset += 1) {
      const year = anchor.getFullYear();
      const month = anchor.getMonth() + monthOffset;
      for (const day of monthDays) {
        const candidate = new Date(year, month, day, anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
        if (candidate.getFullYear() !== new Date(year, month, 1).getFullYear()
          || candidate.getMonth() !== new Date(year, month, 1).getMonth()
          || candidate.getDate() !== day) continue;
        if (candidate.getTime() > anchor.getTime() && candidate.getTime() > now) {
          next = candidate;
          break;
        }
      }
    }
  } else if (repeat === "yearly") {
    for (let yearOffset = 0; yearOffset <= 100 && !next; yearOffset += 1) {
      const year = anchor.getFullYear() + yearOffset;
      const candidate = new Date(year, anchor.getMonth(), anchor.getDate(), anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
      if (candidate.getFullYear() !== year || candidate.getMonth() !== anchor.getMonth() || candidate.getDate() !== anchor.getDate()) continue;
      if (candidate.getTime() > anchor.getTime() && candidate.getTime() > now) next = candidate;
    }
  }

  if (!next || !Number.isFinite(next.getTime())) return null;
  if (options.endsAt) {
    const end = new Date(options.endsAt);
    if (Number.isFinite(end.getTime()) && next.getTime() > end.getTime()) return null;
  }
  return next.toISOString();
}
