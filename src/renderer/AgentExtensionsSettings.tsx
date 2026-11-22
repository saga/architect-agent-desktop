import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Divider, Dropdown, Empty, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Switch, Tag, Typography, message } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AgentSkillSummary, McpServerConfig } from "../shared/types";

const { Text } = Typography;
type McpFormValues = { id: string; transport: "stdio" | "http"; description?: string; command?: string; argsJson?: string; envJson?: string; cwd?: string; url?: string; headersJson?: string; timeout?: number };

function parseJsonObject(value: string | undefined, field: string): Record<string, string> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(field + " 必须是合法 JSON 对象。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([key, item]) => !key.trim() || typeof item !== "string")) throw new Error(field + " 必须是字符串键值组成的 JSON 对象。");
  return parsed as Record<string, string>;
}
function parseJsonArray(value: string | undefined, field: string): string[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(field + " 必须是合法 JSON 数组。"); }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error(field + " 必须是字符串数组。");
  return parsed;
}
function toFormValues(server?: McpServerConfig): McpFormValues {
  return {
    id: server?.id ?? "", transport: server?.transport ?? "stdio", description: server?.description ?? "",
    command: server?.transport === "stdio" ? server.command : "",
    argsJson: JSON.stringify(server?.transport === "stdio" ? server.args ?? [] : [], null, 2),
    envJson: JSON.stringify(server?.transport === "stdio" ? server.env ?? {} : {}, null, 2),
    cwd: server?.transport === "stdio" ? server.cwd ?? "" : "",
    url: server?.transport === "http" ? server.url : "",
    headersJson: JSON.stringify(server?.transport === "http" ? server.headers ?? {} : {}, null, 2),
    timeout: server?.timeout ?? 30000,
  };
}

