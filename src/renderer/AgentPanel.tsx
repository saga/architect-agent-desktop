import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dropdown, Popconfirm, Tag, message, Tooltip } from "antd";
import { AppstoreOutlined, CameraOutlined, DeleteOutlined, FolderOpenOutlined, SettingOutlined } from "@ant-design/icons";
import { Bubble, Sender } from "@ant-design/x";
import XMarkdown from "@ant-design/x-markdown";
import type { AgentSessionItem, AgentSettings, CopilotEvent, WorkspaceProject } from "../shared/types";

type ChatItem = AgentSessionItem & { streaming?: boolean };
const EMPTY_SETTINGS: AgentSettings = { provider: "copilot", copilotModel: "", codebuddyModel: "", thinkingLevel: "medium", toolPermission: "browser-only", systemPrompt: "" };
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

function ToolCard({ name, detail, state }: { name: string; detail: string; state: "done" | "error" }) {
  const failed = state === "error";
  return <div className={"agent-tool-card" + (failed ? " is-error" : "")}>
    <div className="agent-tool-head">
      <span className="agent-tool-icon" aria-hidden>{failed ? "!" : "✓"}</span>
      <strong className="agent-tool-name">{name}</strong>
      <span className="agent-tool-state">{failed ? "失败" : "完成"}</span>
    </div>
    {detail.trim() && <pre className="agent-tool-detail">{detail.trim()}</pre>}
  </div>;
}

function MarkdownLink(props: any) {
  const href = typeof props.href === "string" ? props.href : "";
  return <a href={href} title={typeof props.title === "string" ? props.title : undefined}
    onClick={(event) => {
      if (!href) return;
      event.preventDefault();
      if (href.startsWith("#")) {
        document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      void (typeof window.browser.openExternal === "function" ? window.browser.openExternal(href) : Promise.resolve()).catch(() => undefined);
    }}>{props.children}</a>;
}

const markdownComponents = { a: MarkdownLink };

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
  tool: (data: any) => ({
    placement: "start" as const,
    variant: "borderless" as const,
    shape: "corner" as const,
    contentRender: () => <ToolCard
      name={String(data.extraInfo?.toolName ?? "Tool")}
      detail={String(data.content ?? "")}
      state={data.extraInfo?.toolState === "error" ? "error" : "done"}
    />,
  }),
  error: {
    placement: "start" as const,
    variant: "borderless" as const,
    shape: "corner" as const,
    contentRender: (content: string) => <Alert className="agent-error-card" type="error" showIcon message="请求失败" description={content} />,
  },
};

