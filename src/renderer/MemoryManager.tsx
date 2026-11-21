import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Button, Card, Collapse, Descriptions, Divider, Empty, List, Modal, Popconfirm,
  Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography, message,
} from "antd";
import type {
  AgentMemoryDreamRunDetail, AgentMemoryNoteView, AgentMemorySnapshot, AgentTask,
} from "../shared/types";

const { Text, Paragraph } = Typography;

function valueOf(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}
function numberOf(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function dateOf(value: unknown): string {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toLocaleString() : "—";
}
function statusColor(status: string): string {
  if (status === "completed" || status === "validated") return "success";
  if (status === "prepared" || status === "unverified") return "processing";
  if (status === "disputed" || status === "failed") return "warning";
  if (status === "rolled_back" || status === "abandoned" || status === "archived") return "default";
  return "default";
}

export default function MemoryManager() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AgentMemoryDreamRunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("notes");

  const refreshWorkspaceList = useCallback(async () => {
    const workspace = await window.browser.getAgentWorkspaceSnapshot();
    setTasks(workspace.tasks);
    const preferred = workspace.tasks.some(task => task.id === workspace.activeTaskId)
      ? workspace.activeTaskId : workspace.tasks[0]?.id ?? "";
    setTaskId(current => current && workspace.tasks.some(task => task.id === current) ? current : preferred);
  }, []);

  const refresh = useCallback(async (selectedTaskId = taskId) => {
    if (!selectedTaskId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSnapshot(await window.browser.agentMemoryGetSnapshot(selectedTaskId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refreshWorkspaceList().catch(error => message.error(error instanceof Error ? error.message : String(error)));
  }, [refreshWorkspaceList]);

  useEffect(() => {
    if (taskId) void refresh(taskId);
    else if (!tasks.length) setLoading(false);
  }, [taskId, refresh, tasks.length]);

  const activeNotes = useMemo(() => snapshot?.notes.filter(note => note.status === "active") ?? [], [snapshot]);
  const validated = useMemo(() => activeNotes.filter(note => note.validation === "validated").length, [activeNotes]);
  const disputed = useMemo(() => activeNotes.filter(note => note.validation === "disputed").length, [activeNotes]);
  const preparedRuns = useMemo(() => snapshot?.dreamRuns.filter(run => valueOf(run, "status") === "prepared") ?? [], [snapshot]);

  const selectedTask = tasks.find(task => task.id === taskId);

  const openRun = async (runId: string) => {
    if (!taskId) return;
    setRunLoading(true);
    try {
      setSelectedRun(await window.browser.agentMemoryGetDreamRun(taskId, runId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunLoading(false);
    }
  };

  const startDreaming = async () => {
    if (!taskId) return;
    setRunning(true);
    try {
      const before = await window.browser.agentMemoryGetSnapshot(taskId);
      const beforeStatuses = new Map(before.dreamRuns.map(run => [valueOf(run, "id"), valueOf(run, "status")]));
      await window.browser.copilotSend(
        "请对当前 Workspace 执行完整的 Memory Dreaming 生命周期。先调用 memory_dreaming_prepare 读取新的 Transcript 证据；若没有新证据就明确报告 up_to_date。检查当前 Memory Notes、知识页和关系，识别长期有效的项目事实、业务定义、明确偏好、成功流程、已解决问题、反复出现的失败与相互矛盾的信息。只保留可复用且有证据的内容；每条变更必须引用本次 Run 的 sourceId 并给出 reason，更新已有 Note 必须带 baseVersion。证据不足保持 unverified；冲突用 contradicts 关系或 disputed 表示；不要为了精简而归档唯一或置顶知识。如果没有任何长期知识需要新增、更新或归档，也要用 operations=[] 提交一个 no-op Run，表示这批 Transcript 已经完成评估，避免下次重复处理。最后读取 Run 审计结果汇报新增、更新、归档、关系和知识页。禁止把本次整理操作本身或模型猜测当作事实。",
        [], taskId,
      );
      const after = await window.browser.agentMemoryGetSnapshot(taskId);
      setSnapshot(after);
      const runChanged = after.dreamRuns.find(run => beforeStatuses.get(valueOf(run, "id")) !== valueOf(run, "status"));
      const cursorMoved = after.cursor.createdAt !== before.cursor.createdAt ||
        after.cursor.sessionId !== before.cursor.sessionId ||
        after.cursor.messageId !== before.cursor.messageId;
      if (cursorMoved || runChanged?.status === "completed") {
        message.success("Memory Dreaming 已提交，并推进了 Transcript 游标。");
      } else if (runChanged?.status === "prepared") {
        message.warning("Dreaming 已准备证据，但尚未提交；可在 Runs 中查看并继续处理。");
      } else {
        message.info("没有检测到新的已提交 Dreaming Run；可能没有新 Transcript，或当前 Agent/Expert 未启用所需的 Memory 工具。");
      }
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const abandonRun = async (runId: string) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemoryAbandonDreaming(taskId, runId, "由 Memory 管理界面放弃");
      message.success("已放弃该 Dreaming Run；Transcript 游标未前移。");
      if (selectedRun?.run.id === runId) setSelectedRun(null);
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePinned = async (note: AgentMemoryNoteView) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemorySetPinned(taskId, note.id, !note.pinned);
      message.success(note.pinned ? "已取消置顶。" : "已置顶。");
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const archiveNote = async (note: AgentMemoryNoteView) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemoryArchiveNote(taskId, note.id);
      message.success("Memory Note 已归档，版本与来源记录仍会保留。");
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const rollbackRun = async (runId: string) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemoryRollbackDreaming(taskId, runId, "由 Memory 管理界面回滚");
      message.success("Dreaming 已回滚，相关 Note、关系、知识页和游标已恢复。");
      setSelectedRun(null);
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runColumns = [
    {
      title: "状态", dataIndex: "status", key: "status", width: 112,
      render: (_: unknown, row: Record<string, unknown>) => {
        const status = valueOf(row, "status");
        return <Tag color={statusColor(status)}>{status}</Tag>;
      },
    },
    {
      title: "整理摘要", dataIndex: "summary", key: "summary",
      render: (_: unknown, row: Record<string, unknown>) => valueOf(row, "summary") || <Text type="secondary">尚未提交</Text>,
    },
    { title: "证据", key: "sources", width: 76, render: (_: unknown, row: Record<string, unknown>) => numberOf(row, "source_count") },
    { title: "变更", key: "operations", width: 76, render: (_: unknown, row: Record<string, unknown>) => numberOf(row, "operation_count") },
    { title: "开始时间", key: "createdAt", width: 180, render: (_: unknown, row: Record<string, unknown>) => dateOf(row.created_at) },
    {
      title: "操作", key: "action", width: 210,
      render: (_: unknown, row: Record<string, unknown>) => {
        const id = valueOf(row, "id");
        const status = valueOf(row, "status");
        return <Space size={4}>
          <Button type="link" size="small" loading={runLoading} onClick={() => void openRun(id)}>详情</Button>
          {status === "prepared" && <Popconfirm title="放弃本次 Dreaming？" description="不会修改 Memory，也不会推进 Transcript 游标。" onConfirm={() => void abandonRun(id)}>
            <Button type="link" size="small" danger>放弃</Button>
          </Popconfirm>}
          {status === "completed" && <Popconfirm title="回滚这次 Dreaming？" description="仅允许回滚最近一次提交，且所有实体必须仍保持提交后的版本。" onConfirm={() => void rollbackRun(id)}>
            <Button type="link" size="small" danger>回滚</Button>
          </Popconfirm>}
        </Space>;
      },
    },
  ];

  const noteColumns = [
    { title: "Note", key: "note", render: (_: unknown, note: AgentMemoryNoteView) => <div>
      <Space wrap><Text strong>{note.title}</Text><Tag color={statusColor(note.validation)}>{note.validation}</Tag>{note.pinned && <Tag color="gold">Pinned</Tag>}{note.status !== "active" && <Tag>{note.status}</Tag>}</Space>
      <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: "展开" }} style={{ margin: "4px 0 0" }}>{note.content}</Paragraph>
      <Space wrap size={4}>{note.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space>
    </div> },
    { title: "重要度", key: "importance", width: 92, render: (_: unknown, note: AgentMemoryNoteView) => Math.round(note.importance * 100) + "%" },
    { title: "版本", key: "version", width: 70, render: (_: unknown, note: AgentMemoryNoteView) => "v" + note.version },
    { title: "来源", key: "sources", width: 80, render: (_: unknown, note: AgentMemoryNoteView) => note.sourceRefs.length },
    { title: "更新", key: "updated", width: 180, render: (_: unknown, note: AgentMemoryNoteView) => dateOf(note.updatedAt) },
    {
      title: "操作", key: "actions", width: 150,
      render: (_: unknown, note: AgentMemoryNoteView) => note.status === "active" ? <Space size={4}>
        <Button type="link" size="small" onClick={() => void togglePinned(note)}>{note.pinned ? "取消置顶" : "置顶"}</Button>
        <Popconfirm
          title="归档这条 Memory Note？"
          description={note.pinned ? "请先取消置顶。归档不会物理删除历史版本。" : "归档后不会再注入上下文，但可在 Notes 列表中查看。"}
          disabled={note.pinned}
          onConfirm={() => void archiveNote(note)}
        >
          <Button type="link" size="small" danger disabled={note.pinned}>归档</Button>
        </Popconfirm>
      </Space> : <Text type="secondary">—</Text>,
    },
  ];

  return <section className="memory-manager">
    <div className="memory-manager-header">
      <div>
        <h2>长期记忆与 Dreaming</h2>
        <p>检查 Workspace 的持久记忆、证据来源和整理事务。Dreaming 的提交、放弃与回滚均保留审计记录。</p>
      </div>
      <Space wrap>
        <Select
          style={{ minWidth: 260 }}
          value={taskId || undefined}
          placeholder="选择 Agent Task / Workspace"
          onChange={setTaskId}
          options={tasks.map(task => ({
            label: task.title + (task.workspacePath ? " · " + task.workspacePath : " · Personal"),
            value: task.id,
          }))}
        />
        <Button onClick={() => void refresh(taskId)} disabled={!taskId} loading={loading}>刷新</Button>
        <Button type="primary" onClick={() => void startDreaming()} disabled={!taskId || loading || running || !selectedTask} loading={running}>
          整理当前 Workspace
        </Button>
      </Space>
    </div>
    {!taskId && <Empty description="创建或选择一个 Agent Task 后即可管理它所属 Workspace 的记忆。" />}
    {taskId && loading && <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>}
    {snapshot && !loading && <>
      <Alert
        type="warning"
        showIcon
        message="Dreaming 的工具权限要求"
        description="当前 Task 使用的 Expert 需要启用“长期记忆”工具组，并将 Agent 工具权限设置为 assisted 或 allow-all。若工具未开放，点击整理不会推进 Transcript 游标。"
        style={{ marginBottom: 10 }}
      />
      <Alert
        type="info"
        showIcon
        message={snapshot.workspacePath ? "当前记忆范围：" + snapshot.workspacePath : "当前为个人记忆空间"}
        description={"Transcript 游标：" + dateOf(snapshot.cursor.createdAt) + (snapshot.cursor.sessionId ? " · Session " + snapshot.cursor.sessionId : "") + (snapshot.cursor.messageId ? " · Message " + snapshot.cursor.messageId : "") + "。只有 Dreaming 成功提交后才会推进游标。"}
      />
      <div className="memory-manager-stats">
        <Card><Statistic title="活动 Notes" value={activeNotes.length} /></Card>
        <Card><Statistic title="已验证" value={validated} /></Card>
        <Card><Statistic title="存在争议" value={disputed} /></Card>
        <Card><Statistic title="待处理 Runs" value={preparedRuns.length} /></Card>
        <Card><Statistic title="Dreaming 历史" value={snapshot.dreamRuns.length} /></Card>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: "notes", label: "Memory Notes", children: <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={snapshot.notes} columns={noteColumns} locale={{ emptyText: "还没有持久记忆。完成重要任务后运行 Dreaming。" }} /> },
        { key: "knowledge", label: "知识页", children: <List dataSource={snapshot.knowledge} locale={{ emptyText: "尚未发布主题知识页" }} renderItem={item => <List.Item><List.Item.Meta title={<Space><Text strong>{valueOf(item, "title")}</Text><Tag>{valueOf(item, "slug")}</Tag><Tag>v{valueOf(item, "version")}</Tag></Space>} description={<><Paragraph ellipsis={{ rows: 3, expandable: true }}>{valueOf(item, "content")}</Paragraph><Text type="secondary">来源 Notes：{Array.isArray(item.sourceNoteIds) ? item.sourceNoteIds.join(", ") : ""}</Text></>} /></List.Item>} /> },
        { key: "relationships", label: "记忆关系", children: <Table rowKey={row => valueOf(row, "id")} size="small" pagination={{ pageSize: 10 }} dataSource={snapshot.relationships} columns={[
          { title: "来源 Note", dataIndex: "source_note_id", key: "source" },
          { title: "关系", dataIndex: "relationship", key: "relationship", render: (value: unknown) => <Tag>{String(value)}</Tag> },
          { title: "目标 Note", dataIndex: "target_note_id", key: "target" },
          { title: "依据", dataIndex: "details", key: "details" },
          { title: "建立时间", key: "created", render: (_: unknown, row: Record<string, unknown>) => dateOf(row.created_at) },
        ]} locale={{ emptyText: "尚未建立 Note 之间的关系" }} /> },
        { key: "dreaming", label: "Dreaming Runs", children: <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={snapshot.dreamRuns} columns={runColumns} locale={{ emptyText: "尚无 Dreaming 记录" }} /> },
      ]} />
    </>}
    <Modal
      title="Dreaming Run 审计详情"
      open={Boolean(selectedRun)}
      onCancel={() => setSelectedRun(null)}
      footer={<Button onClick={() => setSelectedRun(null)}>关闭</Button>}
      width={920}
    >
      {selectedRun && <>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="Run ID">{selectedRun.run.id}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={statusColor(selectedRun.run.status)}>{selectedRun.run.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="证据数量">{selectedRun.run.sourceCount}</Descriptions.Item>
          <Descriptions.Item label="开始时间">{dateOf(selectedRun.run.startedAt)}</Descriptions.Item>
          <Descriptions.Item label="完成时间">{dateOf(selectedRun.run.completedAt)}</Descriptions.Item>
          <Descriptions.Item label="游标上限">{dateOf(selectedRun.run.maxSourceCreatedAt)}</Descriptions.Item>
          <Descriptions.Item label="整理摘要" span={2}>{selectedRun.run.summary || "尚未提交"}</Descriptions.Item>
        </Descriptions>
        <Divider />
        <Collapse items={[
          { key: "evidence", label: "固定证据集 · " + selectedRun.run.evidence.length, children: <List size="small" pagination={{ pageSize: 8 }} dataSource={selectedRun.run.evidence} renderItem={source => <List.Item><List.Item.Meta title={<Space><Text strong>{source.kind}</Text><Text type="secondary">{dateOf(source.createdAt)}</Text><Tag>{source.sourceId}</Tag></Space>} description={<Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{source.content}</Paragraph>} /></List.Item>} /> },
          { key: "operations", label: "变更审计 · " + selectedRun.operations.length, children: <List size="small" pagination={{ pageSize: 8 }} dataSource={selectedRun.operations} renderItem={operation => <List.Item><List.Item.Meta title={<Space><Tag color="blue">{valueOf(operation, "operation")}</Tag><Text code>{valueOf(operation, "entityId")}</Text></Space>} description={<><Paragraph>{valueOf(operation, "reason")}</Paragraph><Text type="secondary">序号 {valueOf(operation, "sequence")} · {valueOf(operation, "entityType")}</Text><Collapse size="small" items={[{ key: "before", label: "变更前快照", children: <pre className="memory-json">{valueOf(operation, "before") || "（新建实体）"}</pre> }, { key: "after", label: "变更后快照", children: <pre className="memory-json">{valueOf(operation, "after") || "（已删除实体）"}</pre> }]} /></>} /></List.Item>} /> },
        ]} />
      </>}
    </Modal>
  </section>;
}
