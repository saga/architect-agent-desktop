import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Button, Card, Collapse, Descriptions, Divider, Empty, List, Modal, Popconfirm,
  Select, Space, Spin, Statistic, Switch, Table, Tabs, Tag, Typography, message,
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
  const [embeddingRunning, setEmbeddingRunning] = useState(false);
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
  const qualityDue = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return activeNotes.filter(note => note.sourceRefs.length > 0 &&
      (note.lastQualityReviewedAt === null || note.lastQualityReviewedAt <= cutoff)).length;
  }, [activeNotes]);
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
        "请对当前 Workspace 执行完整的 Memory Dreaming 生命周期。先调用 memory_dreaming_prepare 读取新的 Transcript 证据；若没有新证据就明确报告 up_to_date。检查当前 Memory Notes、知识页和关系，识别长期有效的项目事实、业务定义、明确偏好、成功流程、已解决问题、反复出现的失败与相互矛盾的信息。对重要、高风险或可能变化的已有 Note，读取其 sourceRefs 并调用 memory_read_source 复核原始证据；必要时用 memory_search_history 检查更早 Transcript，不能只凭旧 Note 自身内容验证它。任何含 [TRUNCATED] 标记的证据都只是预览，必须先用 memory_search_history 检查原始 Transcript。只保留可复用且有证据的内容；每条变更必须引用本次 Run 的 sourceId 并给出 reason，更新已有 Note 必须带 baseVersion，更新或归档知识页必须使用当前 baseVersion。证据不足保持 unverified；冲突用 contradicts 关系或 disputed 表示；失效知识页可以 archive_knowledge，但不要为了精简而归档唯一或置顶知识。如果没有任何长期知识需要新增、更新或归档，也要用 operations=[] 提交一个 no-op Run，表示这批 Transcript 已经完成评估，避免下次重复处理。最后读取 Run 审计结果汇报新增、更新、归档、关系和知识页。Transcript Run 完成后，再调用 memory_quality_review_prepare；若创建 Run，使用其 runId 调用 memory_quality_review_list({runId})。只复查返回的候选 Note，并使用 qualityReviewSourceRefs 作为 review_note.sourceRefs，提交 baseVersion、confidence 和 qualityScore（0–1）。质量分数考虑来源、清晰度、时效性和交叉印证；证据不足保留 unverified，不因旧验证标记而盲目信任。最后调用 memory_prune_expired。禁止把本次整理操作本身或模型猜测当作事实。",
        [], taskId,
      );
      const after = await window.browser.agentMemoryGetSnapshot(taskId);
      setSnapshot(after);
      const runChanged = after.dreamRuns.find(run => beforeStatuses.get(valueOf(run, "id")) !== valueOf(run, "status"));
      const cursorMoved = after.cursor.transcriptRevision !== before.cursor.transcriptRevision ||
        after.cursor.createdAt !== before.cursor.createdAt ||
        after.cursor.sessionId !== before.cursor.sessionId ||
        after.cursor.messageId !== before.cursor.messageId;
      if (cursorMoved) {
        message.success("Transcript Dreaming 已提交，并推进了修订游标。");
      } else if (runChanged?.status === "completed" && valueOf(runChanged, "purpose") === "quality_review") {
        message.success("Transcript 无新增内容；长期记忆质量复查已提交。");
      } else if (runChanged?.status === "completed") {
        message.success("Memory Dreaming 已完成并提交。");
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

  const resumeRun = async (runId: string) => {
    if (!taskId) return;
    setRunning(true);
    try {
      const detail = await window.browser.agentMemoryGetDreamRun(taskId, runId);
      const prompt = detail.run.purpose === "quality_review"
        ? "请继续当前 Workspace 已准备好的质量复查 Run，不要重新 prepare。目标 Run ID：" + runId + "。调用 memory_quality_review_list({runId}) 查看该 Run 的候选 Note；若没有候选映射则调用 memory_dreaming_abandon 放弃该 Run。根据固定证据集和 memory_read_source 读取的原始来源，逐条使用 review_note 提交当前 baseVersion、候选记录的 qualityReviewSourceRefs、confidence 和 qualityScore（0–1）。不能仅凭旧 validation 状态判断正确；证据不足保留 unverified，冲突标 disputed。遇到版本冲突不覆盖，报告并保留 prepared。全部复核后提交 memory_dreaming_commit，并读取审计结果。"
        : "请继续当前 Workspace 中已经准备好的 Memory Dreaming Run，不要重新调用 prepare，也不要创建新 Run。目标 Run ID：" + runId + "。先调用 memory_dreaming_get_run 读取完整固定证据集；再检查当前 Notes、知识页和关系。对重要或可能变化的旧 Note，使用 memory_read_source 读取 sourceRefs 对应的历史证据，必要时搜索更早 Transcript。任何含 [TRUNCATED] 标记的证据都只是预览，必须先用 memory_search_history 检查原始 Transcript。对每项变更引用该 Run 的 sourceId 并说明 reason；更新已有 Note 必须使用当前 baseVersion，更新或归档已有知识页必须使用当前 baseVersion。遇到版本冲突时不要覆盖，保留 Run 为 prepared 并报告冲突。若证据已评估且没有需要变更的长期知识，提交 operations=[]。成功后读取 Run 与审计记录，汇报结果。";
      await window.browser.copilotSend(prompt, [], taskId);
      const after = await window.browser.agentMemoryGetSnapshot(taskId);
      setSnapshot(after);
      const run = after.dreamRuns.find(item => valueOf(item, "id") === runId);
      if (run && valueOf(run, "status") === "completed") {
        message.success("已完成这批 Dreaming，并提交了记忆变更。");
      } else if (run && valueOf(run, "status") === "prepared") {
        message.warning("这批 Dreaming 仍处于待处理状态，请查看 Run 详情或处理报告。");
      } else {
        message.info("未找到该 Run 的最新状态，请刷新后检查。");
      }
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const startQualityReview = async () => {
    if (!taskId || preparedRuns.length) return;
    setRunning(true);
    try {
      const before = await window.browser.agentMemoryGetSnapshot(taskId);
      const beforeStatuses = new Map(before.dreamRuns.map(run => [valueOf(run, "id"), valueOf(run, "status")]));
      await window.browser.copilotSend(
        "请只执行当前 Workspace 的长期记忆质量复查，不要读取或推进 Transcript 游标。调用 memory_quality_review_prepare；若 up_to_date 则报告没有到期候选。若创建 prepared Run，调用 memory_quality_review_list({runId})，只处理返回的候选 Note；若没有候选映射，调用 memory_dreaming_abandon 放弃该 Run。通过 memory_read_source 读取其历史来源；遇到 [TRUNCATED] 必须用 memory_search_history 查找完整 Transcript。对每条 Note 按来源可靠性、直接性、内容清晰度、当前有效性和交叉印证给出 0–1 的 qualityScore。用 review_note 提交当前 baseVersion、该候选的 qualityReviewSourceRefs、confidence 和 qualityScore；证据不足保持 unverified，存在冲突标 disputed，不能仅凭旧 validation 状态自我验证。提交 memory_dreaming_commit 后读取 Run 审计。质量复查不能推进 Transcript cursor。",
        [],
        taskId,
      );
      const after = await window.browser.agentMemoryGetSnapshot(taskId);
      setSnapshot(after);
      const changed = after.dreamRuns.find(run => beforeStatuses.get(valueOf(run, "id")) !== valueOf(run, "status"));
      if (changed && valueOf(changed, "status") === "completed" && valueOf(changed, "purpose") === "quality_review") {
        message.success("记忆质量复查已提交。");
      } else if (changed && valueOf(changed, "status") === "prepared") {
        message.warning("质量复查仍有待处理 Run，请在 Dreaming Runs 中继续处理或放弃。");
      } else {
        message.info("没有检测到新的质量复查提交；可能没有到期 Note 或当前 Expert 未开放所需工具。");
      }
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const reindexEmbeddings = async () => {
    if (!taskId || !snapshot?.embeddingIndex.enabled) return;
    setEmbeddingRunning(true);
    try {
      const result = await window.browser.agentMemoryReindexEmbeddings(taskId, 200);
      if (result.warning) message.warning("本地向量索引部分完成：" + result.warning);
      else message.success(result.enabled ? "已建立 " + result.indexed + " 条本地向量，剩余 " + result.remaining + " 条。" : result.message ?? "语义检索未启用。");
      await refresh(taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setEmbeddingRunning(false);
    }
  };

  const updateDreamSchedule = async (enabled: boolean, intervalMinutes: number) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemorySaveDreamSchedule(taskId, { enabled, intervalMinutes });
      await refresh(taskId);
      message.success(enabled ? "已启用 Workspace 自动 Dreaming。" : "已暂停 Workspace 自动 Dreaming。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
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

  const openExternalSource = async (url: string) => {
    try {
      await window.browser.openExternal(url);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmExternalVerification = async (note: AgentMemoryNoteView) => {
    if (!taskId) return;
    try {
      await window.browser.agentMemoryConfirmExternalVerification(taskId, note.id, note.version);
      message.success("已记录人工来源核验声明；Note 已标记为 validated。");
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
      title: "类型", key: "purpose", width: 100,
      render: (_: unknown, row: Record<string, unknown>) => valueOf(row, "purpose") === "quality_review" ? "质量复查" : "Transcript",
    },
    {
      title: "整理摘要", dataIndex: "summary", key: "summary",
      render: (_: unknown, row: Record<string, unknown>) => valueOf(row, "summary") || <Text type="secondary">尚未提交</Text>,
    },
    { title: "证据", key: "sources", width: 76, render: (_: unknown, row: Record<string, unknown>) => numberOf(row, "source_count") },
    { title: "变更", key: "operations", width: 76, render: (_: unknown, row: Record<string, unknown>) => numberOf(row, "operation_count") },
    { title: "开始时间", key: "createdAt", width: 180, render: (_: unknown, row: Record<string, unknown>) => dateOf(row.created_at) },
    {
      title: "操作", key: "action", width: 260,
      render: (_: unknown, row: Record<string, unknown>) => {
        const id = valueOf(row, "id");
        const status = valueOf(row, "status");
        return <Space size={4}>
          <Button type="link" size="small" loading={runLoading} onClick={() => void openRun(id)}>详情</Button>
          {status === "prepared" && <Button type="link" size="small" loading={running} onClick={() => void resumeRun(id)}>继续处理</Button>}
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
      <Space wrap><Text strong>{note.title}</Text><Tag color={statusColor(note.validation)}>{note.validation}</Tag><Tag>{({ user_preference: "用户偏好", user_intent: "用户意图", decision: "决策", project_fact: "项目事实", workflow_pattern: "工作模式", external_fact: "外部事实", unknown: "未分类" } as Record<string, string>)[note.claimType] ?? "未分类"}</Tag>{note.pinned && <Tag color="gold">Pinned</Tag>}{note.status !== "active" && <Tag>{note.status}</Tag>}</Space>
      <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: "展开" }} style={{ margin: "4px 0 0" }}>{note.content}</Paragraph>
      {note.validationEvidence && <Text type="secondary" style={{ fontSize: 11 }}>验证依据：{note.validationEvidence.independentSessions} 个独立会话 · {note.validationEvidence.directUserSources} 条用户陈述 · {note.validationEvidence.toolObservations} 条工具观察；{note.validationEvidence.reason}</Text>}
      {note.externalVerification && <div style={{ marginTop: 6 }}>
        <Space wrap size={4}>
          <Tag color={note.validation === "validated" ? "success" : note.externalVerification.status === "multi_domain_sources_recorded" ? "processing" : "warning"}>
            {note.validation === "validated" ? "人工确认已核对来源" : note.validation === "disputed" ? "存在争议 · 不可直接确认" : note.externalVerification.status === "multi_domain_sources_recorded" ? "已记录多个来源域名 · 待人工核对" : "仅记录单一来源域名"}
          </Tag>
          {note.externalVerification.sources.map(source => <Tag key={source.sourceRef}>
            <Button type="link" size="small" style={{ padding: 0, height: "auto" }}
              onClick={() => void openExternalSource(source.url)}>
              {source.domain} · {source.publisher}
            </Button>
          </Tag>)}
        </Space>
        <Text type="secondary" style={{ display: "block", fontSize: 11, marginTop: 3 }}>
          {note.externalVerification.note || "来源仅证明已登记在工具证据中。请逐一打开链接核对原始内容、发布时间和上下文；来源记录本身不是事实验证。"}
        </Text>
      </div>}
      <Space wrap size={4}>{note.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space>
    </div> },
    { title: "重要度", key: "importance", width: 92, render: (_: unknown, note: AgentMemoryNoteView) => Math.round(note.importance * 100) + "%" },
    { title: "版本", key: "version", width: 70, render: (_: unknown, note: AgentMemoryNoteView) => "v" + note.version },
    { title: "质量分", key: "quality", width: 82, render: (_: unknown, note: AgentMemoryNoteView) => note.qualityScore === null ? "未评估" : Math.round(note.qualityScore * 100) + "%" },
    { title: "上次复查", key: "reviewed", width: 155, render: (_: unknown, note: AgentMemoryNoteView) => dateOf(note.lastQualityReviewedAt) },
    { title: "来源", key: "sources", width: 80, render: (_: unknown, note: AgentMemoryNoteView) => note.sourceRefs.length },
    { title: "更新", key: "updated", width: 180, render: (_: unknown, note: AgentMemoryNoteView) => dateOf(note.updatedAt) },
    {
      title: "操作", key: "actions", width: 230,
      render: (_: unknown, note: AgentMemoryNoteView) => note.status === "active" ? <Space size={4} wrap>
        <Button type="link" size="small" onClick={() => void togglePinned(note)}>{note.pinned ? "取消置顶" : "置顶"}</Button>
        {note.claimType === "external_fact" && note.validation === "unverified" &&
          note.externalVerification?.status === "multi_domain_sources_recorded" &&
          <Popconfirm
            title="确认已逐一打开并核对全部来源？"
            description="点击确认表示你已亲自打开每个不同域名的来源，核对原文、日期和上下文。系统只记录这项人工声明，不会自动证明网页内容真实。"
            okText="确认我已核对"
            cancelText="返回"
            onConfirm={() => void confirmExternalVerification(note)}
          >
            <Button type="link" size="small">我已核对来源</Button>
          </Popconfirm>}
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
        <Button onClick={() => void startQualityReview()} disabled={!taskId || loading || running || !selectedTask || preparedRuns.length>0} loading={running}>
          复查记忆质量
        </Button>
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
        description={"Transcript 游标：" + dateOf(snapshot.cursor.createdAt) + (snapshot.cursor.sessionId ? " · Session " + snapshot.cursor.sessionId : "") + (snapshot.cursor.messageId ? " · Message " + snapshot.cursor.messageId : "") + " · Revision " + snapshot.cursor.transcriptRevision + "。历史消息内容修订也会产生新的 revision 证据；质量复查不会推进 Transcript 游标。"}
      />
      <Card size="small" style={{ marginTop: 10, marginBottom: 10 }}>
        <Space wrap align="center">
          <Text strong>自动 Memory Dreaming</Text>
          <Switch
            checked={snapshot.dreamSchedule.enabled}
            onChange={enabled => void updateDreamSchedule(enabled, snapshot.dreamSchedule.intervalMinutes)}
            disabled={running}
          />
          <Text type="secondary">执行周期</Text>
          <Select
            size="small"
            style={{ width: 130 }}
            value={snapshot.dreamSchedule.intervalMinutes}
            onChange={interval => void updateDreamSchedule(snapshot.dreamSchedule.enabled, interval)}
            options={[
              { label: "每 6 小时", value: 360 },
              { label: "每 12 小时", value: 720 },
              { label: "每天", value: 1440 },
              { label: "每 3 天", value: 4320 },
              { label: "每 7 天", value: 10080 },
            ]}
            disabled={running}
          />
          <Tag color={snapshot.dreamSchedule.enabled ? "success" : "default"}>
            {snapshot.dreamSchedule.enabled ? "已启用" : "已暂停"}
          </Tag>
          <Text type="secondary">
            {snapshot.dreamSchedule.lastRunAt
              ? "上次：" + dateOf(snapshot.dreamSchedule.lastRunAt) + " · " + (snapshot.dreamSchedule.lastRunStatus ?? "unknown")
              : "尚未自动执行"}
          </Text>
          {snapshot.dreamSchedule.enabled && snapshot.dreamSchedule.nextRunAt !== null &&
            <Text type="secondary">下次检查：{dateOf(snapshot.dreamSchedule.nextRunAt)}</Text>}
        </Space>
        {snapshot.dreamSchedule.lastError &&
          <Alert type="warning" showIcon style={{ marginTop: 8 }} message="最近一次自动 Dreaming 未完成" description={snapshot.dreamSchedule.lastError} />}
        <Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
          仅在桌面应用运行时执行。需要全局工具权限和该 Workspace Expert 至少开放 assisted 级别及完整长期记忆工具；调度器不会自动扩大权限。Transcript 增量整理和到期质量复查在同一维护任务中串行完成。
        </Paragraph>
      </Card>
      <Card size="small" style={{ marginTop: 10, marginBottom: 10 }}>
        <Space wrap align="center">
          <Text strong>语义检索索引</Text>
          <Tag color={snapshot.embeddingIndex.enabled ? "success" : "default"}>
            {snapshot.embeddingIndex.enabled ? "本地 Ollama 已启用" : "未启用"}
          </Tag>
          <Text type="secondary">
            {snapshot.embeddingIndex.enabled
              ? "向量 " + snapshot.embeddingIndex.indexed + " / " + snapshot.embeddingIndex.total + " · 待建立 " + snapshot.embeddingIndex.missing
              : "当前使用 FTS5 / 中文短语词法检索"}
          </Text>
          <Button size="small" loading={embeddingRunning} disabled={!snapshot.embeddingIndex.enabled || running}
            onClick={() => void reindexEmbeddings()}>
            建立 / 补齐本地向量索引
          </Button>
        </Space>
        <Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
          Embedding 设置位于 Settings → Agent → Memory 语义检索。向量只保存在本地 SQLite；内容发生变化时旧向量自动失效，切换模型后需重新建立索引。
        </Paragraph>
      </Card>
      <div className="memory-manager-stats">
        <Card><Statistic title="活动 Notes" value={activeNotes.length} /></Card>
        <Card><Statistic title="已验证" value={validated} /></Card>
        <Card><Statistic title="存在争议" value={disputed} /></Card>
        <Card><Statistic title="待质量复查" value={qualityDue} /></Card>
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
          { key: "evidence", label: "固定证据集 · " + selectedRun.run.evidence.length, children: <List size="small" pagination={{ pageSize: 8 }} dataSource={selectedRun.run.evidence} renderItem={source => <List.Item><List.Item.Meta title={<Space><Text strong>{source.kind}</Text><Text type="secondary">{dateOf(source.createdAt)}</Text><Tag>{source.sourceId}</Tag>{source.revision !== undefined && <Tag>Revision {source.revision}</Tag>}</Space>} description={<Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{source.content}</Paragraph>} /></List.Item>} /> },
          { key: "operations", label: "变更审计 · " + selectedRun.operations.length, children: <List size="small" pagination={{ pageSize: 8 }} dataSource={selectedRun.operations} renderItem={operation => <List.Item><List.Item.Meta title={<Space><Tag color="blue">{valueOf(operation, "operation")}</Tag><Text code>{valueOf(operation, "entityId")}</Text></Space>} description={<><Paragraph>{valueOf(operation, "reason")}</Paragraph><Text type="secondary">序号 {valueOf(operation, "sequence")} · {valueOf(operation, "entityType")}</Text><Collapse size="small" items={[{ key: "before", label: "变更前快照", children: <pre className="memory-json">{valueOf(operation, "before") || "（新建实体）"}</pre> }, { key: "after", label: "变更后快照", children: <pre className="memory-json">{valueOf(operation, "after") || "（已删除实体）"}</pre> }]} /></>} /></List.Item>} /> },
        ]} />
      </>}
    </Modal>
  </section>;
}
