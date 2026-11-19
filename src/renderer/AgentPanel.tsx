import { useEffect, useState } from "react";
import { Alert, Button, Tag, message, Modal, Input, Select, Tooltip } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { Bubble, Sender } from "@ant-design/x";
import type { AgentProvider, AgentSettings, CopilotEvent } from "../shared/types";

type ChatItem = { key: string; role: "user" | "assistant"; content: string; loading?: boolean };
const EMPTY_SETTINGS: AgentSettings = { provider: "copilot", copilotModel: "", codebuddyModel: "", thinkingLevel: "medium", systemPrompt: "" };

export default function AgentPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState("checking");
  const [statusMessage, setStatusMessage] = useState("");
  const [settings, setSettings] = useState<AgentSettings>(EMPTY_SETTINGS);
  const [draft, setDraft] = useState<AgentSettings>(EMPTY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);

  const refreshStatus = async () => {
    const result = await window.browser.copilotStatus();
    setStatus(result.status);
    setStatusMessage(result.message ?? "");
  };

  useEffect(() => {
    void Promise.all([window.browser.agentGetSettings(), window.browser.copilotStatus()])
      .then(([saved, result]) => { setSettings(saved); setDraft(saved); setStatus(result.status); setStatusMessage(result.message ?? ""); })
      .catch(() => setStatus("error"));
    const unsubscribe = window.browser.onCopilotEvent((event: CopilotEvent) => {
      if (event.type === "status" && event.status) setStatus(event.status);
      if (event.type === "delta" && event.text) setItems((current) => {
        const next = [...current]; const last = next[next.length - 1];
        if (last?.role === "assistant" && last.loading) last.content += event.text;
        else next.push({ key: crypto.randomUUID(), role: "assistant", content: event.text ?? "", loading: true });
        return next;
      });
      if (event.type === "message" && event.text) setItems((current) => {
        const next = [...current]; const last = next[next.length - 1];
        if (last?.role === "assistant") { last.content = event.text ?? last.content; last.loading = false; }
        else next.push({ key: crypto.randomUUID(), role: "assistant", content: event.text ?? "" });
        return next;
      });
      if (event.type === "tool" && event.text) setItems((current) => [...current, { key: crypto.randomUUID(), role: "assistant", content: "工具执行：" + event.text }]);
      if (event.type === "done") {
        setLoading(false); setStatus("ready");
        setItems((current) => current.map((item) => item.loading ? { ...item, loading: false } : item));
      }
      if (event.type === "error") {
        setLoading(false); setStatus("error");
        setItems((current) => [...current, { key: crypto.randomUUID(), role: "assistant", content: event.text ?? "Request failed." }]);
      }
    });
    return unsubscribe;
  }, []);

  const openSettings = async () => {
    try { const saved = await window.browser.agentGetSettings(); setDraft(saved); setSettings(saved); setSettingsOpen(true); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const saveSettings = async () => {
    if (loading || saving) return;
    setSaving(true);
    try {
      const saved = await window.browser.agentSaveSettings(draft);
      setSettings(saved); setDraft(saved); setSettingsOpen(false); setItems([]);
      await refreshStatus();
      message.success("Agent 配置已保存");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  const send = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    setItems((current) => [...current, { key: crypto.randomUUID(), role: "user", content: prompt }]);
    setLoading(true);
    try { await window.browser.copilotSend(prompt); }
    catch (error) { setLoading(false); message.error(error instanceof Error ? error.message : String(error)); }
  };

  const providerName = settings.provider === "copilot" ? "GitHub Copilot CLI" : "CodeBuddy CLI";
  const modelName = settings.provider === "copilot" ? settings.copilotModel : settings.codebuddyModel;

  return <aside className="agent-panel">
    <header className="agent-panel-header">
      <div><strong>Browser Agent</strong><div className="agent-subtitle">{providerName} · {modelName || "使用 CLI 默认模型"} · {settings.thinkingLevel} thinking</div></div>
      <Tag color={status === "ready" ? "success" : "default"}>{status}</Tag>
      <Tooltip title="Agent 配置"><Button type="text" size="small" icon={<SettingOutlined />} onClick={() => void openSettings()} /></Tooltip>
      <Button type="text" size="small" onClick={onClose}>×</Button>
    </header>
    {status === "unauthenticated" && settings.provider === "copilot" && <Alert type="warning" showIcon message="尚未完成 GitHub Copilot CLI 登录" description={<div>{statusMessage && <p>{statusMessage}</p>}本应用调用本机 Copilot CLI 凭据，不会自动复用 VS Code 扩展登录状态。<ol><li>打开 macOS「终端」应用。</li><li>运行 <code>copilot login</code>。如果提示找不到命令，先运行 <code>brew install --cask copilot-cli</code> 安装。</li><li>选择 GitHub.com，再选择浏览器登录。</li><li>在浏览器中登录正确的 GitHub 账号，并授权 GitHub Copilot CLI。</li><li>看到终端提示登录成功后，回到本应用发送消息。</li></ol>也可以运行 <code>copilot</code> 进入交互界面后输入 <code>/login</code>；使用 <code>/user</code> 检查账号。</div>} />}
    {settings.provider === "codebuddy" && status !== "ready" && <Alert type="info" showIcon message="CodeBuddy 使用本机 CLI 登录态" description={<div>在系统终端运行 <code>codebuddy</code>，按 CLI 提示完成登录，并确认账号有可用模型权限。首次请求会实际验证认证和模型可用性。</div>} />}
    <div className="agent-messages">
      <Bubble.List items={items.map((item) => ({ key: item.key, role: item.role, content: item.content, loading: item.loading && !item.content }))} />
    </div>
    <Sender value={input} onChange={setInput} onSubmit={(value) => { setInput(""); void send(value); }} onCancel={() => void window.browser.copilotCancel()} loading={loading} placeholder={"使用 " + (settings.provider === "copilot" ? "GitHub Copilot" : "CodeBuddy") + " 询问页面或操作当前网页…"} />

    <Modal title="Agent 配置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={() => void saveSettings()} confirmLoading={saving} okText="保存配置" cancelText="取消" width={620} destroyOnHidden>
      <div className="agent-settings-form">
        <label>默认 Provider</label>
        <Select value={draft.provider} onChange={(value: AgentProvider) => setDraft((s) => ({ ...s, provider: value }))} options={[{ label: "GitHub Copilot CLI", value: "copilot" }, { label: "CodeBuddy CLI", value: "codebuddy" }]} />
        <label>{draft.provider === "copilot" ? "Copilot 模型" : "CodeBuddy 模型"}</label>
        <Input value={draft.provider === "copilot" ? draft.copilotModel : draft.codebuddyModel}
          onChange={(event) => setDraft((s) => draft.provider === "copilot" ? { ...s, copilotModel: event.target.value } : { ...s, codebuddyModel: event.target.value })}
          placeholder="留空表示使用 CLI 默认模型" maxLength={200} />
        <div className="agent-settings-help">填写 CLI 支持的模型 ID；留空时由对应 CLI 选择默认模型。</div>
        <label>Thinking Level</label>
        <Select value={draft.thinkingLevel} onChange={(value: AgentSettings["thinkingLevel"]) => setDraft((s) => ({ ...s, thinkingLevel: value }))} options={[{ label: "Low · 更快，适合简单操作", value: "low" }, { label: "Medium · 平衡", value: "medium" }, { label: "High · 更强推理，响应可能更慢", value: "high" }]} />
        <label>System Prompt</label>
        <Input.TextArea value={draft.systemPrompt} onChange={(event) => setDraft((s) => ({ ...s, systemPrompt: event.target.value }))} rows={8} maxLength={12000} showCount placeholder="补充 Agent 的角色、回答风格、工作约束等。浏览器安全规则仍由应用强制执行。" />
        <div className="agent-settings-help">自定义提示会追加到内置浏览器 Agent 指令之后。它不能覆盖应用强制执行的浏览器安全限制。配置保存在本机，不会上传。</div>
      </div>
    </Modal>
  </aside>;
}
