import { useEffect, useState } from "react";
import { Button, Form, Input, Select, Spin, message } from "antd";
import type { AgentSettings } from "../shared/types";

const DEFAULT_SETTINGS: AgentSettings = {
  provider: "copilot",
  copilotModel: "",
  codebuddyModel: "",
  thinkingLevel: "medium",
  systemPrompt: "",
};

export default function AgentSettingsWindow() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.browser.agentGetSettings()
      .then(setSettings)
      .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await window.browser.agentSaveSettings(settings);
      window.close();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="settings-window-loading"><Spin /></main>;

  return <main className="settings-window">
    <header className="settings-window-header">
      <div><h1>Agent 配置</h1><p>配置默认模型、推理强度和 Agent 行为</p></div>
    </header>
    <section className="settings-window-content">
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="默认 Provider">
          <Select value={settings.provider} onChange={(value: AgentSettings["provider"]) => update("provider", value)} options={[
            { label: "GitHub Copilot CLI", value: "copilot" },
            { label: "CodeBuddy CLI", value: "codebuddy" },
          ]} />
        </Form.Item>
        <Form.Item label={settings.provider === "copilot" ? "Copilot 模型" : "CodeBuddy 模型"}>
          <Input value={settings.provider === "copilot" ? settings.copilotModel : settings.codebuddyModel}
            onChange={(event) => update(settings.provider === "copilot" ? "copilotModel" : "codebuddyModel", event.target.value)}
            placeholder="留空表示使用 CLI 默认模型" maxLength={200} />
          <div className="settings-field-help">填写 CLI 支持的模型 ID；留空时使用对应 CLI 的默认模型。</div>
        </Form.Item>
        <Form.Item label="Thinking Level">
          <Select value={settings.thinkingLevel} onChange={(value: AgentSettings["thinkingLevel"]) => update("thinkingLevel", value)} options={[
            { label: "Low · 更快，适合简单操作", value: "low" },
            { label: "Medium · 平衡", value: "medium" },
            { label: "High · 更强推理，响应可能更慢", value: "high" },
          ]} />
        </Form.Item>
        <Form.Item label="System Prompt">
          <Input.TextArea value={settings.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)}
            rows={10} maxLength={12000} showCount
            placeholder="补充 Agent 的角色、回答风格、工作约束等。浏览器安全规则仍由应用强制执行。" />
          <div className="settings-field-help">自定义提示作为额外系统指令传入模型。应用强制执行的浏览器安全规则优先级更高。</div>
        </Form.Item>
      </Form>
    </section>
    <footer className="settings-window-footer">
      <Button onClick={() => window.close()}>取消</Button>
      <Button type="primary" loading={saving} onClick={() => void save()}>保存配置</Button>
    </footer>
  </main>;
}