export function McpSettingsPanel() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | undefined>();
  const [form] = Form.useForm<McpFormValues>();
  const transport = Form.useWatch("transport", form) ?? editing?.transport ?? "stdio";
  const refresh = async () => {
    setLoading(true);
    try { setServers(await window.browser.agentMcpList()); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (modalOpen) form.setFieldsValue(toFormValues(editing)); else form.resetFields(); }, [editing, form, modalOpen]);

  const save = async (values: McpFormValues) => {
    setSaving(true);
    try {
      const common = { id: values.id.trim(), enabled: editing?.enabled ?? true,
        ...(values.description?.trim() ? { description: values.description.trim() } : {}), timeout: values.timeout ?? 30000 };
      const server: McpServerConfig = values.transport === "stdio"
        ? { ...common, transport: "stdio", command: values.command?.trim() ?? "", args: parseJsonArray(values.argsJson, "启动参数"), env: parseJsonObject(values.envJson, "环境变量"), ...(values.cwd?.trim() ? { cwd: values.cwd.trim() } : {}) }
        : { ...common, transport: "http", url: values.url?.trim() ?? "", headers: parseJsonObject(values.headersJson, "HTTP Headers") };
      setServers(await window.browser.agentMcpSave(server));
      message.success(editing ? "MCP Server 配置已更新。" : "MCP Server 已添加。");
      setModalOpen(false); setEditing(undefined);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const toggle = async (server: McpServerConfig, enabled: boolean) => {
    try { setServers(await window.browser.agentMcpSetEnabled(server.id, enabled)); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const remove = async (server: McpServerConfig) => {
    try { setServers(await window.browser.agentMcpRemove(server.id)); message.success("已删除 " + server.id); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const activeCount = useMemo(() => servers.filter(server => server.enabled).length, [servers]);
  const addSample = async (kind: "firecrawl-stdio" | "firecrawl-http") => {
    const sample: McpServerConfig = kind === "firecrawl-stdio"
      ? {
          id: "firecrawl", transport: "stdio", enabled: true,
          description: "Firecrawl 官方 MCP（keyless 模式可限流使用 search / scrape / parse；配置 API Key 可启用完整工具）",
          command: "npx", args: ["-y", "firecrawl-mcp"], env: {}, timeout: 60000,
        }
      : {
          id: "firecrawl-cloud", transport: "http", enabled: true,
          description: "Firecrawl 托管 MCP（keyless 模式可限流使用 search / scrape / parse）",
          url: "https://mcp.firecrawl.dev/v2/mcp", headers: {}, timeout: 60000,
        };
    if (servers.some(server => server.id === sample.id)) {
      message.info("示例 MCP 已存在：" + sample.id + "。不会覆盖现有配置。");
      return;
    }
    try {
      setServers(await window.browser.agentMcpSave(sample));
      message.success("已添加 Firecrawl 示例 MCP：" + sample.id);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="extension-settings">
    <div className="extension-heading">
      <div><h2>MCP Servers</h2><p>管理 Agent 可连接的外部工具服务。配置保存在本机，不会写入 Copilot 或 CodeBuddy 原有配置。</p></div>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button>
        <Dropdown menu={{ items: [
          { key: "firecrawl-stdio", label: "Firecrawl · 本地 STDIO（npx）" },
          { key: "firecrawl-http", label: "Firecrawl · 托管 HTTP" },
        ], onClick: ({ key }) => { if (key === "firecrawl-stdio" || key === "firecrawl-http") void addSample(key); } }}>
          <Button>添加示例 MCP <DownOutlined /></Button>
        </Dropdown>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(undefined); setModalOpen(true); }}>添加 MCP</Button>
      </Space>
    </div>
    <Alert type="warning" showIcon message="外部 MCP 仅在当前 Agent 的有效工具权限为 Allow all 时连接"
      description="MCP Server 提供的工具由外部服务定义，不受浏览器工具的细粒度权限控制。请只连接可信服务。密钥建议使用 ${ENV_VAR} 环境变量引用，不要把真实 Token 写入配置。" />
    <Alert type="info" showIcon message="Remote HTTP · Microsoft Entra OAuth（可选）"
      description="Copilot 可使用 Entra 公共客户端授权码 + PKCE 登录远程 MCP。需要在主进程 .env 中设置 MCP_OAUTH_ENABLED=true、MCP_OAUTH_TENANT_ID 和 MCP_OAUTH_CLIENT_ID；默认关闭。CodeBuddy 仍使用 HTTP Headers / Bearer Token 环境变量。" />
    <div className="extension-list-summary"><Text type="secondary">{servers.length} 个已配置 · {activeCount} 个已启用</Text></div>
    <List className="extension-list" loading={loading} dataSource={servers}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有配置 MCP Server" /> }}
      renderItem={server => <List.Item actions={[
        <Switch key="enabled" checked={server.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={value => void toggle(server, value)} />,
        <Button key="edit" type="link" onClick={() => { setEditing(server); setModalOpen(true); }}>编辑</Button>,
        <Popconfirm key="delete" title="删除 MCP Server？" description="只删除本应用中的连接配置，不会卸载远端或本地服务。" okText="删除" cancelText="取消" onConfirm={() => void remove(server)}><Button type="text" danger icon={<DeleteOutlined />} /></Popconfirm>,
      ]}>
        <List.Item.Meta
          title={<Space wrap><span>{server.id}</span><Tag color={server.transport === "stdio" ? "blue" : "purple"}>{server.transport === "stdio" ? "Local · STDIO" : "Remote · HTTP"}</Tag>{server.enabled ? <Tag color="success">已启用</Tag> : <Tag>已停用</Tag>}</Space>}
          description={<><div>{server.description || (server.transport === "stdio" ? server.command : server.url)}</div><div className="settings-field-help">{server.transport === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : server.url} · Timeout {server.timeout ?? 30000} ms</div></>} />
      </List.Item>} />
    <Modal title={editing ? "编辑 MCP Server" : "添加 MCP Server"} open={modalOpen}
      onCancel={() => { setModalOpen(false); setEditing(undefined); }} onOk={() => form.submit()}
      okText="保存" cancelText="取消" confirmLoading={saving} destroyOnHidden width={620}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={values => void save(values)}>
        <Form.Item name="id" label="Server ID" rules={[{ required: true, message: "请输入唯一 ID。" }, { pattern: /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, message: "使用小写字母、数字、点、下划线和连字符。" }, { max: 64, message: "ID 不能超过 64 个字符。" }]}>
          <Input disabled={Boolean(editing)} placeholder="例如 filesystem、github、postgres" /></Form.Item>
        <Form.Item name="transport" label="连接方式" rules={[{ required: true }]}><Select options={[{ label: "Local · STDIO", value: "stdio" }, { label: "Remote · HTTP", value: "http" }]} /></Form.Item>
        <Form.Item name="description" label="备注"><Input placeholder="简要说明服务用途（可选）" maxLength={500} /></Form.Item>
        {transport === "stdio" ? <>
          <Form.Item name="command" label="Command" rules={[{ required: true, message: "请输入可执行命令。" }]}><Input placeholder="例如 npx、uvx、node" /></Form.Item>
          <Form.Item name="argsJson" label="启动参数（JSON 数组）"><Input.TextArea rows={3} spellCheck={false} placeholder={'["@modelcontextprotocol/server-filesystem", "/path/to/workspace"]'} /></Form.Item>
          <Form.Item name="envJson" label="环境变量（JSON 对象）"><Input.TextArea rows={3} spellCheck={false} placeholder={'{"API_TOKEN":"$' + '{API_TOKEN}"}'} /></Form.Item>
          <Form.Item name="cwd" label="工作目录（可选）"><Input placeholder="留空则使用应用默认工作目录" /></Form.Item>
        </> : <>
          <Form.Item name="url" label="Server URL" rules={[{ required: true, type: "url", message: "请输入有效的 HTTP(S) URL。" }]}><Input placeholder="https://example.com/mcp" /></Form.Item>
          <Form.Item name="headersJson" label="HTTP Headers（JSON 对象）"><Input.TextArea rows={4} spellCheck={false} placeholder={'{"Authorization":"Bearer $' + '{MCP_TOKEN}"}'} /></Form.Item>
        </>}
        <Form.Item name="timeout" label="连接超时（毫秒）" rules={[{ required: true }]}><InputNumber min={1000} max={120000} step={1000} style={{ width: "100%" }} /></Form.Item>
      </Form>
      <div className="settings-field-help">环境变量引用格式为 {"$" + "{NAME}"}。启动前由应用从当前进程环境中解析；未设置的变量会阻止 MCP 启动。配置文件权限限制为当前用户可读写。</div>
    </Modal>
  </div>;
}

export function AgentSkillsPanel() {
  const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"folder" | "zip" | "sample" | null>(null);
  const refresh = async () => {
    setLoading(true);
    try { setSkills(await window.browser.agentSkillList()); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const importSkill = async () => {
    setBusyAction("folder");
    try {
      const skill = await window.browser.agentSkillImport();
      if (skill) {
        setSkills(current => [...current.filter(item => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name)));
        message.success("已导入 Agent Skill：" + skill.name);
      }
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };
  const importSkillZip = async () => {
    setBusyAction("zip");
    try {
      const skill = await window.browser.agentSkillImportZip();
      if (skill) {
        setSkills(current => [...current.filter(item => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name)));
        message.success("已上传 Agent Skill ZIP：" + skill.name);
      }
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };
  const installSample = async () => {
    setBusyAction("sample");
    try {
      const skill = await window.browser.agentSkillInstallSample();
      setSkills(current => [...current.filter(item => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name)));
      message.success("已安装示例 Skill：" + skill.name);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };
  const toggle = async (skill: AgentSkillSummary, enabled: boolean) => {
    try { setSkills(await window.browser.agentSkillSetEnabled(skill.id, enabled)); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  const remove = async (skill: AgentSkillSummary) => {
    try { setSkills(await window.browser.agentSkillRemove(skill.id)); message.success("已删除 Skill：" + skill.name); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="extension-settings">
    <div className="extension-heading">
      <div><h2>Agent Skills</h2><p>支持直接导入目录，以及 Claude Desktop 风格的 Skill ZIP 上传。启用后，Skill 指引会加入 Agent 上下文。</p></div>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button>
        <Button loading={busyAction === "sample"} disabled={busyAction !== null} onClick={() => void installSample()}>安装示例</Button>
        <Button loading={busyAction === "folder"} disabled={busyAction !== null} onClick={() => void importSkill()}>导入文件夹</Button>
        <Button type="primary" icon={<PlusOutlined />} loading={busyAction === "zip"} disabled={busyAction !== null} onClick={() => void importSkillZip()}>上传 Skill ZIP</Button>
      </Space>
    </div>
    <Alert type="info" showIcon message="Skill 作为任务指引加载，不作为可执行插件"
      description="支持 SKILL.md / skill.md。ZIP 需包含一个以 Skill name 命名的顶层目录，例如 web-research/SKILL.md。启用前请检查下载内容；Skill 中的脚本、命令不会被应用自动执行。" />
    <List className="extension-list" loading={loading} dataSource={skills}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>尚未导入 Skill<br /><Text type="secondary">选择一个包含 SKILL.md 的目录即可添加</Text></span>} /> }}
      renderItem={(skill) => (
        <List.Item
          actions={[
            <Switch key="enabled" checked={skill.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(value) => void toggle(skill, value)} />,
            <Popconfirm key="delete" title="删除此 Skill？" description="只删除应用管理目录中的副本，不影响原始目录。" okText="删除" cancelText="取消" onConfirm={() => void remove(skill)}>
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>,
          ]}
        >
          <List.Item.Meta
            title={<Space wrap><span>{skill.name}</span><Tag>{skill.id}</Tag>{skill.enabled ? <Tag color="success">已启用</Tag> : <Tag>已停用</Tag>}</Space>}
            description={skill.description}
          />
        </List.Item>
      )} />
    <Divider />
    <div className="settings-field-help">Skill 内容在每次新 Agent Session 创建时读取。切换状态后，下一次新建任务或重置会话生效。</div>
  </div>;
}
