import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Divider, Empty, Select, Space, Switch, Tag, Typography, message } from "antd";
import type { AgentMemoryCandidate, AgentProactiveOpportunity, AgentProactiveSettings, ProactiveCategory, ProactiveFeedbackAction } from "../shared/types";

const { Text, Paragraph } = Typography;
const DEFAULT_SETTINGS: AgentProactiveSettings = {
  enabled: true, quietMode: false, maxPerDay: 5, cooldownHours: 24,
  categories: { preference_confirmation: true, follow_up_confirmation: true, follow_up_due: true, repeated_tool_failure: true, blocker: true },
};
const CATEGORY_LABEL: Record<ProactiveCategory, string> = {
  preference_confirmation: "待确认偏好",
  follow_up_confirmation: "待确认跟进",
  follow_up_due: "到期跟进",
  repeated_tool_failure: "工具连续失败",
  blocker: "任务阻塞",
};
const STATUS_LABEL: Record<string, string> = {
  new: "新建议", presented: "已展示", pending_confirmation: "待确认", scheduled: "已安排",
  accepted: "已接受", snoozed: "已延后", dismissed: "已忽略", acted: "已处理", expired: "已过期",
};
function dateTime(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toLocaleString() : "";
}

export default function ProactiveInbox({ taskId, opportunities, candidates = [], settings: initialSettings, onChanged }: {
  taskId: string;
  opportunities: AgentProactiveOpportunity[];
  candidates?: AgentMemoryCandidate[];
  settings?: AgentProactiveSettings;
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<AgentProactiveSettings>(initialSettings ?? DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyId, setBusyId] = useState("");
  useEffect(() => { if (initialSettings) setSettings(initialSettings); }, [initialSettings]);
  const active = useMemo(() => opportunities.filter(item => !["expired", "dismissed", "acted"].includes(item.status)), [opportunities]);
  const linkedCandidateIds = useMemo(() => new Set(opportunities
    .filter(item => item.category === "preference_confirmation")
    .map(item => String(item.payload.candidateId ?? ""))
    .filter(Boolean)), [opportunities]);
  const reviewCandidates = useMemo(() => candidates.filter(candidate => candidate.status === "pending" &&
    (!(settings.enabled && settings.categories.preference_confirmation) || !linkedCandidateIds.has(candidate.id))),
    [candidates, linkedCandidateIds, settings]);

  const saveSettings = async (next: AgentProactiveSettings) => {
    setSettings(next);
    setSavingSettings(true);
    try {
      const saved = await window.browser.agentProactiveSaveSettings(next);
      setSettings(saved);
      message.success("主动建议设置已保存。");
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const feedback = async (item: AgentProactiveOpportunity, action: ProactiveFeedbackAction) => {
    if (!taskId) return;
    setBusyId(item.id);
    try {
      const result = await window.browser.agentProactiveFeedback(taskId, item.id, action);
      if (result.noteId) message.success("已确认并保存偏好 Memory。");
      else if (action === "accept" && item.category === "follow_up_confirmation") message.success("已确认跟进时间，到期后会出现在主动建议中。");
      else if (action === "snooze") message.success("已延后提醒。");
      else if (action === "irrelevant") message.success("已记录为不相关，并抑制同类建议。");
      else if (action === "dismiss") message.success("已忽略该建议。");
      else message.success("已更新建议状态。");
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId("");
    }
  };

  const toggleCategory = (category: ProactiveCategory, checked: boolean) => {
    void saveSettings({ ...settings, categories: { ...settings.categories, [category]: checked } });
  };

  const reviewCandidate = async (candidate: AgentMemoryCandidate, action: "accept" | "reject") => {
    if (!taskId) return;
    setBusyId(candidate.id);
    try {
      const result = await window.browser.agentMemoryCandidateFeedback(taskId, candidate.id, action);
      if (result.noteId) message.success("已确认并保存偏好 Memory。");
      else message.success("已拒绝该偏好候选。");
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId("");
    }
  };

  return <section style={{ padding: 20, overflow: "auto", height: "100%" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>主动建议</Typography.Title>
        <Text type="secondary">根据本地 Task、Trace 和已确认的时间承诺生成。建议不会自动执行工具或外部操作。</Text>
      </div>
      <Tag color="blue">{active.length} 条待处理</Tag>
    </div>
    <Card size="small" title="主动性控制" style={{ marginBottom: 16 }}>
      <Space wrap size="large" style={{ marginBottom: 12 }}>
        <Space><Switch checked={settings.enabled} loading={savingSettings} onChange={enabled => void saveSettings({ ...settings, enabled })} /><Text>启用主动建议</Text></Space>
        <Space><Switch checked={settings.quietMode} loading={savingSettings} onChange={quietMode => void saveSettings({ ...settings, quietMode })} /><Text>安静模式</Text></Space>
        <Space><Text>每日最多展示</Text><Select size="small" style={{ width: 88 }} value={settings.maxPerDay} disabled={!settings.enabled || savingSettings}
          options={[3, 5, 8, 10, 15, 20].map(value => ({ value, label: String(value) }))}
          onChange={maxPerDay => void saveSettings({ ...settings, maxPerDay })} /></Space>
        <Space><Text>忽略后的冷却</Text><Select size="small" style={{ width: 100 }} value={settings.cooldownHours} disabled={!settings.enabled || savingSettings}
          options={[6, 12, 24, 48, 72, 168].map(value => ({ value, label: value >= 24 ? (value / 24) + " 天" : value + " 小时" }))}
          onChange={cooldownHours => void saveSettings({ ...settings, cooldownHours })} /></Space>
      </Space>
      <Divider style={{ margin: "8px 0 12px" }} />
      <Space wrap size="large">
        {(["preference_confirmation", "follow_up_confirmation", "follow_up_due", "repeated_tool_failure", "blocker"] as ProactiveCategory[]).map(category =>
          <Space key={category} size={6}>
            <Switch size="small" checked={settings.categories[category]} disabled={savingSettings || !settings.enabled}
              onChange={checked => toggleCategory(category, checked)} />
            <Text>{CATEGORY_LABEL[category]}</Text>
          </Space>)}
      </Space>
      <Paragraph type="secondary" style={{ margin: "12px 0 0", fontSize: 12 }}>
        安静模式下只保留列表内建议，不发送系统通知。当前版本不使用主动弹窗，也不会为建议启动模型调用。
      </Paragraph>
    </Card>
    {!settings.enabled && <Alert type="info" showIcon message="主动建议已关闭" description="主动建议卡片已关闭，但偏好候选仍会保留在下方供你确认或拒绝。重新启用后，其他领域事件会继续评估。" />}
    {reviewCandidates.length > 0 && <Card size="small" title="待审核的偏好候选" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {reviewCandidates.map(candidate => <div key={candidate.id}>
          <Space wrap style={{ marginBottom: 4 }}>
            <Text strong>{candidate.category}</Text>
            <Tag color="processing">{candidate.strength==="explicit"?"明确表达":candidate.strength==="repeated_correction"?"重复纠正":"强信号"}</Tag>
            {candidate.scope===null&&<Tag color="purple">跨项目 Personal Memory</Tag>}
          </Space>
          <Paragraph style={{ marginBottom: 6 }}>{candidate.statement}</Paragraph>
          {candidate.scope===null&&<Text type="secondary" style={{fontSize:12}}>确认后会在所有 Workspace 中作为用户偏好使用。</Text>}
          <div style={{ marginTop: 6 }}>
            <Space>
              <Button type="primary" size="small" loading={busyId===candidate.id} onClick={()=>void reviewCandidate(candidate,"accept")}>
                {candidate.scope===null?"确认并保存到跨项目 Memory":"确认并保存到当前 Workspace"}
              </Button>
              <Button size="small" loading={busyId===candidate.id} onClick={()=>void reviewCandidate(candidate,"reject")}>拒绝候选</Button>
            </Space>
          </div>
        </div>)}
      </Space>
    </Card>}
        {settings.enabled && active.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前没有需要你处理的建议。新的 Task 事件或到期条件出现时，这里会更新。" />}
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {active.map(item => <Card key={item.id} size="small"
        title={<Space wrap><Text strong>{item.title}</Text><Tag>{CATEGORY_LABEL[item.category]}</Tag><Tag color={item.status === "pending_confirmation" ? "processing" : "default"}>{STATUS_LABEL[item.status] ?? item.status}</Tag></Space>}
        extra={item.dueAt ? <Text type="secondary">{item.status === "scheduled" ? "计划提醒：" : "跟进时间："}{dateTime(item.dueAt)}</Text> : undefined}>
        <Paragraph style={{ marginBottom: 8 }}>{item.explanation}</Paragraph>
        <Text type="secondary" style={{ fontSize: 12 }}>建议动作：{item.suggestedAction}</Text>
        <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 11 }}>来源 Trace：{item.sourceRefs.length ? item.sourceRefs.join(" · ") : "无记录"}</Text></div>
        <Divider style={{ margin: "10px 0" }} />
        <Space wrap>
          {item.category === "preference_confirmation" && <>
            <Button type="primary" size="small" loading={busyId === item.id} onClick={() => void feedback(item, "accept")}>{item.scope===null?"确认并保存到跨项目 Memory":"确认并保存偏好"}</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "dismiss")}>拒绝</Button>
          </>}
          {item.category === "follow_up_confirmation" && <>
            <Button type="primary" size="small" loading={busyId === item.id} onClick={() => void feedback(item, "accept")}>确认跟进时间</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "snooze")}>稍后提醒</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "irrelevant")}>不相关</Button>
          </>}
          {item.category === "follow_up_due" && <>
            <Button type="primary" size="small" loading={busyId === item.id} onClick={() => void feedback(item, "acted")}>已处理</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "snooze")}>延后一天</Button>
          </>}
          {(item.category === "repeated_tool_failure" || item.category === "blocker") && <>
            <Button type="primary" size="small" loading={busyId === item.id} onClick={() => void feedback(item, "acted")}>标记已处理</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "snooze")}>稍后处理</Button>
            <Button size="small" loading={busyId === item.id} onClick={() => void feedback(item, "irrelevant")}>不相关</Button>
          </>}
        </Space>
      </Card>)}
    </Space>
  </section>;
}
