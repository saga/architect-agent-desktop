import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, Select, Spin, message } from "antd";
import type { AgentModelInfo, AgentProvider, AgentSettings } from "../shared/types";

const DEFAULT_SETTINGS: AgentSettings = {
  provider: "copilot", copilotModel: "", codebuddyModel: "",
  thinkingLevel: "medium", systemPrompt: "",
};

export default function AgentSettingsWindow() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspectError, setInspectError] = useState("");

  const selectedId = settings.provider === "copilot" ? settings.copilotModel : settings.codebuddyModel;
  const selectedModel = useMemo(() => models.find(model => model.id === selectedId), [models, selectedId]);

  const inspect = useCallback(async (provider: AgentProvider) => {
    setInspecting(true);
    setInspectError("");
    try {
      const result = await window.browser.agentInspectModels(provider);
      setModels(result);
      if (!result.length) setInspectError(provider === "codebuddy"
        ? "未发现 CodeBuddy 模型。请先登录并启动 CodeBuddy，确认本机模型目录可用。"
        : "Copilot 没有返回可用模型，请检查 GitHub Copilot 登录状态。");
    } catch (error) {
      setModels([]);
      setInspectError(error instanceof Error ? error.message : String(error));
    } finally {
      setInspecting(false);
    }
  }, []);

  useEffect(() => {
    void window.browser.agentGetSettings()
      .then(async value => { setSettings(value); await inspect(value.provider); })
      .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [inspect]);

  const update = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setSettings(current => ({ ...current, [key]: value }));

  const changeProvider = async (provider: AgentProvider) => {
    setSettings(current => ({ ...current, provider, contextWindow: undefined }));
    await inspect(provider);
  };

  const changeModel = (modelId: string) => {
    update(settings.provider === "copilot" ? "copilotModel" : "codebuddyModel", modelId);
    update("contextWindow", undefined);
    const model = models.find(item => item.id === modelId);
    if (model?.effortOptions?.length && !model.effortOptions.includes(settings.thinkingLevel)) {
      update("thinkingLevel", model.effortOptions.includes("medium") ? "medium" : model.effortOptions[0] as AgentSettings["thinkingLevel"]);
    }
  };

  const save = async () => {
    setSaving(true);
    try { await window.browser.agentSaveSettings(settings); window.close(); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="settings-window-loading"><Spin /></main>;

  return <main className="settings-window">
    <header className="settings-window-header">
      <div><h1>Agent 配置</h1><p>选择 Provider，并读取当前账号可用模型及其能力选项</p></div>
    </header>
    <section className="settings-window-content">
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="默认 Provider">
          <Select value={settings.provider} onChange={(value: AgentProvider) => void changeProvider(value)} options={[
            { label: "GitHub Copilot", value: "copilot" },
            { label: "CodeBuddy", value: "codebuddy" },
          ]} />
        </Form.Item>
        <Form.Item label="模型">
          <Select showSearch optionFilterProp="label" value={selectedId || undefined}
            placeholder={inspecting ? "正在读取模型…" : "选择模型"}
            loading={inspecting} disabled={inspecting || models.length === 0}
            onChange={changeModel}
            options={[
              ...(selectedId && !models.some(model => model.id === selectedId) ? [{ label: selectedId + "（已保存，当前目录未发现）", value: selectedId }] : []),
              ...models.map(model => ({ label: model.name === model.id ? model.id : model.name + " · " + model.id, value: model.id })),
            ]} />
          <div className="settings-field-help">
            <Button type="link" size="small" loading={inspecting} onClick={() => void inspect(settings.provider)}>重新 Inspect 模型</Button>
            {inspectError && <span>{inspectError}</span>}
          </div>
        </Form.Item>
        {selectedModel?.effortOptions && selectedModel.effortOptions.length > 0 && <Form.Item label="推理强度（模型能力）">
          <Select value={selectedModel.effortOptions.includes(settings.thinkingLevel) ? settings.thinkingLevel : selectedModel.effortOptions[0] as AgentSettings["thinkingLevel"]}
            onChange={(value: AgentSettings["thinkingLevel"]) => update("thinkingLevel", value)}
            options={selectedModel.effortOptions.map(value => ({ label: value.toUpperCase(), value }))} />
        </Form.Item>}
        {selectedModel?.contextWindowOptions && <Form.Item label="Context Window">
          <Select allowClear value={settings.contextWindow}
            placeholder="使用模型默认档位"
            onChange={(value?: number) => update("contextWindow", value)}
            options={selectedModel.contextWindowOptions.map(option => ({ label: option.label, value: option.value }))} />
          <div className="settings-field-help">只展示模型元数据明确声明且通过物理输入上限校验的档位。</div>
        </Form.Item>}
        <Form.Item label="System Prompt">
          <Input.TextArea value={settings.systemPrompt} onChange={event => update("systemPrompt", event.target.value)}
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
