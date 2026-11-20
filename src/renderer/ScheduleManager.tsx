import { useEffect, useState } from "react";
import { Button, Popconfirm, message } from "antd";
import { CalendarOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { AgentSchedule, AgentWorkspaceSnapshot } from "../shared/types";

interface ScheduleManagerProps {
  snapshot: AgentWorkspaceSnapshot;
  onChanged: () => void;
}

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ScheduleManager({ snapshot, onChanged }: ScheduleManagerProps) {
  const activeTask = snapshot.tasks.find(task => task.id === snapshot.activeTaskId);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspacePath, setWorkspacePath] = useState(activeTask?.workspacePath ?? "");
  const [expertId, setExpertId] = useState(activeTask?.expertId ?? "");
  const [runAt, setRunAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [repeat, setRepeat] = useState<AgentSchedule["repeat"]>("none");

  const reset = () => {
    setTitle("");
    setPrompt("");
    setWorkspacePath(activeTask?.workspacePath ?? "");
    setExpertId(activeTask?.expertId ?? "");
    setRunAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat("none");
  };

  useEffect(() => {
    if (!showForm) return;
    setWorkspacePath(activeTask?.workspacePath ?? "");
    setExpertId(activeTask?.expertId ?? "");
  }, [showForm, activeTask?.id, activeTask?.workspacePath, activeTask?.expertId]);

  const create = async () => {
    if (!title.trim() || !prompt.trim() || !runAt) {
      message.warning("请填写任务名称、执行指令和执行时间。");
      return;
    }
    const instant = new Date(runAt);
    if (!Number.isFinite(instant.getTime())) {
      message.error("执行时间无效。");
      return;
    }
    setSaving(true);
    try {
      await window.browser.saveAgentSchedule({
        id: crypto.randomUUID(),
        title: title.trim(),
        prompt: prompt.trim(),
        workspacePath: workspacePath || null,
        expertId: expertId || null,
        runAt: instant.toISOString(),
        repeat,
        enabled: true,
      });
      reset();
      setShowForm(false);
      onChanged();
      message.success("已创建本地定时任务。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const updateEnabled = async (schedule: AgentSchedule, enabled: boolean) => {
    try {
      await window.browser.saveAgentSchedule({ ...schedule, enabled });
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (schedule: AgentSchedule) => {
    try {
      await window.browser.deleteAgentSchedule(schedule.id);
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const workspaces = snapshot.workspaces;
  return <section className="pure-management-page">
    <header className="pure-page-heading">
      <div>
        <div className="pure-page-eyebrow"><CalendarOutlined /> AUTOMATION</div>
        <h1>Schedule</h1>
        <p>为 Agent 安排一次性或周期性任务。调度器在桌面应用运行期间执行。</p>
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { if (!showForm) reset(); setShowForm(value => !value); }}>New schedule</Button>
    </header>

    {showForm && <section className="pure-editor-card">
      <div className="pure-editor-title">创建定时任务</div>
      <label>任务名称<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="例如：每周整理项目进展" /></label>
      <label>执行指令<textarea rows={5} maxLength={30000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述到时间后 Agent 要完成的工作，以及结果应该保存在哪里。" /></label>
      <div className="pure-form-grid">
        <label>Workspace
          <select value={workspacePath} onChange={event => setWorkspacePath(event.target.value)}>
            <option value="">个人工作区（不访问项目文件）</option>
            {workspaces.filter(item => item.path).map(item => <option key={item.path} value={item.path as string}>{item.name}</option>)}
          </select>
        </label>
        <label>Expert
          <select value={expertId} onChange={event => setExpertId(event.target.value)}>
            <option value="">跟随全局 Agent 设置</option>
            {snapshot.experts.map(expert => <option key={expert.id} value={expert.id}>{expert.name}</option>)}
          </select>
        </label>
        <label>首次执行时间<input type="datetime-local" value={runAt} onChange={event => setRunAt(event.target.value)} /></label>
        <label>重复规则
          <select value={repeat} onChange={event => setRepeat(event.target.value as AgentSchedule["repeat"])}>
            <option value="none">仅执行一次</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
      </div>
      <div className="pure-editor-actions">
        <Button onClick={() => { setShowForm(false); reset(); }}>取消</Button>
        <Button type="primary" loading={saving} onClick={() => void create()}>保存 Schedule</Button>
      </div>
      <p className="pure-form-help">任务会以独立 Task 执行并保存对话结果。电脑休眠或应用退出期间不会执行；重新运行应用后，到期的一次性任务会继续尝试执行。</p>
    </section>}

    <div className="pure-schedule-list">
      {!snapshot.schedules.length && <div className="pure-empty-state"><CalendarOutlined /><strong>还没有 Schedule</strong><span>创建一个定时任务，让 Agent 按计划完成重复工作。</span></div>}
      {snapshot.schedules.map(schedule => <article className={"pure-schedule-card" + (schedule.enabled ? "" : " disabled")} key={schedule.id}>
        <div className="pure-schedule-main">
          <div className="pure-schedule-title-row"><strong>{schedule.title}</strong><span className={"pure-schedule-status " + (schedule.enabled ? "enabled" : "paused")}>{schedule.enabled ? "已启用" : "已暂停"}</span></div>
          <p>{schedule.prompt}</p>
          <div className="pure-schedule-meta">
            <span>下次执行：{formatDate(schedule.runAt)}</span>
            <span>{schedule.repeat === "none" ? "仅一次" : schedule.repeat === "daily" ? "每天" : "每周"}</span>
            <span>{schedule.workspacePath ? snapshot.workspaces.find(item => item.path === schedule.workspacePath)?.name ?? schedule.workspacePath : "个人工作区"}</span>
            {schedule.lastRunAt && <span>上次执行：{new Date(schedule.lastRunAt).toLocaleString()} · {schedule.lastRunStatus === "success" ? "成功" : "失败"}</span>}
          </div>
          {schedule.lastError && <div className="pure-schedule-error">{schedule.lastError}</div>}
        </div>
        <div className="pure-schedule-actions">
          <Button size="small" onClick={() => void updateEnabled(schedule, !schedule.enabled)}>{schedule.enabled ? "暂停" : "启用"}</Button>
          <Popconfirm title="删除这个 Schedule？" okText="删除" cancelText="取消" onConfirm={() => void remove(schedule)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      </article>)}
    </div>
  </section>;
}
