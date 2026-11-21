import { useEffect, useState } from "react";
import { Button, Input, Popconfirm, Radio, Select, Switch, message } from "antd";
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
  toolPermission: "none",
  allowAllTools: false,
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

  const refresh = async (preferredId?: string) => {
    try {
      const snapshot = await window.browser.getAgentWorkspaceSnapshot();
      setExperts(snapshot.experts);
      setSelectedId(current => preferredId && snapshot.experts.some(item => item.id === preferredId) ? preferredId : current && snapshot.experts.some(item => item.id === current) ? current : snapshot.experts[0]?.id ?? null);
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
    const requestedId = draft.id.trim();
    const baseId = requestedId || draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
    let id = baseId;
    if (creating && experts.some(item => item.id === id)) {
      if (requestedId) {
        message.error("Expert ID 已存在，请使用其他 ID。");
        return;
      }
      let suffix = 2;
      while (experts.some(item => item.id === baseId + "-" + suffix)) suffix += 1;
      id = baseId + "-" + suffix;
    }
    setSaving(true);
    try {
      const updated = await window.browser.saveAgentExpert({ ...draft, id });
      setExperts(updated);
      setSelectedId(id);
      setCreating(false);
      await refresh(id);
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

  const toolOptions = TOOL_GROUPS.flatMap(group => group.tools).map(tool => ({ label: tool, value: tool }));
  const skillOptions = plugins.flatMap(plugin => plugin.skills.map(skill => ({
    label: plugin.name + " / " + skill,
    value: plugin.id + ":" + skill,
  })));

  return <section className="pure-management-page">
    <header className="pure-page-heading">
      <div>
        <div className="pure-page-eyebrow"><TeamOutlined /> AGENT WORK MODES</div>
        <h1>Expert / 工作模式</h1>
        <p>把任务方法、参考 Skills、工具白名单和权限上限绑定到一个 Task。它是可复用的工作配置，不只是角色人设。</p>
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
            <label>适用任务<Input value={draft.description} maxLength={500} onChange={event => update("description", event.target.value)} placeholder="例如：分析公司年报、维护 TypeScript 项目" /></label>
            <label>工作方法与输出约束<Input.TextArea value={draft.systemPrompt} maxLength={12000} rows={8} showCount onChange={event => update("systemPrompt", event.target.value)} placeholder="写清执行步骤、业务规则、可信来源、输出结构和检查标准；不要只写“你是一名资深专家”。" /><span className="pure-form-help">单纯添加专家头衔通常不会可靠提升模型能力。优先写入模型原本不知道的业务方法、流程、约束与验收标准。</span></label>
            <label>权限上限
              <Radio.Group value={draft.toolPermission} onChange={event => update("toolPermission", event.target.value as AgentToolPermission)}>
                <Radio value="none">No tools</Radio>
                <Radio value="browser-only">Browser only</Radio>
                <Radio value="assisted">Assisted</Radio>
                <Radio value="allow-all">Allow all</Radio>
              </Radio.Group>
              <span className="pure-form-help">这是该工作模式的权限上限，不能突破全局 Agent 权限。默认 No tools；如需全部工具，再单独开启下方开关。</span>
            </label>
            <label className="pure-expert-tool-access">
              <span>Allow all tools</span>
              <Switch checked={draft.allowAllTools} onChange={value => {
                update("allowAllTools", value);
                if (value && draft.toolPermission === "none") update("toolPermission", "allow-all");
              }} />
              <span className="pure-form-help">开启后允许当前全局权限范围内的全部工具；关闭后只允许下方明确勾选的工具。默认不允许任何工具。</span>
            </label>
            <label>可用 Tools
              <Select mode="multiple" allowClear value={draft.tools} onChange={value => update("tools", value)}
                disabled={draft.allowAllTools}
                options={toolOptions} placeholder="默认不允许工具；只选择这个 Expert 需要的工具" maxTagCount="responsive" />
              {!draft.allowAllTools && !draft.tools.length && <span className="pure-form-help">当前没有选中工具。这个 Expert 不会调用任何工具。</span>}
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
