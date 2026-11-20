import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Popconfirm, Radio, Select, message } from "antd";
import { DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import type { AgentExpert, AgentToolPermission, PluginSummary } from "../shared/types";

const TOOL_GROUPS: Array<{ label: string; tools: string[] }> = [
  { label: "浏览器", tools: ["browser_get_current_page", "browser_snapshot", "browser_screenshot", "browser_console", "browser_list_tabs", "browser_navigate", "browser_open_tab", "browser_switch_tab", "browser_click", "browser_fill", "browser_scroll"] },
  { label: "工作区（只读）", tools: ["workspace_list_files", "workspace_read_file", "workspace_search_files"] },
  { label: "工作区（写入）", tools: ["workspace_write_file"] },
  { label: "页面增强", tools: ["browser_execute_javascript", "browser_inject_css", "browser_cdp"] },
  { label: "Code Mode", tools: ["execute_code"] },
];

const EMPTY_EXPERT: Omit<AgentExpert, "createdAt" | "updatedAt"> = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  toolPermission: "assisted",
  skills: [],
  tools: [],
};

interface ExpertManagerProps { onChanged: () => void; }

export default function ExpertManager({ onChanged }: ExpertManagerProps) {
  const [experts, setExperts] = useState<AgentExpert[]>([]);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_EXPERT);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try {
      const snapshot = await window.browser.getAgentWorkspaceSnapshot();
      setExperts(snapshot.experts);
      setSelectedId(current => current && snapshot.experts.some(item => item.id === current) ? current : snapshot.experts[0]?.id ?? null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([window.browser.getAgentWorkspaceSnapshot(), window.browser.pluginList()])
      .then(([snapshot, installed]) => {
        if (!active) return;
        setExperts(snapshot.experts);
        setPlugins(installed.filter(plugin => plugin.enabled));
        setSelectedId(snapshot.experts[0]?.id ?? null);
      })
      .catch(error => message.error(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (creating) return;
    const selected = experts.find(item => item.id === selectedId);
    if (selected) {
      const { createdAt: _createdAt, updatedAt: _updatedAt, ...values } = selected;
      setDraft(values);
    }
  }, [experts, selectedId, creating]);

  const startCreate = () => {
    setCreating(true);
    setSelectedId(null);
    setDraft({ ...EMPTY_EXPERT });
  };

  const update = <K extends keyof typeof EMPTY_EXPERT>(key: K, value: (typeof EMPTY_EXPERT)[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!draft.name.trim()) {
      message.warning("请填写 Expert 名称。");
      return;
    }
    if (!draft.systemPrompt.trim()) {
      message.warning("请填写 Expert 的角色指令。");
      return;
    }
    const id = draft.id.trim() || draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
    setSaving(true);
    try {
      const updated = await window.browser.saveAgentExpert({ ...draft, id });
      setExperts(updated);
      setSelectedId(id);
      setCreating(false);
      await refresh();
      onChanged();
      message.success("Expert 已保存。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (expert: AgentExpert) => {
    try {
      const updated = await window.browser.deleteAgentExpert(expert.id);
      setExperts(updated);
      setSelectedId(updated[0]?.id ?? null);
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleValue = (key: "skills" | "tools", value: string, checked: boolean) => {
    update(key, checked ? [...draft[key], value] : draft[key].filter(item => item !== value));
  };

  const toolOptions = TOOL_GROUPS.flatMap(group => group.tools).map(tool => ({ label: tool, value: tool }));
  const skillOptions = plugins.flatMap(plugin => plugin.skills.map(skill => ({
    label: plugin.name + " / " + skill,
    value: plugin.id + ":" + skill,
  })));

  return <section className="pure-management-page">
    <header className="pure-page-heading">
      <div>
        <div className="pure-page-eyebrow"><TeamOutlined /> AGENT PERSONAS</div>
        <h1>Expert</h1>
        <p>定义专业角色、系统指令、权限上限，以及可使用的 Skills 和 Tools。</p>
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>New Expert</Button>
    </header>

    <div className="pure-expert-layout">
      <aside className="pure-expert-list">
        {experts.map(expert => <button type="button" key={expert.id}
          className={"pure-expert-item" + (!creating && expert.id === selectedId ? " active" : "")}
          onClick={() => { setCreating(false); setSelectedId(expert.id); }}>
          <span className="pure-expert-avatar">{expert.name.slice(0, 1)}</span>
          <span className="pure-expert-item-copy"><strong>{expert.name}</strong><small>{expert.description || expert.id}</small></span>
        </button>)}
      </aside>

      <div className="pure-expert-editor">
        <header className="pure-editor-heading">
          <div><h2>{creating ? "创建 Expert" : "Expert 设置"}</h2><span>{creating ? "配置一个新的专业角色" : "修改后会影响使用该 Expert 的任务，已有对话记录不会改变"}</span></div>
          {!creating && selectedId && <Popconfirm title="删除这个 Expert？" description="关联的 Task 和 Schedule 将恢复为不指定 Expert。" okText="删除" cancelText="取消" onConfirm={() => { const selected = experts.find(item => item.id === selectedId); if (selected) void remove(selected); }}>
            <Button danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>}
        </header>

        {(creating || selectedId) ? <>
          <div className="pure-expert-fields">
            <label>名称<Input value={draft.name} maxLength={80} onChange={event => update("name", event.target.value)} placeholder="例如：投资研究分析师" /></label>
            <label>简介<Input value={draft.description} maxLength={500} onChange={event => update("description", event.target.value)} placeholder="简要说明擅长领域" /></label>
            <label>System Prompt<Input.TextArea value={draft.systemPrompt} maxLength={12000} rows={8} showCount onChange={event => update("systemPrompt", event.target.value)} placeholder="定义角色、专业方法、输出要求和工作约束。" /></label>
            <label>权限上限
              <Radio.Group value={draft.toolPermission} onChange={event => update("toolPermission", event.target.value as AgentToolPermission)}>
                <Radio value="browser-only">Browser only</Radio>
                <Radio value="assisted">Assisted</Radio>
                <Radio value="allow-all">Allow all</Radio>
              </Radio.Group>
              <span className="pure-form-help">Expert 的权限只能收紧全局 Agent 权限，不能突破全局权限设置。</span>
            </label>
            <label>可用 Tools
              <Select mode="multiple" allowClear value={draft.tools} onChange={value => update("tools", value)}
                options={toolOptions} placeholder="留空表示使用当前权限允许的全部工具" maxTagCount="responsive" />
            </label>
            <label>可用 Skills
              <Select mode="multiple" allowClear value={draft.skills} onChange={value => update("skills", value)}
                options={skillOptions} placeholder="选择已启用插件中的 Skills" maxTagCount="responsive" />
              {!skillOptions.length && <span className="pure-form-help">当前没有已启用且包含 Skills 的插件。</span>}
            </label>
          </div>
          <footer className="pure-editor-actions">
            <Button onClick={() => { setCreating(false); if (!selectedId) setSelectedId(experts[0]?.id ?? null); }}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>保存 Expert</Button>
          </footer>
        </> : <div className="pure-empty-state"><TeamOutlined /><strong>选择一个 Expert</strong><span>或者创建新的专业角色。</span></div>}
      </div>
    </div>
  </section>;
}
