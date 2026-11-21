import { useMemo, useState } from "react";
import { Card, Collapse, Empty, Progress, Space, Tag, Typography } from "antd";
import type { AgentTraceEventLike } from "./context-explorer/agent-trace-adapter";
import { projectAgentTrajectory, type TrajectoryRow, type TrajectoryRowKind, type TrajectoryTurn } from "./trajectory-projector";

const { Text, Paragraph } = Typography;

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
}
function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}
function formatDuration(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1000) return value + " ms";
  if (value < 60_000) return (value / 1000).toFixed(1) + " s";
  return Math.floor(value / 60_000) + "m " + Math.floor((value % 60_000) / 1000) + "s";
}
function kindLabel(kind: TrajectoryRowKind): string {
  switch (kind) {
    case "user": return "用户";
    case "context": return "上下文";
    case "model": return "模型";
    case "tool": return "工具";
    case "permission": return "权限";
    case "compaction": return "压缩";
    case "system": return "运行时";
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
  return status === "completed" ? "完成" : status === "failed" ? "失败" : status === "waiting" ? "等待" : "运行中";
}

function TurnOverview({ turns }: { turns: TrajectoryTurn[] }) {
  const range = useMemo(() => {
    const starts = turns.map(turn => Date.parse(turn.startedAt)).filter(Number.isFinite);
    const ends = turns.map(turn => turn.completedAt ? Date.parse(turn.completedAt) : Date.parse(turn.startedAt)).filter(Number.isFinite);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }, [turns]);
  const span = Math.max(1, range.end - range.start);
  return <Card size="small" className="trajectory-overview" title="执行时间概览" extra={<Text type="secondary">{turns.length} 个 Turn</Text>}>
    {!turns.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行轨迹" /> : <div className="trajectory-overview-list">
      {turns.map((turn, index) => {
        const start = Date.parse(turn.startedAt);
        const end = turn.completedAt ? Date.parse(turn.completedAt) : start;
        const left = Math.max(0, Math.min(100, ((start - range.start) / span) * 100));
        const width = turn.completedAt ? Math.max(0.7, Math.min(100 - left, ((end - start) / span) * 100)) : 0.7;
        return <div className="trajectory-overview-row" key={turn.id}>
          <Text type="secondary">T{index + 1}</Text>
          <div className="trajectory-overview-track" title={formatDuration(turn.durationMs)}>
            <div className={"trajectory-overview-bar " + turn.status} style={{ left: left + "%", width: width + "%" }} />
          </div>
          <Text type="secondary">{formatTime(turn.startedAt)} · {formatDuration(turn.durationMs)}</Text>
        </div>;
      })}
    </div>}
    <div className="trajectory-overview-legend">
      <span><i className="completed" />已完成</span><span><i className="running" />进行中</span><span>条宽和位置仅按已记录的时间计算</span>
    </div>
  </Card>;
}

function RowInspector({ row }: { row: TrajectoryRow }) {
  const items = [
    ...(row.input === undefined ? [] : [{ key: "input", label: "输入 / 请求参数", children: <pre>{json(row.input)}</pre> }]),
    ...(row.output === undefined ? [] : [{ key: "output", label: "输出 / 结果", children: <pre>{json(row.output)}</pre> }]),
    { key: "events", label: "原始事件", children: <pre>{json(row.events)}</pre> },
  ];
  return <Card size="small" className="trajectory-inspector" title={<Space wrap><Tag color={kindColor(row.kind)}>{kindLabel(row.kind)}</Tag><Text strong>{row.title}</Text><Tag color={statusColor(row.status)}>{statusText(row.status)}</Tag></Space>}>
    <div className="trajectory-inspector-meta">
      <span>开始：{new Date(row.startedAt).toLocaleString()}</span>
      <span>耗时：{formatDuration(row.durationMs)}</span>
      {row.provider && <span>Provider：{row.provider}</span>}
      {row.model && <span>Model：{row.model}</span>}
      {row.payloadComplete === false && <Tag color="warning">上下文采集不完整</Tag>}
    </div>
    {row.summary && <Paragraph className="trajectory-inspector-summary">{row.summary}</Paragraph>}
    <Collapse size="small" items={items} />
  </Card>;
}

function TurnView({ turn, index, selectedId, onSelect }: {
  turn: TrajectoryTurn; index: number; selectedId: string | null; onSelect: (row: TrajectoryRow) => void;
}) {
  return <section className="trajectory-turn">
    <header className="trajectory-turn-header">
      <div><strong>Turn {index + 1}</strong><Text type="secondary">{formatTime(turn.startedAt)}{turn.completedAt ? " → " + formatTime(turn.completedAt) : ""}</Text></div>
      <Space wrap size={6}>
        {turn.provider && <Tag>{turn.provider}</Tag>}
        {turn.model && <Tag>{turn.model}</Tag>}
        <Tag color={statusColor(turn.status)}>{turn.status === "completed" ? "已完成" : turn.status === "failed" ? "失败" : "执行中"}</Tag>
        <Text type="secondary">{formatDuration(turn.durationMs)}</Text>
      </Space>
    </header>
    <div className="trajectory-step-list">
      {turn.rows.map((row, rowIndex) => <button
        type="button"
        key={row.id}
        className={"trajectory-step" + (selectedId === row.id ? " selected" : "")}
        onClick={() => onSelect(row)}
        aria-pressed={selectedId === row.id}
      >
        <span className="trajectory-step-index">{rowIndex + 1}</span>
        <span className="trajectory-step-kind"><Tag color={kindColor(row.kind)}>{kindLabel(row.kind)}</Tag></span>
        <span className="trajectory-step-copy">
          <strong>{row.title}</strong>
          <small>{row.summary}</small>
        </span>
        {row.usage && <span className="trajectory-step-tokens">
          <small>In {row.usage.inputTokens ?? "—"}</small>
          <small>Out {row.usage.outputTokens ?? "—"}</small>
          <small>Think {row.usage.reasoningTokens ?? "—"}</small>
        </span>}
        <span className="trajectory-step-time">
          {row.status === "running" ? <Tag color="processing">运行中</Tag> : null}
          {row.status === "failed" ? <Tag color="error">失败</Tag> : null}
          <small>{formatDuration(row.durationMs)}</small>
        </span>
      </button>)}
      {!turn.rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本轮没有可展示的步骤事件" />}
    </div>
  </section>;
}

export default function AgentTrajectory({ events }: { events: AgentTraceEventLike[] }) {
  const turns = useMemo(() => projectAgentTrajectory(events), [events]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allRows = useMemo(() => turns.flatMap(turn => turn.rows), [turns]);
  const selectedRow = allRows.find(row => row.id === selectedId) ?? null;
  const summary = useMemo(() => ({
    steps: allRows.length,
    tools: allRows.filter(row => row.kind === "tool").length,
    modelCalls: allRows.filter(row => row.kind === "model").length,
    failures: allRows.filter(row => row.status === "failed").length,
  }), [allRows]);

  return <div className="agent-trajectory">
    <div className="trajectory-summary">
      <div><strong>{summary.steps}</strong><span>步骤</span></div>
      <div><strong>{summary.modelCalls}</strong><span>模型调用</span></div>
      <div><strong>{summary.tools}</strong><span>工具调用</span></div>
      <div><strong>{summary.failures}</strong><span>失败</span></div>
    </div>
    <TurnOverview turns={turns} />
    {!turns.length ? <Empty description="当前 Session 尚无可用的执行轨迹" /> : <div className="trajectory-turn-list">
      {turns.map((turn, index) => <TurnView key={turn.id} turn={turn} index={index} selectedId={selectedId} onSelect={row => setSelectedId(row.id)} />)}
    </div>}
    {selectedRow && <RowInspector row={selectedRow} />}
  </div>;
}
