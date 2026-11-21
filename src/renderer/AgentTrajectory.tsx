import { useMemo, useState } from "react";
import { Collapse, Empty, Space, Tag, Typography } from "antd";
import type { AgentTraceEventLike } from "./context-explorer/agent-trace-adapter";
import { projectAgentTrajectory, type TrajectoryRow, type TrajectoryRowKind, type TrajectoryTurn } from "./trajectory-projector";

const { Paragraph } = Typography;

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
}
function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function formatDuration(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1000) return value + " ms";
  if (value < 60_000) return (value / 1000).toFixed(1) + " s";
  return Math.floor(value / 60_000) + "m " + Math.floor((value % 60_000) / 1000) + "s";
}
function kindLabel(kind: TrajectoryRowKind): string {
  switch (kind) {
    case "user": return "输入";
    case "context": return "上下文";
    case "model": return "模型";
    case "tool": return "工具";
    case "permission": return "权限";
    case "compaction": return "压缩";
    case "system": return "系统";
  }
}
function kindColor(kind: TrajectoryRowKind): string {
  switch (kind) {
    case "user": return "blue";
    case "context": return "cyan";
    case "model": return "purple";
    case "tool": return "gold";
    case "permission": return "orange";
    case "compaction": return "magenta";
    case "system": return "default";
  }
}
function statusColor(status: TrajectoryRow["status"]): string {
  return status === "completed" ? "success" : status === "failed" ? "error" : status === "waiting" ? "warning" : "processing";
}
function statusText(status: TrajectoryRow["status"]): string {
  return status === "completed" ? "已完成" : status === "failed" ? "失败" : status === "waiting" ? "等待权限" : "运行中";
}
function runPrompt(turn: TrajectoryTurn): string {
  const userRow = turn.rows.find(row => row.kind === "user");
  if (userRow?.summary) return userRow.summary;
  const modelRow = turn.rows.find(row => row.kind === "model");
  return modelRow?.summary || "历史执行记录";
}
function runCounts(turn: TrajectoryTurn) {
  return {
    steps: turn.rows.length,
    model: turn.rows.filter(row => row.kind === "model").length,
    tools: turn.rows.filter(row => row.kind === "tool").length,
    failures: turn.rows.filter(row => row.status === "failed").length,
  };
}

function RowInspector({ row }: { row: TrajectoryRow }) {
  const items = [
    ...(row.input === undefined ? [] : [{ key: "input", label: "输入 / 请求参数", children: <pre>{json(row.input)}</pre> }]),
    ...(row.output === undefined ? [] : [{ key: "output", label: "输出 / 结果", children: <pre>{json(row.output)}</pre> }]),
    { key: "events", label: "关联原始事件", children: <pre>{json(row.events)}</pre> },
  ];
  return <div className="trajectory-inspector">
    <div className="trajectory-inspector-heading">
      <Space wrap>
        <Tag color={kindColor(row.kind)}>{kindLabel(row.kind)}</Tag>
        <strong>{row.title}</strong>
        <Tag color={statusColor(row.status)}>{statusText(row.status)}</Tag>
      </Space>
      <span>{formatDuration(row.durationMs)}</span>
    </div>
    <div className="trajectory-inspector-meta">
      <span>开始：{formatTime(row.startedAt)}</span>
      {row.provider && <span>Provider：{row.provider}</span>}
      {row.model && <span>Model：{row.model}</span>}
      {row.usage && <span>Tokens：输入 {row.usage.inputTokens ?? "—"} · 输出 {row.usage.outputTokens ?? "—"} · 推理 {row.usage.reasoningTokens ?? "—"}</span>}
      {row.payloadComplete === false && <Tag color="warning">SDK 边界采集，非完整底层请求</Tag>}
    </div>
    {row.summary && <Paragraph className="trajectory-inspector-summary">{row.summary}</Paragraph>}
    <Collapse size="small" items={items} />
  </div>;
}

