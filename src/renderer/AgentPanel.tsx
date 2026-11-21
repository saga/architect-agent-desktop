import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App as AntApp, Button, Dropdown, Popconfirm, Tag, message, Tooltip } from "antd";
import { FolderOpenOutlined, HistoryOutlined, LinkOutlined, MoreOutlined, PaperClipOutlined, SettingOutlined } from "@ant-design/icons";

import { Bubble, Sender, Think, ThoughtChain } from "@ant-design/x";
import type { ThoughtChainItemType } from "@ant-design/x";
import XMarkdown from "@ant-design/x-markdown";
import { markdownComponents } from "./MarkdownLink";
import AgentA2UICard from "./components/AgentA2UICard";
import A2UIV1Canvas from "./a2ui/A2UIV1Canvas";
import type { RendererToAgentMessage } from "./a2ui/A2UIV1Canvas";
import type { AgentSessionItem, AgentSettings, CopilotEvent, WorkspaceProject } from "../shared/types";

type ChatItem = AgentSessionItem & { streaming?: boolean };
type AgentPanelMode = "sidepanel" | "pure";
const EMPTY_SETTINGS: AgentSettings = { provider: "copilot", copilotModel: "", codebuddyModel: "", thinkingLevel: "medium", toolPermission: "none", systemPrompt: "" };
const SESSION_SAVE_DELAY_MS = 500;

function toSessionItems(items: ChatItem[]): AgentSessionItem[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    content: item.content,
    ...(item.toolName ? { toolName: item.toolName } : {}),
    ...(item.toolState ? { toolState: item.toolState } : {}),
    createdAt: item.createdAt,
  }));
}

function shortPath(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}

function formatToolDetail(detail: string): string {
  const text = detail.trim();
  if (!text) return "";
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  } catch { /* keep original text */ }
  return text;
}

function ThinkBlock({ content, streaming }: { content: string; streaming: boolean }) {
  return <Think className="agent-think" title={streaming ? "深度思考中…" : "深度思考"} loading={streaming} blink={streaming}
    defaultExpanded={false} destroyOnHidden={false}>
    <div className="agent-think-content">{content}</div>
  </Think>;
}

function ToolChain({ steps }: { steps: ChatItem[] }) {
  const items: ThoughtChainItemType[] = steps.map((step) => {
    const detail = formatToolDetail(step.content);
    return {
      key: step.id,
      title: step.toolName || "工具调用",
      description: step.toolState === "running" ? "执行中…" : step.toolState === "error" ? "调用失败" : "调用完成",
      status: step.toolState === "error" ? "error" : step.toolState === "running" ? "loading" : "success",
      collapsible: Boolean(detail),
      destroyOnHidden: false,
      content: detail ? <pre className="agent-thought-detail">{detail}</pre> : undefined,
    };
  });
  return <ThoughtChain className="agent-thought-chain" line="solid" defaultExpandedKeys={items.map((item) => String(item.key))} items={items} />;
}

const bubbleRoles = {
  assistant: (data: any) => ({
    placement: "start" as const,
    variant: "outlined" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <XMarkdown className="agent-markdown" content={content} components={markdownComponents} escapeRawHtml
      streaming={data.extraInfo?.streaming ? { hasNextChunk: true, incremental: true, incompleteMarkdown: "complete" } : false} />,
  }),
  user: {
    placement: "end" as const,
    variant: "filled" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <div className="agent-bubble-text">{content}</div>,
  },
  thinking: (data: any) => ({
    placement: "start" as const,
    variant: "borderless" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <ThinkBlock content={content} streaming={data.extraInfo?.streaming === true} />,
  }),
  thoughtchain: (data: any) => ({
    placement: "start" as const,
    variant: "borderless" as const,
    shape: "corner" as const,
    contentRender: () => <ToolChain steps={(data.extraInfo?.steps ?? []) as ChatItem[]} />,
  }),
  a2ui: (data: any) => ({
    placement: "start" as const,
    variant: "outlined" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <AgentA2UICard content={content} onAction={(payload) => {
      const handler = data.extraInfo?.onAction;
      if (typeof handler === "function") handler(payload);
    }} />,
  }),
  error: {
    placement: "start" as const,
    variant: "borderless" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <Alert className="agent-error-card" type="error" showIcon message="请求失败" description={content} />,
  },
};

