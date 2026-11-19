import { useEffect, useState } from "react";
import { Alert, Button, Tag, message } from "antd";
import { Bubble, Sender } from "@ant-design/x";
import type { CopilotEvent } from "../shared/types";

type ChatItem = { key: string; role: "user" | "assistant"; content: string; loading?: boolean };

export default function AgentPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState("checking");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);

  useEffect(() => {
    void window.browser.copilotStatus().then((result) => setStatus(result.status)).catch(() => setStatus("error"));
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
      if (event.type === "tool" && event.text) setItems((current) => [...current, { key: crypto.randomUUID(), role: "assistant", content: "工具执行：" + event.text }]);\n      if (event.type === "done") {
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
      <div><strong>Copilot Agent</strong><div className="agent-subtitle">Copilot · 当前网页控制已启用</div></div>
      <Tag color={status === "ready" ? "success" : "default"}>{status}</Tag>
      <Button type="text" size="small" onClick={onClose}>×</Button>
    </header>
    {status === "unauthenticated" && <Alert type="info" showIcon message="需要登录 Copilot CLI" description="SDK 默认使用 Copilot CLI 的系统密钥链凭据。仅登录 VS Code 并不会自动提供 SDK 凭据；请先完成 Copilot CLI 登录。" />}
    <div className="agent-messages">
      <Bubble.List items={items.map((item) => ({ key: item.key, role: item.role, content: item.content, loading: item.loading && !item.content }))} />
    </div>
    <Sender value={input} onChange={setInput} onSubmit={(value) => { setInput(""); void send(value); }} onCancel={() => void window.browser.copilotCancel()} loading={loading} placeholder="询问页面内容，或让 AI 操作当前网页…" />
  </aside>;
}
