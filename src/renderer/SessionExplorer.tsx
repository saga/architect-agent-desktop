import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Empty, Input, List, Spin, Tabs, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { AgentSessionItem } from "../shared/types";
import AgentTrajectory from "./AgentTrajectory";
import { ContextDebugger, contextSessionsFromAgentEvents, type AgentTraceEventLike } from "./context-explorer";
import { projectAgentTrajectory } from "./trajectory-projector";

type TraceSession = {
  id: string;
  taskId?: string;
  taskTitle?: string;
  expertName?: string;
  workspacePath?: string | null;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  eventCount?: number;
  lastMessagePreview?: string | null;
  lastMessageKind?: string | null;
  lastEventType?: string | null;
};

type TraceEvent = {
  id: string;
  sessionId: string;
  traceId: string;
  sequence: number;
  timestamp: string;
  workspacePath?: string | null;
  provider?: string | null;
  model?: string | null;
  type: string;
  status?: string | null;
  payloadComplete?: boolean;
  data?: unknown;
};

const { Text, Paragraph } = Typography;
const VERBOSE_TYPES = new Set(["provider.message.delta", "provider.reasoning.delta", "provider.reasoning", "provider.codebuddy.event"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatTime(value?: string | number, dateStyle: "short" | "long" = "short"): string {
  if (value === undefined || value === null || value === "") return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, dateStyle === "long"
      ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function workspaceName(value?: string | null): string {
  if (!value) return "个人工作区";
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function sessionTitle(item: TraceSession): string {
  if (item.taskTitle?.trim()) return item.taskTitle;
  return item.workspacePath ? workspaceName(item.workspacePath) + " · 历史会话" : "个人工作区 · 历史会话";
}

function eventLabel(type?: string | null): string {
  if (!type) return "暂无活动";
  const labels: Record<string, string> = {
    "turn.started": "用户请求",
    "turn.completed": "执行完成",
    "turn.failed": "执行失败",
    "turn.cancel.requested": "请求取消",
    "schedule.started": "定时任务开始",
    "schedule.completed": "定时任务完成",
    "schedule.failed": "定时任务失败",
    "provider.request": "模型请求",
    "provider.response": "模型响应",
    "tool.call": "工具调用",
    "tool.result": "工具返回",
    "tool.failed": "工具失败",
    "session.loaded": "加载会话",
    "session.saved": "保存会话",
    "session.cleared": "清空会话",
    "task.created": "创建 Task",
    "task.activated": "切换 Task",
  };
  return labels[type] ?? type;
}

function eventTitle(event: TraceEvent): string {
  const data = record(event.data);
  if (typeof data.name === "string") return data.name;
  if (typeof data.toolName === "string") return data.toolName;
  return eventLabel(event.type);
}

function eventPreview(event: TraceEvent): string {
  const data = record(event.data);
  const value = data.prompt ?? data.text ?? data.error ?? data.name ?? data.result ?? data.itemCount;
  if (typeof value === "string") return value.slice(0, 220);
  if (typeof value === "number") return String(value);
  try { return JSON.stringify(event.data ?? {}).slice(0, 220); }
  catch { return ""; }
}

function statusColor(status?: string | null): string {
  if (status === "failed" || status === "error") return "error";
  if (status === "completed" || status === "success") return "success";
  if (status === "running" || status === "started") return "processing";
  if (status === "waiting" || status === "requested") return "warning";
  return "default";
}

export default function SessionExplorer({
  open = true,
  onClose = () => window.close(),
  standalone = false,
}: { open?: boolean; onClose?: () => void; standalone?: boolean }) {
  const [sessions, setSessions] = useState<TraceSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [messages, setMessages] = useState<AgentSessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [contentSearch, setContentSearch] = useState("");
  const [includeVerbose, setIncludeVerbose] = useState(false);
  const [error, setError] = useState("");

  const refreshSessions = async () => {
    setLoadingSessions(true);
    setError("");
    try {
      const rows = await window.browser.agentTraceListSessions() as TraceSession[];
      setSessions(rows);
      setSelectedId(current => rows.some(item => item.id === current) ? current : rows[0]?.id ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    if (open) void refreshSessions();
  }, [open]);

  useEffect(() => {
    if (!open || !selectedId) {
      setEvents([]);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingEvents(true);
    const load = async () => {
      const [eventRows, messageRows] = await Promise.all([
        window.browser.agentTraceQuery({ sessionId: selectedId, limit: 1000 }),
        window.browser.agentTraceListSessionItems(selectedId),
      ]);
      if (cancelled) return;
      setEvents(eventRows as TraceEvent[]);
      setMessages(messageRows);
      setLoadingEvents(false);
    };
    void load().catch(reason => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoadingEvents(false);
      }
    });
    const liveTimer = window.setInterval(() => {
      void load().catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 2500);
    return () => { cancelled = true; window.clearInterval(liveTimer); };
  }, [open, selectedId]);

  const selected = sessions.find(item => item.id === selectedId);
  const chronological = useMemo(
    () => [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.sequence - b.sequence),
    [events],
  );
  const traceContextEvents = useMemo<AgentTraceEventLike[]>(() => chronological.map(event => ({
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    sessionId: event.sessionId,
    traceId: event.traceId,
    sequence: event.sequence,
    ...(event.provider ? { provider: event.provider } : {}),
    ...(event.model ? { model: event.model } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.payloadComplete !== undefined ? { payloadComplete: event.payloadComplete } : {}),
    data: event.data,
  })), [chronological]);
  const contextSession = useMemo(
    () => contextSessionsFromAgentEvents(traceContextEvents, { sessionId: selectedId })[0],
    [traceContextEvents, selectedId],
  );
  const turns = useMemo(() => projectAgentTrajectory(traceContextEvents), [traceContextEvents]);
  const toolCallCount = chronological.filter(event => event.type === "tool.call").length;
  const verboseCount = chronological.filter(event => VERBOSE_TYPES.has(event.type)).length;

  const filteredSessions = useMemo(() => {
    const term = sessionSearch.trim().toLocaleLowerCase();
    if (!term) return sessions;
    return sessions.filter(item => [
      sessionTitle(item),
      item.workspacePath ?? "",
      item.expertName ?? "",
      item.lastMessagePreview ?? "",
      item.lastEventType ?? "",
    ].join(" ").toLocaleLowerCase().includes(term));
  }, [sessions, sessionSearch]);

  const visibleEvents = useMemo(() => {
    const term = contentSearch.trim().toLocaleLowerCase();
    return chronological.filter(event => {
      if (!includeVerbose && VERBOSE_TYPES.has(event.type)) return false;
      if (!term) return true;
      return (event.type + " " + eventTitle(event) + " " + eventPreview(event)).toLocaleLowerCase().includes(term);
    });
  }, [chronological, contentSearch, includeVerbose]);

  const visibleMessages = useMemo(() => {
    const term = contentSearch.trim().toLocaleLowerCase();
    return term ? messages.filter(item => (item.kind + " " + item.toolName + " " + item.content).toLocaleLowerCase().includes(term)) : messages;
  }, [messages, contentSearch]);

  const transcript = <div className="se-content-list">
    {loadingEvents ? <Spin /> : visibleMessages.length ? <List dataSource={visibleMessages} renderItem={item => <List.Item>
      <article className={"se-message is-" + item.kind}>
        <div className="se-message-heading">
          <strong>{item.kind === "user" ? "You" : item.kind === "assistant" ? "Agent" : item.kind === "thinking" ? "Reasoning" : item.kind === "tool" ? item.toolName || "Tool" : "Error"}</strong>
          <Tag color={item.kind === "user" ? "blue" : item.kind === "thinking" ? "purple" : item.kind === "tool" ? "gold" : item.kind === "error" ? "error" : "default"}>{item.kind}</Tag>
          <time>{formatTime(item.createdAt)}</time>
        </div>
        <pre>{item.content}</pre>
      </article>
    </List.Item>} /> : <Empty description={messages.length ? "没有匹配的消息" : "这个 Session 没有持久化的对话消息"} />}
  </div>;

  const activity = <div className="se-activity">
    <div className="se-activity-toolbar">
      <div>
        <strong>{visibleEvents.length} 条活动</strong>
        <Text type="secondary">{chronological.length > 1000 ? "显示最近 1,000 条" : "按时间排序"}</Text>
      </div>
      <Checkbox checked={includeVerbose} onChange={event => setIncludeVerbose(event.target.checked)}>
        显示流式事件{verboseCount ? "（" + verboseCount + "）" : ""}
      </Checkbox>
    </div>
    {loadingEvents ? <Spin /> : visibleEvents.length ? <List dataSource={[...visibleEvents].reverse()} renderItem={event => <List.Item>
      <article className="se-activity-item">
        <div className="se-activity-item-head">
          <div><strong>{eventTitle(event)}</strong><span>{event.type}</span></div>
          <div><Tag color={statusColor(event.status)}>{event.status ?? "记录"}</Tag><time>{formatTime(event.timestamp)}</time></div>
        </div>
        {eventPreview(event) && <Paragraph className="se-activity-preview" ellipsis={{ rows: 2 }}>{eventPreview(event)}</Paragraph>}
        <div className="se-activity-meta">Trace {event.traceId.slice(0, 8)} · #{event.sequence}{event.provider ? " · " + event.provider : ""}{event.model ? " · " + event.model : ""}</div>
        {event.payloadComplete === false && <Text type="warning">该事件的载荷经过截断或仅保存了 SDK 边界摘要。</Text>}
        <details><summary>查看原始事件</summary><pre>{JSON.stringify(event.data ?? {}, null, 2)}</pre></details>
      </article>
    </List.Item>} /> : <Empty description="没有匹配的活动事件" />}
  </div>;

  const explorerBody = (
    <div className="session-explorer se-layout">
      <aside className="session-explorer-sidebar se-sidebar">
        <div className="se-sidebar-heading">
          <div><strong>任务会话</strong><span>{sessions.length} 个 Session</span></div>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void refreshSessions()} loading={loadingSessions} aria-label="刷新 Session 列表" />
        </div>
        <div className="se-sidebar-search">
          <Input allowClear size="middle" placeholder="搜索任务、工作区或消息" value={sessionSearch} onChange={event => setSessionSearch(event.target.value)} />
        </div>
        {loadingSessions && !sessions.length ? <div className="se-sidebar-loading"><Spin /></div> : filteredSessions.length ? <div className="se-session-list">
          {filteredSessions.map(item => {
            const active = item.id === selectedId;
            return <button
              type="button"
              key={item.id}
              className={"se-session-card" + (active ? " active" : "")}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="se-session-title">{sessionTitle(item)}</span>
              <span className="se-session-workspace">{workspaceName(item.workspacePath)}{item.expertName ? " · " + item.expertName : ""}</span>
              <span className="se-session-preview">{item.lastMessagePreview?.trim() || eventLabel(item.lastEventType)}</span>
              <span className="se-session-footer">
                <span>{formatTime(item.updatedAt)}</span>
                <span>{item.messageCount ?? 0} 消息 · {item.eventCount ?? 0} 事件</span>
              </span>
            </button>;
          })}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={sessions.length ? "没有匹配的 Session" : "暂无任务会话"} />}
      </aside>

      <main className="session-explorer-main se-main">
        {error && <div className="se-error">{error}</div>}
        {!selected ? <Empty description="选择左侧任务会话查看记录" /> : <>
          <header className="se-main-header">
            <div className="se-title-block">
              <div className="se-breadcrumb">{workspaceName(selected.workspacePath)}{selected.expertName ? " / " + selected.expertName : ""}</div>
              <h2>{sessionTitle(selected)}</h2>
              <div className="se-session-id">
                <Text type="secondary">Session ID</Text>
                <Text copyable={{ text: selected.id }}>{selected.id.slice(0, 8)}…{selected.id.slice(-6)}</Text>
                <span>最近活动 {formatTime(selected.updatedAt)}</span>
              </div>
            </div>
            <div className="se-header-actions">
              <Tag color={turns.length ? "processing" : "default"}>{turns.length ? turns.length + " 次执行" : "尚无执行"}</Tag>
              <Button icon={<ReloadOutlined />} onClick={() => {
                void refreshSessions();
                void Promise.all([
                  window.browser.agentTraceQuery({ sessionId: selectedId, limit: 1000 }),
                  window.browser.agentTraceListSessionItems(selectedId),
                ]).then(([eventRows, messageRows]) => {
                  setEvents(eventRows as TraceEvent[]);
                  setMessages(messageRows);
                }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
              }} loading={loadingEvents}>刷新</Button>
            </div>
          </header>

          <div className="se-summary-strip">
            <div><strong>{messages.length}</strong><span>对话消息</span></div>
            <div><strong>{turns.length}</strong><span>Agent 执行</span></div>
            <div><strong>{toolCallCount}</strong><span>工具调用</span></div>
            <div><strong>{chronological.length}</strong><span>活动事件</span></div>
          </div>

          <div className="se-content-search">
            <Input allowClear placeholder="在当前 Session 中搜索消息、工具和事件" value={contentSearch} onChange={event => setContentSearch(event.target.value)} />
          </div>

          <Tabs className="se-tabs" defaultActiveKey="runs" items={[
            { key: "runs", label: "执行记录", children: <AgentTrajectory events={traceContextEvents} /> },
            { key: "messages", label: <span>会话 <small>{messages.length}</small></span>, children: transcript },
            { key: "context", label: "Context Explorer", children: contextSession?.runs.length
              ? <ContextDebugger session={contextSession} />
              : <div className="se-empty-panel"><Empty description="没有可检查的模型上下文" /><p>只有发生模型请求后，才会在这里出现 Context Snapshot、LLM Calls 和 Context Diff。</p></div> },
            { key: "events", label: <span>活动事件 <small>{chronological.length}</small></span>, children: activity },
          ]} />
        </>}
      </main>
    </div>
  );

  if (standalone) {
    return <main className="session-explorer-window se-window">
      <header className="session-explorer-window-header">
        <div><h1>Session Explorer</h1><p>任务会话、Agent 执行、模型上下文和运行事件</p></div>
        <div className="session-explorer-window-actions">
          <Button icon={<ReloadOutlined />} onClick={() => {
            void refreshSessions();
            if (selectedId) void Promise.all([
              window.browser.agentTraceQuery({ sessionId: selectedId, limit: 1000 }),
              window.browser.agentTraceListSessionItems(selectedId),
            ]).then(([eventRows, messageRows]) => {
              setEvents(eventRows as TraceEvent[]);
              setMessages(messageRows);
            }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
          }}>刷新</Button>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </header>
      {explorerBody}
    </main>;
  }

  return <div className="session-explorer-drawer-wrap">
    {explorerBody}
  </div>;
}