function RunCard({ turn, index, expanded, onToggle, selectedId, onSelect }: {
  turn: TrajectoryTurn;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (row: TrajectoryRow) => void;
}) {
  const counts = runCounts(turn);
  const selectedRow = turn.rows.find(row => row.id === selectedId);
  const prompt = runPrompt(turn);
  return <article className={"trajectory-run" + (expanded ? " expanded" : "")}>
    <button type="button" className="trajectory-run-header" onClick={onToggle} aria-expanded={expanded}>
      <span className="trajectory-run-number">{String(index + 1).padStart(2, "0")}</span>
      <span className="trajectory-run-main">
        <strong>{prompt.length > 150 ? prompt.slice(0, 150) + "…" : prompt}</strong>
        <small>{formatTime(turn.startedAt)}{turn.provider ? " · " + turn.provider : ""}{turn.model ? " · " + turn.model : ""}</small>
      </span>
      <span className="trajectory-run-counts">
        <span>{counts.steps} 步</span>
        <span>{counts.model} 次模型调用</span>
        <span>{counts.tools} 次工具</span>
        {counts.failures > 0 && <span className="has-failures">{counts.failures} 次失败</span>}
      </span>
      <span className="trajectory-run-state">
        <Tag color={statusColor(turn.status)}>{statusText(turn.status)}</Tag>
        <small>{formatDuration(turn.durationMs)}</small>
      </span>
      <span className="trajectory-run-chevron">{expanded ? "−" : "+"}</span>
    </button>
    {expanded && <div className="trajectory-run-details">
      <div className="trajectory-step-list">
        {turn.rows.map((row, rowIndex) => <button
          type="button"
          key={row.id}
          className={"trajectory-step" + (selectedId === row.id ? " selected" : "")}
          onClick={() => onSelect(row)}
          aria-pressed={selectedId === row.id}
        >
          <span className="trajectory-step-index">{String(rowIndex + 1).padStart(2, "0")}</span>
          <span className="trajectory-step-kind"><Tag color={kindColor(row.kind)}>{kindLabel(row.kind)}</Tag></span>
          <span className="trajectory-step-copy">
            <strong>{row.title}</strong>
            <small>{row.summary}</small>
          </span>
          {row.usage && <span className="trajectory-step-tokens">
            <small>In {row.usage.inputTokens ?? "—"}</small>
            <small>Out {row.usage.outputTokens ?? "—"}</small>
            {row.usage.reasoningTokens !== undefined && <small>Reasoning {row.usage.reasoningTokens}</small>}
          </span>}
          <span className="trajectory-step-time">
            {row.status === "running" && <Tag color="processing">运行中</Tag>}
            {row.status === "failed" && <Tag color="error">失败</Tag>}
            <small>{formatDuration(row.durationMs)}</small>
          </span>
        </button>)}
        {!turn.rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="执行记录没有可展示的步骤" />}
      </div>
      {selectedRow && <RowInspector row={selectedRow} />}
    </div>}
  </article>;
}

export default function AgentTrajectory({ events }: { events: AgentTraceEventLike[] }) {
  const turns = useMemo(() => projectAgentTrajectory(events), [events]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allRows = useMemo(() => turns.flatMap(turn => turn.rows), [turns]);
  const stats = useMemo(() => ({
    steps: allRows.length,
    tools: allRows.filter(row => row.kind === "tool").length,
    modelCalls: allRows.filter(row => row.kind === "model").length,
    failures: allRows.filter(row => row.status === "failed").length,
    completedRuns: turns.filter(turn => turn.status === "completed").length,
  }), [allRows, turns]);

  if (!turns.length) {
    return <section className="agent-trajectory-empty">
      <div className="trajectory-empty-mark">T</div>
      <div>
        <h3>这个 Session 还没有 Agent 执行记录</h3>
        <p>Session / Task 的创建、切换和自动保存会记录在「事件」中，但不会伪装成模型执行 Turn。</p>
        {events.length > 0 && <span>当前有 {events.length} 条运行时活动事件；可在「事件」标签中查看。</span>}
      </div>
    </section>;
  }

  return <div className="agent-trajectory">
    <div className="trajectory-overview">
      <div className="trajectory-overview-heading">
        <div><h2>执行记录</h2><p>每次用户请求或定时任务对应一个 Run；展开后查看模型调用、工具执行和结果。</p></div>
        <Tag color="blue">{turns.length} 次执行</Tag>
      </div>
      <div className="trajectory-summary">
        <div><strong>{stats.steps}</strong><span>执行步骤</span></div>
        <div><strong>{stats.modelCalls}</strong><span>模型调用</span></div>
        <div><strong>{stats.tools}</strong><span>工具调用</span></div>
        <div><strong>{stats.failures}</strong><span>失败步骤</span></div>
      </div>
      <div className="trajectory-overview-foot">
        <span>{stats.completedRuns} 次执行已完成</span>
        <span>事件总数 {events.length}（包含运行时和会话活动）</span>
      </div>
    </div>
    <div className="trajectory-run-list">
      {turns.map((turn, index) => <RunCard
        key={turn.id}
        turn={turn}
        index={index}
        expanded={expandedId === turn.id}
        onToggle={() => setExpandedId(current => current === turn.id ? null : turn.id)}
        selectedId={selectedId}
        onSelect={row => setSelectedId(row.id)}
      />)}
    </div>
  </div>;
}
