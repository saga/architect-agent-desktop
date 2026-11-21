import type { AgentTraceEventLike } from "./context-explorer/agent-trace-adapter.js";

export type TrajectoryRowKind = "user" | "context" | "model" | "tool" | "permission" | "compaction" | "system";
export type TrajectoryStatus = "running" | "completed" | "failed" | "waiting" | "info";

export interface TrajectoryUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface TrajectoryRow {
  id: string;
  sequence: number;
  kind: TrajectoryRowKind;
  title: string;
  summary: string;
  status: TrajectoryStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  usage?: TrajectoryUsage;
  payloadComplete?: boolean;
  input?: unknown;
  output?: unknown;
  events: AgentTraceEventLike[];
}

export interface TrajectoryTurn {
  id: string;
  traceId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: TrajectoryStatus;
  provider?: string;
  model?: string;
  rows: TrajectoryRow[];
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const time = (event: AgentTraceEventLike): number => Date.parse(event.timestamp);
const status = (value: unknown): TrajectoryStatus => {
  if (value === "failed" || value === "error") return "failed";
  if (value === "waiting" || value === "requested") return "waiting";
  if (value === "completed" || value === "success" || value === "succeeded") return "completed";
  return "running";
};
const usage = (value: unknown): TrajectoryUsage | undefined => {
  const data = record(value);
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const current = data[key];
      if (typeof current === "number" && Number.isFinite(current) && current >= 0) return current;
    }
    return undefined;
  };
  const result: TrajectoryUsage = {
    inputTokens: read("inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    outputTokens: read("outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    totalTokens: read("totalTokens", "total_tokens"),
    reasoningTokens: read("reasoningTokens", "reasoning_tokens"),
    cachedInputTokens: read("cachedInputTokens", "cached_input_tokens", "cacheReadInputTokens"),
  };
  return Object.values(result).some(value => value !== undefined) ? result : undefined;
};
function elapsed(startedAt: string, completedAt?: string): number | undefined {
  if (!completedAt) return undefined;
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}
function providerDetails(events: AgentTraceEventLike[]): { provider?: string; model?: string } {
  const latest = [...events].reverse().find(event => event.provider || event.model);
  return { ...(latest?.provider ? { provider: latest.provider } : {}), ...(latest?.model ? { model: latest.model } : {}) };
}
function makeRow(
  event: AgentTraceEventLike,
  kind: TrajectoryRowKind,
  title: string,
  summary: string,
  input?: unknown,
  output?: unknown,
): TrajectoryRow {
  const details = providerDetails([event]);
  return {
    id: event.id,
    sequence: event.sequence ?? 0,
    kind,
    title,
    summary,
    status: status(event.status),
    startedAt: event.timestamp,
    ...(details.provider ? { provider: details.provider } : {}),
    ...(details.model ? { model: details.model } : {}),
    ...(event.payloadComplete !== undefined ? { payloadComplete: event.payloadComplete } : {}),
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    events: [event],
  };
}

interface MutableTurn {
  id: string;
  traceId: string;
  startedAt: string;
  completedAt?: string;
  status: TrajectoryStatus;
  provider?: string;
  model?: string;
  rows: TrajectoryRow[];
}

