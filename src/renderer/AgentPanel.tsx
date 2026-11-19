import { useEffect, useState } from "react";
import { Alert, Button, Tag, message, Segmented } from "antd";
import { Bubble, Sender } from "@ant-design/x";
import type { AgentProvider, CopilotEvent } from "../shared/types";

type ChatItem = { key: string; role: "user" | "assistant"; content: string; loading?: boolean };

export default function AgentPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState("checking");
  const [statusMessage, setStatusMessage] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("copilot");
  const [switching, setSwitching] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);

  useEffect(() => {
    void window.browser.copilotStatus().then((result) => { setStatus(result.status); setStatusMessage(result.message ?? ""); setProvider(result.provider); }).catch(() => setStatus("error"));
    const unsubscribe = window.browser.onCopilotEvent((event: CopilotEvent) => {
      if (event.type === "status" && event.status) setStatus(event.status);
      if (event.type === "delta" && event.text) setItems((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.loading) last.content += event.text;
        else next.push({ key: crypto.randomUUID(), role: "assistant", content: event.text ?? "", loading: true });
        return next;
      });
      if (event.type === "message" && event.text) setItems((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.role === "assistant") { last.content = event.text ?? last.content; last.loading = false; }
        else next.push({ key: crypto.randomUUID(), role: "assistant", content: event.text ?? "" });
        return next;
      });
      if (event.type === "tool" && event.text) setItems((current) => [...current, { key: crypto.randomUUID(), role: "assistant", content: "工具执行：" + event.text }]);
      if (event.type === "done") {
        setLoading(false);
        setStatus("ready");
        setItems((current) => current.map((item) => item.loading ? { ...item, loading: false } : item));
      }
      if (event.type === "error") {
        setLoading(false);
        setItems((current) => [...current, { key: crypto.randomUUID(), role: "assistant", content: event.text ?? "Request failed." }]);
      }
    });
    return unsubscribe;
  }, []);

  const changeProvider = async (value: AgentProvider) => {
    if (loading || switching) return;
    setSwitching(true);
    try {
      await window.browser.agentSetProvider(value);
      setProvider(value);
      setItems([]);
      const result = await window.browser.copilotStatus();
      setStatus(result.status);
      setStatusMessage(result.message ?? "");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSwitching(false); }
  };

  const send = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    setItems((current) => [...current, { key: crypto.randomUUID(), role: "user", content: prompt }]);
    setLoading(true);
    try { await window.browser.copilotSend(prompt); }
    catch (error) { setLoading(false); message.error(error instanceof Error ? error.message : String(error)); }
  };

  return <aside className="agent-panel">
    <header className="agent-panel-header">
      <div><strong>Browser Agent</strong><div className="agent-subtitle">{provider === "copilot" ? "GitHub Copilot CLI" : "CodeBuddy CLI"} · 当前网页控制已启用</div></div>
      <Tag color={status === "ready" ? "success" : "default"}>{status}</Tag>
      <Button type="text" size="small" onClick={onClose}>×</Button>
    </header>
    <div className="agent-provider-switch"><span>模型提供方</span><Segmented block disabled={loading || switching} value={provider} options={[{ label: "GitHub Copilot", value: "copilot" }, { label: "CodeBuddy", value: "codebuddy" }]} onChange={(value) => void changeProvider(value as AgentProvider)} /></div>
    {status === "unauthenticated" && provider === "copilot" && <Alert type="warning" showIcon message="尚未完成 GitHub Copilot CLI 登录" description={<div>{statusMessage && <p>{statusMessage}</p>}本应用调用本机 Copilot CLI 凭据，不会自动复用 VS Code 扩展登录状态。<ol><li>打开 macOS「终端」应用。</li><li>运行 <code>copilot login</code>。如果提示找不到命令，先运行 <code>brew install --cask copilot-cli</code> 安装。</li><li>选择 GitHub.com，再选择浏览器登录。</li><li>在浏览器中登录正确的 GitHub 账号，并授权 GitHub Copilot CLI。</li><li>看到终端提示登录成功后，回到本应用发送消息。</li></ol>也可以运行 <code>copilot</code> 进入交互界面，再输入 <code>/login</code>。检查账号可在 CLI 中输入 <code>/user</code>。</div>} />}
    {provider === "codebuddy" && <Alert type="info" showIcon message="CodeBuddy 使用本机 CLI 登录态" description={<div>在系统终端运行 <code>codebuddy</code>，按 CLI 提示完成登录，并确认账号有可用模型权限。CodeBuddy SDK 会复用 CLI 登录凭据。登录后回到这里发送消息；首次请求会实际验证认证和模型可用性。</div>} />}
    <div className="agent-messages">
      <Bubble.List items={items.map((item) => ({ key: item.key, role: item.role, content: item.content, loading: item.loading && !item.content }))} />
    </div>
    <Sender value={input} onChange={setInput} onSubmit={(value) => { setInput(""); void send(value); }} onCancel={() => void window.browser.copilotCancel()} loading={loading} placeholder={"使用 " + (provider === "copilot" ? "GitHub Copilot" : "CodeBuddy") + " 询问页面或操作当前网页…"} />
  </aside>;
}