export default function AgentPanel({ onClose, onDock, onFloat, onDragState, onMaximize, onRestore, taskId, mode = "sidepanel", onModeChange, onToggleRightPane, rightPaneVisible = false }: {
  onClose: () => void;
  onDock: (position: "left" | "right" | "top" | "bottom") => void;
  onFloat?: () => void;
  onDragState?: (active: boolean) => void;
  onMaximize?: () => void;
  onRestore?: () => void;
  taskId?: string;
  mode?: AgentPanelMode;
  onModeChange?: () => void;
  onToggleRightPane?: () => void;
  rightPaneVisible?: boolean;
}) {
  const { modal } = AntApp.useApp();
  const [status, setStatus] = useState("checking");
  const [statusMessage, setStatusMessage] = useState("");
  const [settings, setSettings] = useState<AgentSettings>(EMPTY_SETTINGS);
  const [workspaceProject, setWorkspaceProject] = useState<WorkspaceProject>({ path: null, name: null });
  

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [senderPanel, setSenderPanel] = useState<"files" | "reference" | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const loadingRef = useRef(false);
  const latestItems = useRef<ChatItem[]>([]);
  const loadedTaskId = useRef<string | undefined>(undefined);
  const sessionReadyRef = useRef(false);

  const refreshStatus = async () => {
    const result = await window.browser.copilotStatus();
    setStatus(result.status);
    setStatusMessage(result.message ?? "");
  };

  useEffect(() => {
    let cancelled = false;
    setSessionReady(false);
    setItems([]);
    let unsubscribe: () => void = () => undefined;
    void window.browser.getWorkspaceProject().then((workspace) => { if (!cancelled) setWorkspaceProject(workspace); }).catch(() => undefined);
    const unsubscribeProject = window.browser.onWorkspaceProjectUpdated((workspace) => {
      setWorkspaceProject(workspace);
      void window.browser.agentLoadSession(taskId).then((saved) => { if (!cancelled) setItems(saved); }).catch(() => undefined);
    });
    void (async () => {
      try {
        if (typeof window.browser.agentLoadSession === "function") {
          const saved = await window.browser.agentLoadSession(taskId);
          if (!cancelled && saved.length) setItems(saved);
        }
      } catch {
        // A missing or unreadable session file starts an empty conversation.
      }
      if (cancelled) return;
      loadedTaskId.current = taskId;
      setSessionReady(true);
      const off = window.browser.onCopilotEvent((event: CopilotEvent) => {
        if (event.taskId && taskId && event.taskId !== taskId) return;
        const finalizeThinking = (next: ChatItem[]) => {
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].kind === "thinking" && next[i].streaming) {
              next[i] = { ...next[i], streaming: false };
              break;
            }
          }
        };
        if (event.type === "status" && event.status) setStatus(event.status);
        if (event.type === "thinking" && event.text) {
          const thinkingText = event.text;
          setItems((current) => {
          const next = [...current];
          let index = -1;
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].kind === "thinking" && next[i].streaming) { index = i; break; }
          }
          if (index >= 0 && event.streaming) {
            next[index] = { ...next[index], content: next[index].content + thinkingText };
          } else if (index >= 0) {
            next[index] = { ...next[index], content: thinkingText, streaming: false };
          } else {
            next.push({ id: crypto.randomUUID(), kind: "thinking", content: thinkingText, createdAt: Date.now(), streaming: event.streaming === true });
          }
          return next;
          });
        }
        if (event.type === "delta" && event.text) setItems((current) => {
          const next = [...current];
          finalizeThinking(next);
          const last = next[next.length - 1];
          if (last?.kind === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + event.text };
          } else {
            next.push({ id: crypto.randomUUID(), kind: "assistant", content: event.text ?? "", createdAt: Date.now(), streaming: true });
          }
          return next;
        });
        if (event.type === "a2ui" && event.text) {
          setItems((current) => [...current, { id: crypto.randomUUID(), kind: "a2ui", content: event.text ?? "", createdAt: Date.now() }]);
        }
        if (event.type === "message" && event.text) setItems((current) => {
          const next = [...current];
          finalizeThinking(next);
          const last = next[next.length - 1];
          if (last?.kind === "assistant") {
            next[next.length - 1] = { ...last, content: event.text ?? last.content, streaming: false };
          } else {
            next.push({ id: crypto.randomUUID(), kind: "assistant", content: event.text ?? "", createdAt: Date.now() });
          }
          return next;
        });
        if (event.type === "tool") setItems((current) => {
          const next = [...current];
          const id = event.toolId ?? crypto.randomUUID();
          const createdAt = Date.now();
          const state = event.toolState === "running" || event.toolState === "error" ? event.toolState : "done";
          const toolItem: ChatItem = {
            id,
            kind: "tool",
            content: event.toolDetail ?? "",
            toolName: event.toolName ?? "Tool",
            toolState: state,
            createdAt,
          };
          const index = next.findIndex((item) => item.id === id);
          if (index >= 0) next[index] = { ...toolItem, createdAt: next[index].createdAt };
          else next.push(toolItem);
          return next;
        });
        if (event.type === "done") {
          setLoading(false);
          setStatus("ready");
          setItems((current) => current.map((item) => item.streaming ? { ...item, streaming: false } : item));
        }
        if (event.type === "error") {
          setLoading(false);
          setStatus("error");
          setItems((current) => [
            ...current.map((item) => item.streaming ? { ...item, streaming: false } : item),
            { id: crypto.randomUUID(), kind: "error", content: event.text ?? "Request failed.", createdAt: Date.now() },
          ]);
        }
      });
      if (cancelled) { off(); return; }
      unsubscribe = off;
    })();
    const unsubscribeSettings = window.browser.onAgentSettingsUpdated((saved) => { setSettings(saved); void refreshStatus(); });
    void Promise.all([window.browser.agentGetSettings(), window.browser.copilotStatus()])
      .then(([saved, result]) => { setSettings(saved); setStatus(result.status); setStatusMessage(result.message ?? ""); })
      .catch(() => setStatus("error"));
    return () => { cancelled = true; unsubscribe(); unsubscribeProject(); unsubscribeSettings(); };
  }, [taskId]);

  useEffect(() => {
    if (!sessionReady || loading || loadedTaskId.current !== taskId || typeof window.browser.agentSaveSession !== "function") return;
    const timer = setTimeout(() => {
      void window.browser.agentSaveSession(toSessionItems(items), taskId).catch(() => undefined);
    }, SESSION_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, sessionReady, taskId, loading]);

  useEffect(() => { latestItems.current = items; }, [items]);
  useEffect(() => { sessionReadyRef.current = sessionReady; }, [sessionReady]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => () => {
    if (loadingRef.current || !sessionReadyRef.current || loadedTaskId.current !== taskId || typeof window.browser.agentSaveSession !== "function") return;
    void window.browser.agentSaveSession(toSessionItems(latestItems.current), taskId).catch(() => undefined);
  }, [taskId]);

  const openSettings = async () => {
    try { await window.browser.openAgentSettings(); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const chooseWorkspace = async () => {
    try {
      const selected = await window.browser.selectWorkspace();
      if (selected) setWorkspaceProject(selected);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const clearWorkspace = async () => {
    try { setWorkspaceProject(await window.browser.clearWorkspace()); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const pickFiles = async () => {
    try {
      if (typeof window.browser.agentPickFiles !== "function") return;
      const files = await window.browser.agentPickFiles();
      if (files.length) setAttachments((current) => [...new Set([...current, ...files])].slice(0, 20));
      setSenderPanel("files");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const addCurrentPage = async () => {
    try {
      const state = await window.browser.getState();
      const url = state.tabs.find((tab) => tab.id === state.activeTabId)?.url;
      if (url && /^https?:/i.test(url)) setReferences((current) => [...new Set([...current, url])].slice(0, 10));
      setSenderPanel("reference");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const clearSession = async () => {
    try {
      if (typeof window.browser.agentClearSession === "function") await window.browser.agentClearSession(taskId);
      setItems([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const send = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    const contextLines = [
      ...(attachments.length ? ["Attached files (parsed locally):", ...attachments.map((file) => "- " + shortPath(file))] : []),
      ...(references.length ? ["References:", ...references.map((url) => "- " + url)] : []),
    ];
    const effectivePrompt = contextLines.length ? contextLines.join("\n") + "\n\n" + prompt : prompt;
    const history = items
      .filter((item) => (item.kind === "user" || item.kind === "assistant") && !item.streaming && item.content.trim())
      .slice(-12)
      .map((item) => ({ role: item.kind as "user" | "assistant", content: item.content.trim().slice(0, 6000) }));
    setItems((current) => [...current, { id: crypto.randomUUID(), kind: "user", content: prompt, createdAt: Date.now() }]);
    setLoading(true);
    try {
      await window.browser.copilotSend(effectivePrompt, history, taskId, attachments);
      setAttachments([]);
      setReferences([]);
      setSenderPanel(null);
    }
    catch (error) { setLoading(false); message.error(error instanceof Error ? error.message : String(error)); }
  };

  const providerName = settings.provider === "copilot" ? "GitHub Copilot CLI" : "CodeBuddy CLI";
  const modelName = settings.provider === "copilot" ? settings.copilotModel : settings.codebuddyModel;

  const subtitle = [providerName, modelName || "使用 CLI 默认模型"].join(" · ");
  const fileAccess = settings.toolPermission === "browser-only" ? "文件访问关闭" : settings.toolPermission === "assisted" ? "只读" : "可读写";
  const workspaceLabel = workspaceProject.name ? "工作区：" + workspaceProject.name + " · " + fileAccess : "未选择工作区 · 选择项目目录";
  const dockItems = [
    { key: "left", label: "靠左" },
    { key: "right", label: "靠右" },
    { key: "top", label: "靠上" },
    { key: "bottom", label: "靠下" },
  ];
  const moreItems = [
    { key: "clear", label: "新建会话" },
    { type: "divider" as const },
    { key: "dock", label: "停靠位置", children: dockItems },
    ...(onMaximize ? [{ key: "maximize", label: "合并为浏览器标签" }] : []),
    ...(onRestore ? [{ key: "restore", label: "恢复分栏" }] : []),
    ...(onFloat ? [{ key: "float", label: "在独立窗口打开" }] : []),
  ];
  const onMoreClick = ({ key }: { key: string }) => {
    if (key === "clear") {
      modal.confirm({
        title: "新建会话",
        content: "当前对话记录会从本机删除。",
        okText: "新建",
        cancelText: "取消",
        onOk: () => void clearSession(),
      });
      return;
    }
    if (key === "maximize") { onMaximize?.(); return; }
    if (key === "restore") { onRestore?.(); return; }
    if (key === "float") { onFloat?.(); return; }
    onDock(key as "left" | "right" | "top" | "bottom");
  };

  const a2uiV1Messages = useMemo(
    () => items.filter(item => item.kind === "a2ui-v1").map(item => item.content),
    [items],
  );
  const onA2UIRendererMessage = useCallback((rendererMessage: RendererToAgentMessage) => {
    if (!taskId) return;
    void window.browser.agentA2uiMessage(rendererMessage, taskId).catch(error => {
      message.error(error instanceof Error ? error.message : String(error));
    });
  }, [taskId]);
  const renderItems = useMemo(() => {
    const result: Array<{ key: string; role: string; content: string; extraInfo: Record<string, unknown>; loading: boolean }> = [];
    let chain: ChatItem[] = [];
    const flushChain = () => {
      if (!chain.length) return;
      result.push({
        key: "chain-" + chain[0].id,
        role: "thoughtchain",
        content: "",
        extraInfo: { steps: chain },
        loading: false,
      });
      chain = [];
    };
    for (const item of items) {
      if (item.kind === "a2ui-v1") continue;
      if (item.kind === "tool") { chain.push(item); continue; }
      flushChain();
      result.push({
        key: item.id,
        role: item.kind,
        content: item.content,
        extraInfo: {
          streaming: item.streaming === true,
          ...(item.kind === "a2ui" ? {
            onAction: (payload: unknown) => {
              void send("A2UI 交互事件：" + JSON.stringify(payload) + "。请根据用户的交互继续分析或更新卡片。");
            },
          } : {}),
        },
        loading: item.kind !== "thinking" && item.streaming === true && !item.content,
      });
    }
    flushChain();
    return result;
  }, [items, send]);

  return <aside className="agent-panel">
    <header className="agent-panel-header">
      <div
        className="agent-panel-heading"
        draggable
        onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "agent-panel"); onDragState?.(true); }}
        onDragEnd={() => onDragState?.(false)}
      >
        <strong className="agent-panel-title">{mode === "pure" ? "Agent" : "Browser Agent"}</strong>
        <div className="agent-subtitle" title={subtitle}>{subtitle}</div>
        <div className="agent-workspace-row">
          <button type="button" draggable={false} className={"agent-workspace" + (workspaceProject.name ? "" : " is-empty")}
            title={workspaceProject.path ? workspaceProject.path + "（点击切换工作区）" : "点击选择本地项目目录"}
            onClick={() => void chooseWorkspace()}>
            <FolderOpenOutlined aria-hidden />
            <span className="agent-workspace-label">{workspaceLabel}</span>
          </button>
          {workspaceProject.name && <Popconfirm title="关闭工作区？" description="Agent 会话会切换到无工作区记录。" okText="关闭" cancelText="取消" onConfirm={() => void clearWorkspace()}>
            <button type="button" draggable={false} className="agent-workspace-clear" aria-label="关闭工作区" title="关闭工作区">×</button>
          </Popconfirm>}
        </div>
      </div>
      <div className="agent-panel-toolbar">
        {onModeChange && <Tooltip title={mode === "pure" ? "切换到 Sidepanel 模式" : "切换到 Pure Agent 模式"}><Button type="text" size="small" onClick={onModeChange}>{mode === "pure" ? "Sidepanel" : "Pure Agent"}</Button></Tooltip>}
        {mode === "pure" && onToggleRightPane && <Tooltip title={rightPaneVisible ? "隐藏右侧工作区" : "显示右侧工作区"}><Button type="text" size="small" onClick={onToggleRightPane}>{rightPaneVisible ? "隐藏预览" : "显示预览"}</Button></Tooltip>}
        <Tooltip title="执行轨迹与 Context Explorer"><Button type="text" size="small" aria-label="执行轨迹与 Context Explorer" icon={<HistoryOutlined />} onClick={() => void window.browser.openSessionExplorer()} /></Tooltip>
        <Tooltip title="Agent 配置"><Button type="text" size="small" aria-label="Agent 配置" icon={<SettingOutlined />} onClick={() => void openSettings()} /></Tooltip>
        <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: moreItems, onClick: onMoreClick }}>
          <Button type="text" size="small" aria-label="更多操作" icon={<MoreOutlined />} />
        </Dropdown>
        <Tooltip title="关闭"><Button type="text" size="small" aria-label="关闭面板" onClick={onClose}>×</Button></Tooltip>
      </div>
    </header>
    {status === "error" && settings.provider === "copilot" && <Alert type="error" showIcon message="GitHub Copilot Agent 初始化失败" description={<div>{statusMessage}<p>这通常是 SDK 配置或运行时问题，不代表 CLI 一定未登录。请检查应用版本和运行日志。</p></div>} />}
    {status === "unauthenticated" && settings.provider === "copilot" && <Alert type="warning" showIcon message="尚未完成 GitHub Copilot CLI 登录" description={<div>{statusMessage && <p>{statusMessage}</p>}本应用调用本机 Copilot CLI 凭据，不会自动复用 VS Code 扩展登录状态。<ol><li>打开 macOS「终端」应用。</li><li>运行 <code>copilot login</code>。如果提示找不到命令，先运行 <code>brew install --cask copilot-cli</code> 安装。</li><li>选择 GitHub.com，再选择浏览器登录。</li><li>在浏览器中登录正确的 GitHub 账号，并授权 GitHub Copilot CLI。</li><li>看到终端提示登录成功后，回到本应用发送消息。</li></ol>也可以运行 <code>copilot</code> 进入交互界面后输入 <code>/login</code>；使用 <code>/user</code> 检查账号。</div>} />}
    {settings.provider === "codebuddy" && status !== "ready" && items.length === 0 && <Alert type="info" showIcon message="CodeBuddy 使用本机 CLI 登录态" description={<div>在系统终端运行 <code>codebuddy</code>，按 CLI 提示完成登录，并确认账号有可用模型权限。首次请求会实际验证认证和模型可用性。</div>} />}
    <div className="agent-messages">
      <Bubble.List role={bubbleRoles} autoScroll items={renderItems} />
      <A2UIV1Canvas messages={a2uiV1Messages} onRendererMessage={onA2UIRendererMessage} />
    </div>
    <div className="agent-composer">
      <Sender rootClassName="agent-sender" value={input} onChange={setInput} submitType="enter"
        onSubmit={(value) => { setInput(""); void send(value); }}
        onCancel={() => void window.browser.copilotCancel()}
        loading={loading} autoSize={{ minRows: 1, maxRows: 6 }}
        placeholder={"使用 " + (settings.provider === "copilot" ? "GitHub Copilot" : "CodeBuddy") + " 询问页面或操作当前网页…"}
        prefix={<div className="agent-sender-prefix">
          <Tooltip title="选择附件"><Button type="text" size="small" aria-label="选择附件" icon={<PaperClipOutlined />} onClick={() => void pickFiles()} /></Tooltip>
        </div>}
        header={<Sender.Header title={senderPanel === "reference" ? "引用当前页面" : "附件"} open={senderPanel !== null} forceRender closable
          onOpenChange={(open) => { if (!open) setSenderPanel(null); }}>
          {senderPanel === "reference" ? <div className="agent-sender-panel">
            <Button size="small" icon={<LinkOutlined />} onClick={() => void addCurrentPage()}>添加当前页面</Button>
            <div className="agent-sender-chips">
              {references.length ? references.map((url) => <Tag key={url} closable onClose={(event) => { event.preventDefault(); setReferences((current) => current.filter((item) => item !== url)); }}>{url}</Tag>) : <span className="agent-sender-empty">尚未添加引用。</span>}
            </div>
          </div> : <div className="agent-sender-panel">
            <Button size="small" icon={<PaperClipOutlined />} onClick={() => void pickFiles()}>选择文件</Button>
            <div className="agent-sender-chips">
              {attachments.length ? attachments.map((file) => <Tag key={file} closable onClose={(event) => { event.preventDefault(); setAttachments((current) => current.filter((item) => item !== file)); }} title={file}>{shortPath(file)}</Tag>) : <span className="agent-sender-empty">尚未添加附件。</span>}
            </div>
          </div>}
        </Sender.Header>}
        suffix={(_oriNode, { components }) => {
          const { SendButton, LoadingButton } = components;
          return <div className="agent-sender-suffix">
            <Tooltip title="引用当前页面"><Button type="text" size="small" aria-label="引用当前页面" icon={<LinkOutlined />} onClick={() => void addCurrentPage()} /></Tooltip>
            {loading ? <LoadingButton /> : <SendButton />}
          </div>;
        }} />
      <div className="agent-composer-hint">Enter 发送 · Shift + Enter 换行</div>
    </div>
  </aside>;
}