export default function AgentPanel({ onClose, onDock, onFloat, onDragState, onMaximize, onRestore, onGroupWithBrowser, snapshotMode, onToggleSnapshot }: { onClose: () => void; onDock: (position: "left" | "right" | "top" | "bottom") => void; onFloat?: () => void; onDragState?: (active: boolean) => void; onMaximize?: () => void; onRestore?: () => void; onGroupWithBrowser?: () => void; snapshotMode?: boolean; onToggleSnapshot?: () => void }) {
  const [status, setStatus] = useState("checking");
  const [statusMessage, setStatusMessage] = useState("");
  const [settings, setSettings] = useState<AgentSettings>(EMPTY_SETTINGS);
  const [workspaceProject, setWorkspaceProject] = useState<WorkspaceProject>({ path: null, name: null });

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const latestItems = useRef<ChatItem[]>([]);
  const sessionReadyRef = useRef(false);

  const refreshStatus = async () => {
    const result = await window.browser.copilotStatus();
    setStatus(result.status);
    setStatusMessage(result.message ?? "");
  };

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    void window.browser.getWorkspaceProject().then((workspace) => { if (!cancelled) setWorkspaceProject(workspace); }).catch(() => undefined);
    const unsubscribeProject = window.browser.onWorkspaceProjectUpdated((workspace) => {
      setWorkspaceProject(workspace);
      void window.browser.agentLoadSession().then((saved) => { if (!cancelled) setItems(saved); }).catch(() => undefined);
    });
    void (async () => {
      try {
        if (typeof window.browser.agentLoadSession === "function") {
          const saved = await window.browser.agentLoadSession();
          if (!cancelled && saved.length) setItems(saved);
        }
      } catch {
        // A missing or unreadable session file starts an empty conversation.
      }
      if (cancelled) return;
      setSessionReady(true);
      const off = window.browser.onCopilotEvent((event: CopilotEvent) => {
        if (event.type === "status" && event.status) setStatus(event.status);
        if (event.type === "delta" && event.text) setItems((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.kind === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + event.text };
          } else {
            next.push({ id: crypto.randomUUID(), kind: "assistant", content: event.text ?? "", createdAt: Date.now(), streaming: true });
          }
          return next;
        });
        if (event.type === "message" && event.text) setItems((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.kind === "assistant") {
            next[next.length - 1] = { ...last, content: event.text ?? last.content, streaming: false };
          } else {
            next.push({ id: crypto.randomUUID(), kind: "assistant", content: event.text ?? "", createdAt: Date.now() });
          }
          return next;
        });
        if (event.type === "tool") setItems((current) => [...current, {
          id: crypto.randomUUID(),
          kind: "tool",
          content: event.toolDetail ?? "",
          toolName: event.toolName ?? "Tool",
          toolState: event.toolState === "error" ? "error" : "done",
          createdAt: Date.now(),
        }]);
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
  }, []);

  useEffect(() => {
    if (!sessionReady || typeof window.browser.agentSaveSession !== "function") return;
    const timer = setTimeout(() => {
      void window.browser.agentSaveSession(toSessionItems(items)).catch(() => undefined);
    }, SESSION_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, sessionReady]);

  useEffect(() => { latestItems.current = items; }, [items]);
  useEffect(() => { sessionReadyRef.current = sessionReady; }, [sessionReady]);
  useEffect(() => () => {
    if (!sessionReadyRef.current || typeof window.browser.agentSaveSession !== "function") return;
    void window.browser.agentSaveSession(toSessionItems(latestItems.current)).catch(() => undefined);
  }, []);

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

  const clearSession = async () => {
    try {
      if (typeof window.browser.agentClearSession === "function") await window.browser.agentClearSession();
      setItems([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const send = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    const history = items
      .filter((item) => (item.kind === "user" || item.kind === "assistant") && !item.streaming && item.content.trim())
      .slice(-12)
      .map((item) => ({ role: item.kind as "user" | "assistant", content: item.content.trim().slice(0, 6000) }));
    setItems((current) => [...current, { id: crypto.randomUUID(), kind: "user", content: prompt, createdAt: Date.now() }]);
    setLoading(true);
    try { await window.browser.copilotSend(prompt, history); }
    catch (error) { setLoading(false); message.error(error instanceof Error ? error.message : String(error)); }
  };

  const providerName = settings.provider === "copilot" ? "GitHub Copilot CLI" : "CodeBuddy CLI";
  const modelName = settings.provider === "copilot" ? settings.copilotModel : settings.codebuddyModel;

  const subtitle = [providerName, modelName || "使用 CLI 默认模型", `${settings.thinkingLevel} thinking`].join(" · ");
  const fileAccess = settings.toolPermission === "browser-only" ? "文件访问关闭" : settings.toolPermission === "assisted" ? "只读" : "可读写";
  const workspaceLabel = workspaceProject.name ? "工作区：" + workspaceProject.name + " · " + fileAccess : "未选择工作区 · 选择项目目录";
  const dockItems = [
    { key: "left", label: "靠左停靠" },
    { key: "right", label: "靠右停靠" },
    { key: "top", label: "靠上停靠" },
    { key: "bottom", label: "靠下停靠" },
    ...(onGroupWithBrowser ? [{ type: "divider" as const }, { key: "group", label: "与浏览器合并为标签组" }] : []),
  ];

  return <aside className="agent-panel">
    <header className="agent-panel-header">
      <div
        className="agent-panel-heading"
        draggable
        onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "agent-panel"); onDragState?.(true); }}
        onDragEnd={() => onDragState?.(false)}
      >
        <strong className="agent-panel-title">Browser Agent</strong>
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
        <Tag className="agent-status-tag" color={status === "ready" ? "success" : "default"}>{status}</Tag>
        <Popconfirm title="清空当前会话？" description="本地保存的 Agent 对话记录会被删除。" okText="清空" cancelText="取消" onConfirm={() => void clearSession()}>
          <Tooltip title="清空会话"><Button type="text" size="small" aria-label="清空会话" icon={<DeleteOutlined />} /></Tooltip>
        </Popconfirm>
        {onToggleSnapshot && <Tooltip title={snapshotMode ? "返回实时页面" : "冻结当前页面快照"}>
          <Button type={snapshotMode ? "primary" : "text"} size="small" aria-label={snapshotMode ? "返回实时页面" : "冻结当前页面快照"} icon={<CameraOutlined />} onClick={onToggleSnapshot} />
        </Tooltip>}
        <Tooltip title="选择停靠位置">
          <Dropdown trigger={["click"]} menu={{ items: dockItems, onClick: ({ key }) => {
            if (key === "group") { onGroupWithBrowser?.(); return; }
            onDock(key as "left" | "right" | "top" | "bottom");
          } }} placement="bottomRight">
            <Button type="text" size="small" aria-label="选择停靠位置" icon={<AppstoreOutlined />} />
          </Dropdown>
        </Tooltip>
        {onMaximize && <Tooltip title="最大化到工作区"><Button type="text" size="small" onClick={onMaximize}>□</Button></Tooltip>}
        {onRestore && <Tooltip title="恢复分栏布局"><Button type="text" size="small" onClick={onRestore}>▣</Button></Tooltip>}
        {onFloat && <Tooltip title="浮动为独立窗口"><Button type="text" size="small" onClick={onFloat}>↗</Button></Tooltip>}
        <Tooltip title="Agent 配置"><Button type="text" size="small" icon={<SettingOutlined />} onClick={() => void openSettings()} /></Tooltip>
        <Tooltip title="关闭面板"><Button type="text" size="small" onClick={onClose}>×</Button></Tooltip>
      </div>
    </header>
    {status === "error" && settings.provider === "copilot" && <Alert type="error" showIcon message="GitHub Copilot Agent 初始化失败" description={<div>{statusMessage}<p>这通常是 SDK 配置或运行时问题，不代表 CLI 一定未登录。请检查应用版本和运行日志。</p></div>} />}
    {status === "unauthenticated" && settings.provider === "copilot" && <Alert type="warning" showIcon message="尚未完成 GitHub Copilot CLI 登录" description={<div>{statusMessage && <p>{statusMessage}</p>}本应用调用本机 Copilot CLI 凭据，不会自动复用 VS Code 扩展登录状态。<ol><li>打开 macOS「终端」应用。</li><li>运行 <code>copilot login</code>。如果提示找不到命令，先运行 <code>brew install --cask copilot-cli</code> 安装。</li><li>选择 GitHub.com，再选择浏览器登录。</li><li>在浏览器中登录正确的 GitHub 账号，并授权 GitHub Copilot CLI。</li><li>看到终端提示登录成功后，回到本应用发送消息。</li></ol>也可以运行 <code>copilot</code> 进入交互界面后输入 <code>/login</code>；使用 <code>/user</code> 检查账号。</div>} />}
    {settings.provider === "codebuddy" && status !== "ready" && <Alert type="info" showIcon message="CodeBuddy 使用本机 CLI 登录态" description={<div>在系统终端运行 <code>codebuddy</code>，按 CLI 提示完成登录，并确认账号有可用模型权限。首次请求会实际验证认证和模型可用性。</div>} />}
    <div className="agent-messages">
      <Bubble.List role={bubbleRoles} autoScroll items={items.map((item) => ({
        key: item.id,
        role: item.kind === "tool" ? "tool" : item.kind === "error" ? "error" : item.kind,
        content: item.content,
        extraInfo: { toolName: item.toolName, toolState: item.toolState, streaming: item.streaming === true },
        loading: item.streaming && !item.content,
      }))} />
    </div>
    <div className="agent-composer">
      <Sender rootClassName="agent-sender" value={input} onChange={setInput}
        onSubmit={(value) => { setInput(""); void send(value); }}
        onCancel={() => void window.browser.copilotCancel()}
        loading={loading} autoSize={{ minRows: 1, maxRows: 6 }}
        placeholder={"使用 " + (settings.provider === "copilot" ? "GitHub Copilot" : "CodeBuddy") + " 询问页面或操作当前网页…"} />
      <div className="agent-composer-hint">Enter 发送 · Shift + Enter 换行</div>
    </div>
  </aside>;
}
