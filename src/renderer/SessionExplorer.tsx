import { useEffect, useMemo, useState } from "react";
import { Button, Descriptions, Drawer, Empty, Input, List, Spin, Statistic, Tabs, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { AgentSessionItem } from "../shared/types";

type TraceSession = {
  id: string;
  workspacePath?: string | null;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  eventCount?: number;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatTime(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function eventTitle(event: TraceEvent): string {
  const data = record(event.data);
  if (typeof data.name === "string") return data.name;
  if (typeof data.toolName === "string") return data.toolName;
  return event.type;
}

function eventPreview(event: TraceEvent): string {
  const data = record(event.data);
  const value = data.prompt ?? data.text ?? data.error ?? data.name ?? data.result;
  if (typeof value === "string") return value.slice(0, 220);
  return JSON.stringify(event.data ?? {}).slice(0, 220);
}

function elapsed(start?: string, end?: string): string {
  if (!start || !end) return "未完成";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? (ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(2) + " s") : "—";
}

function tokenUsage(event?: TraceEvent): { input?: number; output?: number; total?: number } {
  const data = record(event?.data);
  const result = record(data.result);
  const usage = record(data.usage ?? result.usage);
  const read = (...values: unknown[]) => values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    input: read(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens),
    output: read(usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.completionTokens),
    total: read(usage.total_tokens, usage.totalTokens),
  };
}

export default function SessionExplorer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sessions, setSessions] = useState<TraceSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [messages, setMessages] = useState<AgentSessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const refreshSessions = async () => {
    setLoadingSessions(true);
    setError("");
    try {
      const result = await window.browser.agentTraceListSessions();
      const rows = result as TraceSession[];
      setSessions(rows);
      setSelectedId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? "");
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
    void Promise.all([
      window.browser.agentTraceQuery({ sessionId: selectedId, limit: 1000 }),
      window.browser.agentTraceListSessionItems(selectedId),
    ])
      .then(([eventRows, messageRows]) => {
        if (cancelled) return;
        setEvents(eventRows as TraceEvent[]);
        setMessages(messageRows);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoadingEvents(false); });
    return () => { cancelled = true; };
  }, [open, selectedId]);

  const selected = sessions.find((item) => item.id === selectedId);
  const chronological = useMemo(() => [...events].reverse(), [events]);
  const visibleEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return chronological;
    return chronological.filter((event) => (event.type + " " + eventTitle(event) + " " + eventPreview(event)).toLowerCase().includes(term));
  }, [chronological, search]);
  const toolRuns = useMemo(() => {
    const pending = new Map<string, Array<{ call: TraceEvent; finish?: TraceEvent }>>();
    const runs: Array<{ call: TraceEvent; finish?: TraceEvent }> = [];
    for (const event of visibleEvents) {
      if (!event.type.startsWith("tool.")) continue;
      const name = eventTitle(event);
      const key = event.traceId + ":" + name;
      if (event.type === "tool.call") {
        const run = { call: event };
        runs.push(run);
        const queue = pending.get(key) ?? [];
        queue.push(run);
        pending.set(key, queue);
      } else if (event.type === "tool.result" || event.type === "tool.failed") {
        const queue = pending.get(key);
        const run = queue?.shift();
        if (run) run.finish = event;
        else runs.push({ call: event, finish: event });
      }
    }
    return runs;
  }, [visibleEvents]);
  const modelRequests = visibleEvents.filter((event) => event.type === "provider.request");
  const modelCalls = modelRequests.map((request) => {
    const response = visibleEvents.find((event) => event.traceId === request.traceId && event.type === "provider.response" &&
      new Date(event.timestamp).getTime() >= new Date(request.timestamp).getTime());
    const data = record(request.data);
    return { request, response, prompt: typeof data.prompt === "string" ? data.prompt : "", captureLevel: data.captureLevel, usage: tokenUsage(response) };
  });
  const usageCalls = modelCalls.filter((call) => call.usage.input !== undefined || call.usage.output !== undefined || call.usage.total !== undefined);
  const inputTokens = modelCalls.reduce((sum, call) => sum + (call.usage.input ?? 0), 0);
  const outputTokens = modelCalls.reduce((sum, call) => sum + (call.usage.output ?? 0), 0);
  const totalTokens = modelCalls.reduce((sum, call) => sum + (call.usage.total ?? 0), 0);
  const contextEvents = visibleEvents.filter((event) => event.type.startsWith("context.") || event.type === "provider.request");
  const completedCalls = modelCalls.filter((call) => call.response).length;

  const transcript = <div className="session-explorer-list">
    {loadingEvents ? <Spin /> : messages.length ? <List dataSource={messages} renderItem={(item) => <List.Item>
      <div className={"session-message is-" + item.kind}>
        <div className="session-message-heading">
          <Text strong>{item.kind === "user" ? "用户" : item.kind === "assistant" ? "Agent" : item.kind === "tool" ? item.toolName || "工具调用" : "错误"}</Text>
          <Tag color={item.kind === "error" ? "red" : item.kind === "user" ? "blue" : item.kind === "tool" ? "gold" : "default"}>{item.kind}</Tag>
          <Text type="secondary">{formatTime(item.createdAt)}</Text>
        </div>
        <pre>{item.content}</pre>
      </div>
    </List.Item>} /> : <Empty description="当前 Session 没有保存的消息" />}
  </div>;

  const timeline = <div className="session-explorer-list">
    {loadingEvents ? <Spin /> : visibleEvents.length ? <List
      dataSource={visibleEvents}
      renderItem={(event) => <List.Item className="session-event-item">
        <div className="session-event">
          <div className="session-event-heading">
            <Text strong>{eventTitle(event)}</Text>
            <Tag color={event.status === "failed" || event.status === "error" ? "red" : event.status === "completed" ? "green" : "default"}>{event.status ?? event.type}</Tag>
            <Text type="secondary">{formatTime(event.timestamp)}</Text>
          </div>
          <Text type="secondary" className="session-event-type">{event.type} · trace {event.traceId.slice(0, 8)} · #{event.sequence}</Text>
          <Paragraph className="session-event-preview" ellipsis={{ rows: 2 }}>{eventPreview(event)}</Paragraph>
          <details><summary>查看事件数据</summary><pre>{JSON.stringify(event.data ?? {}, null, 2)}</pre></details>
          {event.payloadComplete === false && <Text type="warning">事件数据不完整：写入时触发了大小或序列化限制</Text>}
        </div>
      </List.Item>}
    /> : <Empty description="没有匹配的事件" />}
  </div>;

  const tools = <div className="session-explorer-list">
    {loadingEvents ? <Spin /> : toolRuns.length ? <List dataSource={toolRuns} renderItem={({ call, finish }) => <List.Item>
      <div className="session-event">
        <div className="session-event-heading">
          <Text strong>{eventTitle(call)}</Text>
          <Tag color={finish?.type === "tool.failed" ? "red" : finish?.type === "tool.result" ? "green" : "blue"}>
            {finish?.type === "tool.failed" ? "失败" : finish?.type === "tool.result" ? "完成" : "执行中"}
          </Tag>
          <Text type="secondary">{elapsed(call.timestamp, finish?.timestamp)}</Text>
        </div>
        <Text type="secondary">{formatTime(call.timestamp)} · Trace {call.traceId}</Text>
        <details><summary>查看调用参数</summary><pre>{JSON.stringify(call.data ?? {}, null, 2)}</pre></details>
        {finish && finish !== call && <details><summary>查看执行结果</summary><pre>{JSON.stringify(finish.data ?? {}, null, 2)}</pre></details>}
      </div>
    </List.Item>} /> : <Empty description="当前 Session 没有工具调用记录" />}
  </div>;

  const models = <div className="session-explorer-content">
    <div className="session-explorer-stats">
      <Statistic title="模型请求" value={modelCalls.length} />
      <Statistic title="已完成" value={completedCalls} />
      <Statistic title="输入 Tokens" value={usageCalls.length ? inputTokens : "—"} />
      <Statistic title="输出 Tokens" value={usageCalls.length ? outputTokens : "—"} />
      <Statistic title="总 Tokens" value={usageCalls.length ? totalTokens : "—"} />
      <Statistic title="未完成 / 缺少响应" value={modelCalls.length - completedCalls} />
    </div>
    {modelCalls.length ? <List dataSource={modelCalls} renderItem={({ request, response, prompt, captureLevel, usage }) => <List.Item>
      <div className="session-event">
        <div className="session-event-heading">
          <Text strong>{request.provider ?? "Provider"} · {request.model || "默认模型"}</Text>
          <Tag color={response ? "green" : "default"}>{response ? "已返回" : "无可观察响应"}</Tag>
          <Text type="secondary">{elapsed(request.timestamp, response?.timestamp)}</Text>
        </div>
        <Text type="secondary">{formatTime(request.timestamp)} · Trace {request.traceId}</Text>
        <Text type="secondary">输入采集级别：{String(captureLevel ?? "未标注")}</Text>
        <Text type="secondary">Tokens：输入 {usage.input ?? "—"} · 输出 {usage.output ?? "—"} · 总计 {usage.total ?? "—"}</Text>
        {prompt && <details><summary>查看提交给 SDK 的上下文</summary><pre>{prompt}</pre></details>}
        {response && <details><summary>查看 SDK 响应</summary><pre>{JSON.stringify(response.data ?? {}, null, 2)}</pre></details>}
      </div>
    </List.Item>} /> : <Empty description="当前 Session 没有模型请求记录" />}
    <Text type="secondary">Token 用量只有在 Provider / SDK 实际返回 usage 字段时才可展示；当前没有返回的 Token 数据不会估算或伪造。模型请求记录是 SDK 调用边界，不等同于底层网络请求。</Text>
  </div>;

  const context = <div className="session-explorer-list">
    {contextEvents.length ? <List dataSource={contextEvents} renderItem={(event) => {
      const data = record(event.data);
      const prompt = typeof data.prompt === "string" ? data.prompt : "";
      return <List.Item><div className="session-event">
        <div className="session-event-heading"><Text strong>{event.type}</Text><Text type="secondary">{formatTime(event.timestamp)}</Text></div>
        <Descriptions size="small" column={1} items={[
          { key: "provider", label: "Provider", children: String(event.provider ?? "—") },
          { key: "model", label: "Model", children: String(event.model ?? "—") },
          { key: "capture", label: "采集级别", children: String(data.captureLevel ?? "—") },
          { key: "complete", label: "完整性", children: data.providerPayloadComplete === false ? "SDK 调用边界数据，非完整底层请求" : event.payloadComplete === false ? "事件载荷不完整" : "按记录内容保存" },
        ]} />
        {prompt && <details><summary>上下文内容</summary><pre>{prompt}</pre></details>}
      </div></List.Item>;
    }} /> : <Empty description="当前 Session 没有上下文来源事件" />}
  </div>;

  return <Drawer className="session-explorer-drawer" title="Session Explorer" open={open} onClose={onClose} width="min(1120px, 96vw)"
    extra={<Button icon={<ReloadOutlined />} onClick={() => void refreshSessions()} loading={loadingSessions}>刷新</Button>}>
    <div className="session-explorer">
      <aside className="session-explorer-sidebar">
        <div className="session-explorer-sidebar-title">Sessions <Text type="secondary">{sessions.length}</Text></div>
        {loadingSessions ? <Spin /> : sessions.length ? <List dataSource={sessions} renderItem={(item) => <List.Item
          className={"session-explorer-session" + (item.id === selectedId ? " selected" : "")}
          onClick={() => setSelectedId(item.id)}>
          <div>
            <Text strong>{item.workspacePath?.split(/[\\/]/).filter(Boolean).pop() || "默认工作区"}</Text>
            <div><Text type="secondary">{formatTime(item.updatedAt)}</Text></div>
            <div className="session-explorer-counts">{item.messageCount ?? 0} 条消息 · {item.eventCount ?? 0} 个事件</div>
          </div>
        </List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Session" />}
      </aside>
      <main className="session-explorer-main">
        {error && <Text type="danger">{error}</Text>}
        {!selected ? <Empty description="选择一个 Session 查看记录" /> : <>
          <div className="session-explorer-summary">
            <Text strong>{selected.workspacePath ?? "默认工作区"}</Text>
            <Text type="secondary">Session ID：{selected.id}</Text>
            <Text type="secondary">更新时间：{formatTime(selected.updatedAt)} · {selected.messageCount ?? 0} 条消息 · {selected.eventCount ?? 0} 个事件</Text>
          </div>
          <Input.Search allowClear placeholder="搜索事件类型、工具名称或内容" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Tabs defaultActiveKey="messages" items={[
            { key: "messages", label: "会话记录", children: transcript },
            { key: "timeline", label: "事件时间线", children: timeline },
            { key: "tools", label: "工具调用", children: tools },
            { key: "models", label: "模型分析", children: models },
            { key: "context", label: "Context 调试", children: context },
          ]} />
          <Text type="secondary">事件时间线显示最近最多 1,000 个事件；会话消息从 SQLite session_messages 表完整读取。</Text>
        </>}
      </main>
    </div>
  </Drawer>;
}