/** Project persisted Agent Trace events into a DeepSeek-style, turn/step-oriented ledger. */
export function projectAgentTrajectory(events: readonly AgentTraceEventLike[]): TrajectoryTurn[] {
  const groups = new Map<string, AgentTraceEventLike[]>();
  for (const event of events) {
    const key = event.traceId || event.correlationId || event.sessionId || "unscoped";
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const turns: TrajectoryTurn[] = [];
  for (const [traceId, source] of groups) {
    const ordered = [...source].sort((a, b) => time(a) - time(b) || (a.sequence ?? 0) - (b.sequence ?? 0));
    if (!ordered.length) continue;
    const rows: TrajectoryRow[] = [];
    const requests = new Map<string, TrajectoryRow>();
    const pendingTools = new Map<string, TrajectoryRow[]>();
    let turnStatus: TrajectoryStatus = "running";
    let turnCompletedAt: string | undefined;
    const first = ordered[0]!;
    const turn = {
      id: traceId,
      traceId,
      startedAt: first.timestamp,
      status: turnStatus,
      rows,
    } satisfies MutableTurn;

    const pushToolPending = (key: string, row: TrajectoryRow) => {
      pendingTools.set(key, [...(pendingTools.get(key) ?? []), row]);
    };

    for (const event of ordered) {
      const data = record(event.data);
      const name = string(data.name ?? data.toolName ?? data.tool) ?? event.type;
      if (event.type === "turn.started" || event.type === "schedule.started") {
        const prompt = string(data.prompt);
        rows.push(makeRow(event, "user", event.type === "schedule.started" ? "定时任务输入" : "用户输入", prompt ?? "已记录用户输入", prompt, undefined));
        continue;
      }
      if (event.type === "provider.request") {
        const requestId = string(data.requestId) ?? event.id;
        const prompt = string(data.prompt);
        const snapshot = record(data.snapshot);
        const request = data.request ?? data.requestPayload ?? data.rawRequest ?? snapshot.rawRequest;
        const row = makeRow(
          event, "model", "模型请求",
          [string(data.captureLevel) ?? "SDK 输入", event.provider, event.model].filter(Boolean).join(" · "),
          request ?? (prompt ? { prompt } : snapshot),
          undefined,
        );
        row.status = status(event.status ?? "started");
        row.payloadComplete = event.payloadComplete === false ? false : row.payloadComplete;
        row.input = snapshot.messages ? snapshot : (request ?? (prompt ? { prompt } : snapshot));
        if (typeof data.requestId === "string") requests.set(requestId, row);
        else requests.set(event.id, row);
        rows.push(row);
        if (event.provider) turn.provider = event.provider;
        if (event.model) turn.model = event.model;
        continue;
      }
      if (event.type === "provider.response") {
        const requestId = string(data.requestId);
        const response = data.response ?? data.responsePayload ?? data.rawResponse ?? data.result ?? data.text;
        const row = requestId ? requests.get(requestId) : [...requests.values()].filter(item => !item.completedAt).at(-1);
        if (row) {
          row.completedAt = event.timestamp;
          row.durationMs = elapsed(row.startedAt, row.completedAt);
          row.status = status(event.status ?? "completed");
          row.output = response;
          row.events.push(event);
          const resultData = record(data.result);
          const nestedResultData = record(resultData.data);
          const dataUsage = usage(data.usage ?? resultData.usage ?? nestedResultData.usage);
          if (dataUsage) row.usage = dataUsage;
          const details = providerDetails([event]);
          row.provider = row.provider ?? details.provider;
          row.model = row.model ?? details.model;
        } else {
          const row = makeRow(event, "model", "模型回复", "存在响应事件，但没有匹配到请求记录", undefined, response);
          rows.push(row);
        }
        continue;
      }
      if (event.type === "provider.message.delta" || event.type === "provider.reasoning.delta" || event.type === "provider.reasoning" || event.type === "provider.codebuddy.event") {
        continue;
      }
      if (event.type === "tool.call") {
        const callId = string(data.toolCallId ?? data.callId);
        const input = data.input ?? data.arguments ?? data.args;
        const row = makeRow(event, "tool", name, "工具调用", input, undefined);
        row.status = status(event.status ?? "running");
        pushToolPending(callId ? "id:" + callId : "name:" + name, row);
        rows.push(row);
        continue;
      }
      if (event.type === "tool.result" || event.type === "tool.failed") {
        const callId = string(data.toolCallId ?? data.callId);
        const key = callId ? "id:" + callId : "name:" + name;
        const pending = pendingTools.get(key);
        const row = pending?.shift();
        if (row) {
          row.completedAt = event.timestamp;
          row.durationMs = elapsed(row.startedAt, row.completedAt);
          row.status = event.type === "tool.failed" || status(event.status) === "failed" ? "failed" : "completed";
          row.output = data.result ?? data.output ?? data.error ?? data;
          row.events.push(event);
        } else {
          rows.push(makeRow(event, "tool", name, "工具结果没有匹配到调用记录", undefined, data.result ?? data.output ?? data.error ?? data));
        }
        continue;
      }
      if (event.type.startsWith("permission.")) {
        rows.push(makeRow(event, "permission", "权限请求", string(data.message ?? data.reason ?? data.name) ?? event.type, data, undefined));
        continue;
      }
      if (event.type.includes("compaction")) {
        rows.push(makeRow(event, "compaction", "上下文压缩", string(data.summary ?? data.reason) ?? event.type, data.before ?? data.input, data.after ?? data.output));
        continue;
      }
      if (event.type === "provider.raw_tool_loop") {
        rows.push(makeRow(event, "context", "工具循环", "工具执行结果被追加到下一次模型请求", data.calls, data.toolResults));
        continue;
      }
      if (event.type === "turn.completed" || event.type === "schedule.completed") {
        turnStatus = "completed";
        turnCompletedAt = event.timestamp;
        continue;
      }
      if (event.type === "turn.failed" || event.type === "schedule.failed") {
        turnStatus = "failed";
        turnCompletedAt = event.timestamp;
        rows.push(makeRow(event, "system", "执行失败", string(data.error) ?? event.type, undefined, data));
        continue;
      }
      if (event.type === "turn.cancel.requested") {
        rows.push(makeRow(event, "system", "取消请求", "已请求取消 Agent 执行", data));
        continue;
      }
      if (event.type === "turn.started") continue;
      if (event.type === "turn.completed" || event.type === "turn.failed") continue;
      if (event.type === "session.saved" || event.type === "session.loaded") continue;
      rows.push(makeRow(event, "system", event.type, string(data.summary ?? data.error ?? data.message) ?? JSON.stringify(data).slice(0, 220), data));
    }

    const provider = turn.provider ?? providerDetails(ordered).provider;
    const model = turn.model ?? providerDetails(ordered).model;
    turns.push({
      id: turn.id,
      traceId: turn.traceId,
      startedAt: turn.startedAt,
      ...(turnCompletedAt ? { completedAt: turnCompletedAt, durationMs: elapsed(turn.startedAt, turnCompletedAt) } : {}),
      status: turnStatus,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      rows: rows.sort((a, b) => time({ timestamp: a.startedAt } as AgentTraceEventLike) - time({ timestamp: b.startedAt } as AgentTraceEventLike) || a.sequence - b.sequence),
    });
  }
  return turns.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
