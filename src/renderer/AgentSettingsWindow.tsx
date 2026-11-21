import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Input, Radio, Select, Spin, message, List, Switch, Popconfirm, Tag, Divider, Space } from "antd";
import { ApiOutlined, AppstoreOutlined, CodeOutlined, DatabaseOutlined, SettingOutlined } from "@ant-design/icons";
import MemoryManager from "./MemoryManager";
import { AgentSkillsPanel, McpSettingsPanel } from "./AgentExtensionsSettings";
import type { AgentModelInfo, AgentProvider, AgentSettings, AgentToolPermission, PluginSummary } from "../shared/types";

const DEFAULT_SETTINGS: AgentSettings = {
  provider: "copilot", copilotModel: "", codebuddyModel: "",
  thinkingLevel: "medium", toolPermission: "none", memoryEmbeddingProvider: "disabled", memoryEmbeddingBaseUrl: "http://127.0.0.1:11434", memoryEmbeddingModel: "nomic-embed-text", systemPrompt: "",
};

export default function AgentSettingsWindow() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [activeSection, setActiveSection] = useState<"agent" | "mcp" | "skills" | "memory" | "plugins">("agent");
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [embeddingChecking, setEmbeddingChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [agentDataDirectory, setAgentDataDirectory] = useState("");
  const [changingDataDirectory, setChangingDataDirectory] = useState(false);

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

  const refreshPlugins = useCallback(async () => {
    setPluginsLoading(true);
    try { setPlugins(await window.browser.pluginList()); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setPluginsLoading(false); }
  }, []);

  useEffect(() => {
    void refreshPlugins();
    void window.browser.agentDataGetDirectory().then(setAgentDataDirectory).catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)));
    void window.browser.agentGetSettings()
      .then(value => { setSettings(value); setModels([]); })
      .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [inspect, refreshPlugins]);

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

  const importPlugin = async () => {
    setPluginBusy(true);
    try {
      const plugin = await window.browser.pluginImport();
      if (plugin) { message.success("已导入插件：" + plugin.name); await refreshPlugins(); }
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setPluginBusy(false); }
  };

  const togglePlugin = async (plugin: PluginSummary, enabled: boolean) => {
    try { setPlugins(await window.browser.pluginSetEnabled(plugin.id, enabled)); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const exportPlugin = async (plugin: PluginSummary) => {
    setPluginBusy(true);
    try {
      const destination = await window.browser.pluginExport(plugin.id);
      if (destination) message.success("插件已导出到：" + destination);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setPluginBusy(false); }
  };

  const removePlugin = async (plugin: PluginSummary) => {
    try {
      setPlugins(await window.browser.pluginRemove(plugin.id));
      message.success("已删除插件：" + plugin.name);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };

  const chooseAgentDataDirectory = async () => {
    setChangingDataDirectory(true);
    try { setAgentDataDirectory(await window.browser.agentDataSelectDirectory()); message.success("Agent Data 目录已切换。新事件将写入新目录，旧目录中的记录不会移动。"); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setChangingDataDirectory(false); }
  };

  const checkMemoryEmbedding = async () => {
    setEmbeddingChecking(true);
    try {
      const result = await window.browser.agentMemoryCheckEmbedding({
        provider: "ollama",
        baseUrl: settings.memoryEmbeddingBaseUrl,
        model: settings.memoryEmbeddingModel,
      });
      message.success("本机 Ollama 连接正常：" + result.model + " · " + result.dimensions + " 维向量。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setEmbeddingChecking(false);
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
      <div><h1>Settings</h1><p>管理 Agent、MCP Servers、Agent Skills 和插件</p></div>
    </header>
    <section className="settings-window-content">
      <div className="settings-layout">
        <nav className="settings-sidebar" aria-label="配置分类">
          <div className="settings-sidebar-label">WORKSPACE</div>
          <Button type="text" className={"settings-nav-item" + (activeSection === "agent" ? " active" : "")} icon={<SettingOutlined />} onClick={() => setActiveSection("agent")}>Agent</Button>
          <Button type="text" className={"settings-nav-item" + (activeSection === "mcp" ? " active" : "")} icon={<ApiOutlined />} onClick={() => setActiveSection("mcp")}>MCP Servers</Button>
          <Button type="text" className={"settings-nav-item" + (activeSection === "skills" ? " active" : "")} icon={<CodeOutlined />} onClick={() => setActiveSection("skills")}>Agent Skills</Button>
          <Button type="text" className={"settings-nav-item" + (activeSection === "memory" ? " active" : "")} icon={<DatabaseOutlined />} onClick={() => setActiveSection("memory")}>Memory & Dreaming</Button>
          <div className="settings-sidebar-label settings-sidebar-label-spaced">EXTENSIONS</div>
          <Button type="text" className={"settings-nav-item" + (activeSection === "plugins" ? " active" : "")} icon={<AppstoreOutlined />} onClick={() => setActiveSection("plugins")}>Plugins</Button>
        </nav>
        <div className="settings-main">
          {activeSection === "agent" && <>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="默认 Provider">
          <Select value={settings.provider} onChange={(value: AgentProvider) => void changeProvider(value)} options={[
            { label: "GitHub Copilot", value: "copilot" },
            { label: "CodeBuddy", value: "codebuddy" },
          ]} />
        </Form.Item>
        <Form.Item label="工具权限">
          <Radio.Group className="agent-tool-permission" value={settings.toolPermission}
            onChange={(event) => update("toolPermission", event.target.value as AgentToolPermission)}>
            <Radio value="none">
              <span className="tool-permission-title">No tools</span>
              <span className="tool-permission-desc">默认禁止浏览器、本机文件、命令、MCP 等所有工具；需要时再按需开启。</span>
            </Radio>
            <Radio value="browser-only">
              <span className="tool-permission-title">仅浏览器工具</span>
              <span className="tool-permission-desc">只能读写当前网页，不能调用本机命令、文件或网络工具。</span>
            </Radio>
            <Radio value="assisted">
              <span className="tool-permission-title">辅助权限</span>
              <span className="tool-permission-desc">允许只读工具查看上下文；危险工具仍被禁用。</span>
            </Radio>
            <Radio value="allow-all">
              <span className="tool-permission-title">Allow all</span>
              <span className="tool-permission-desc">不询问，允许所有工具调用，包括本机命令、文件修改和网页 JS/CSS 注入。仅在你信任请求时使用。</span>
            </Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="模型">
          <Select showSearch optionFilterProp="label" value={selectedId || undefined}
            placeholder={inspecting ? "正在读取模型…" : "选择模型"}
            loading={inspecting} disabled={inspecting || models.length === 0}
            onChange={changeModel}
            options={[
              ...(selectedId && !models.some(model => model.id === selectedId) ? [{ label: selectedId + "（已保存，当前目录未发现）", value: selectedId }] : []),
              ...models.map(model => {
                const rate = model.credits === undefined ? "" : model.credits === 0 ? " · 免费" : " · x" + model.credits + " credits";
                const label = (model.name === model.id ? model.id : model.name + " · " + model.id) + rate;
                return { label, value: model.id };
              }),
            ]} />
          <div className="settings-field-help">
            <Button type="link" size="small" loading={inspecting} onClick={() => void inspect(settings.provider)}>Inspect / 刷新模型</Button>
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
        <Divider />
        <Form.Item label="Memory 语义检索">
          <Radio.Group value={settings.memoryEmbeddingProvider}
            onChange={event => update("memoryEmbeddingProvider", event.target.value as AgentSettings["memoryEmbeddingProvider"])}>
            <Radio value="disabled">关闭（仅使用 FTS5/关键词检索）</Radio>
            <Radio value="ollama">本机 Ollama Embedding</Radio>
          </Radio.Group>
          <div className="settings-field-help">开启后，Memory Search 使用本机向量 + FTS5 混合召回。仅允许访问 localhost / 127.0.0.1 / ::1；不支持远程 Embedding 服务。需先在本机安装并启动 Ollama，下载所选 Embedding 模型。</div>
        </Form.Item>
        {settings.memoryEmbeddingProvider === "ollama" && <>
          <Form.Item label="Ollama 本机地址">
            <Input value={settings.memoryEmbeddingBaseUrl} onChange={event => update("memoryEmbeddingBaseUrl", event.target.value)}
              maxLength={300} placeholder="http://127.0.0.1:11434" />
            <div className="settings-field-help">地址必须指向本机回环接口。远程主机、代理地址和带凭据 URL 会被拒绝。</div>
          </Form.Item>
          <Form.Item label="Embedding 模型">
            <Input value={settings.memoryEmbeddingModel} onChange={event => update("memoryEmbeddingModel", event.target.value)}
              maxLength={120} placeholder="nomic-embed-text" />
            <div className="settings-field-help">例如 nomic-embed-text。请确保该模型已在 Ollama 中下载；更换模型后需要重新建立索引。</div>
            <Button size="small" loading={embeddingChecking} disabled={embeddingChecking || !settings.memoryEmbeddingModel.trim()}
              onClick={() => void checkMemoryEmbedding()}>测试本机连接与模型</Button>
          </Form.Item>
        </>}
      </Form>
      <Divider />
      <section className="plugin-manager">
        <div className="plugin-manager-heading">
          <div>
            <h2>Agent Data</h2>
            <p>保存 Session 快照、模型运行事件和工具调用记录。默认位于应用数据目录下的 agent-data，可切换到其他本地目录。</p>
            <div className="settings-field-help">{agentDataDirectory || "正在读取目录…"}</div>
          </div>
          <Button loading={changingDataDirectory} onClick={() => void chooseAgentDataDirectory()}>更改数据目录</Button>
        </div>
      </section>
      </>}
      {activeSection === "mcp" && <McpSettingsPanel />}
      {activeSection === "skills" && <AgentSkillsPanel />}
      {activeSection === "memory" && <MemoryManager />}
      {activeSection === "plugins" && <section className="plugin-manager">
        <div className="plugin-manager-heading">
          <div>
            <h2>Claude Code Plugins</h2>
            <p>插件目录采用 Claude Code Plugin 约定：通常包含 .claude-plugin/plugin.json，组件放在 skills/、commands/ 和 agents/；标准允许省略 manifest。</p>
          </div>
          <Space wrap>
            <Button onClick={() => void window.browser.openExternal("https://claude.com/marketplace/plugins")}>浏览 Claude Marketplace</Button>
            <Button type="primary" loading={pluginBusy} onClick={() => void importPlugin()}>导入 Claude Plugin 目录</Button>
          </Space>
        </div>
        <Alert type="info" showIcon message="从 Claude Marketplace 获取插件"
          description="在 Claude Marketplace 中选择 Works with: Claude Code 的插件，获取其源码目录后导入。当前读取并加载 Markdown Skills、Commands 和 Agents；不会执行 Hooks、MCP/LSP 服务、Mod 或插件脚本。需要这些运行时能力的插件不会完整生效。" />
        <List
          loading={pluginsLoading}
          dataSource={plugins}
          locale={{ emptyText: "尚未安装插件。可从 Claude Marketplace 选择 Claude Code 插件后导入源码目录。" }}
          renderItem={(plugin) => <List.Item actions={[
            <Switch key="enabled" checked={plugin.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(value) => void togglePlugin(plugin, value)} />,
            <Button key="export" size="small" disabled={pluginBusy} onClick={() => void exportPlugin(plugin)}>导出</Button>,
            <Popconfirm key="remove" title="删除此插件？" description="插件目录和本地启用状态将被删除。" okText="删除" cancelText="取消" onConfirm={() => void removePlugin(plugin)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          ]}>
            <List.Item.Meta
              title={<Space wrap><span>{plugin.name}</span><Tag>{plugin.version}</Tag>{plugin.sourceFormat === "claude-code" && <Tag color="geekblue">Claude Code Plugin</Tag>}</Space>}
              description={<>
                <div>{plugin.description || plugin.id}</div>
                <div className="settings-field-help">Skills {plugin.skills.length} · Commands {plugin.commands.length + plugin.inlineCommands.length} · Agents {plugin.agents.length} · Tools {plugin.tools.length} · Workflows {plugin.workflows.length}</div>
              </>}
            />
          </List.Item>}
        />
      </section>}
        </div>
      </div>
    </section>
    <footer className="settings-window-footer">
      <Button onClick={() => window.close()}>关闭</Button>
      {activeSection === "agent" && <Button type="primary" loading={saving} onClick={() => void save()}>保存 Agent 配置</Button>}
    </footer>
  </main>;
}
