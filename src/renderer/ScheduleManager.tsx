import { useMemo, useState } from "react";
import { Button, Empty, Input, Popconfirm, Select, Tag, message } from "antd";
import {
  CalendarOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined,
  HistoryOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined,
} from "@ant-design/icons";
import type { AgentSchedule, AgentScheduleRepeat, AgentScheduleRun, AgentWorkspaceSnapshot } from "../shared/types";

interface ScheduleManagerProps {
  snapshot: AgentWorkspaceSnapshot;
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
}

type ScheduleView = "schedules" | "runs";
type ScheduleFilter = "all" | "enabled" | "paused";
type RunFilter = "all" | "running" | "success" | "error";

const WEEKDAYS = [
  { value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" }, { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dateValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ruleLabel(schedule: AgentSchedule): string {
  switch (schedule.repeat) {
    case "none": return "仅执行一次";
    case "interval": return `每隔 ${schedule.intervalMinutes ?? 60} 分钟`;
    case "daily": return "每天";
    case "weekly":
    case "biweekly": {
      const days = schedule.weekdays?.length
        ? schedule.weekdays
        : [new Date(schedule.runAt).getDay()];
      const labels = WEEKDAYS.filter(item => days.includes(item.value)).map(item => item.label).join("、");
      return (schedule.repeat === "biweekly" ? "每双周 " : "每周 ") + labels;
    }
    case "monthly": return "每月 " + (schedule.monthDays?.length ? schedule.monthDays : [new Date(schedule.runAt).getDate()]).join("、") + " 日";
    case "yearly": {
      const date = new Date(schedule.runAt);
      return `每年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }
  }
}

function runStatusLabel(run: AgentScheduleRun): string {
  if (run.status === "running") return "运行中";
  return run.status === "success" ? "成功" : "失败";
}

function useTemplate(template: "daily-brief" | "weekly-report" | "monthly-review") {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (template === "daily-brief") {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return {
      title: "每日 AI 行业简报",
      prompt: "整理过去 24 小时 AI 行业的重要动态。优先引用官方公告、产品发布和原始研究资料，区分已确认事实与分析判断，输出中文摘要并附来源链接。",
      repeat: "daily" as const,
      runAt: next,
    };
  }
  if (template === "weekly-report") {
    const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
    next.setDate(next.getDate() + daysUntilMonday);
    next.setHours(9, 0, 0, 0);
    return {
      title: "每周项目进展",
      prompt: "检查当前 Workspace 中本周的代码、文档和项目变更，汇总已完成事项、进行中事项、风险与下周计划。引用具体文件或提交作为依据，不要臆测。",
      repeat: "weekly" as const,
      runAt: next,
    };
  }
  next.setMonth(next.getMonth() + 1, 1);
  next.setHours(9, 0, 0, 0);
  return {
    title: "月度工作复盘",
    prompt: "基于当前 Workspace 的工作记录和项目资料，整理上月完成的主要工作、关键变化、遗留问题和下月优先事项。区分有证据的事实和建议。",
    repeat: "monthly" as const,
    runAt: next,
  };
}

export default function ScheduleManager({ snapshot, onChanged, onOpenTask }: ScheduleManagerProps) {
  const activeTask = snapshot.tasks.find(task => task.id === snapshot.activeTaskId);
  const [view, setView] = useState<ScheduleView>("schedules");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspacePath, setWorkspacePath] = useState(activeTask?.workspacePath ?? "");
  const [expertId, setExpertId] = useState(activeTask?.expertId ?? "");
  const [runAt, setRunAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [repeat, setRepeat] = useState<AgentScheduleRepeat>("none");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDays, setMonthDays] = useState<number[]>([]);
  const [endsOn, setEndsOn] = useState("");

  const filteredSchedules = useMemo(() => snapshot.schedules.filter(schedule => {
    if (scheduleFilter === "enabled" && !schedule.enabled) return false;
    if (scheduleFilter === "paused" && schedule.enabled) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || schedule.title.toLocaleLowerCase().includes(query) || schedule.prompt.toLocaleLowerCase().includes(query);
  }), [snapshot.schedules, scheduleFilter, search]);

  const filteredRuns = useMemo(() => snapshot.scheduleRuns.filter(run => {
    if (runFilter !== "all" && run.status !== runFilter) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || run.scheduleTitle.toLocaleLowerCase().includes(query)
      || (run.error ?? "").toLocaleLowerCase().includes(query)
      || (run.resultPreview ?? "").toLocaleLowerCase().includes(query);
  }), [snapshot.scheduleRuns, runFilter, search]);

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setPrompt("");
    setWorkspacePath(activeTask?.workspacePath ?? "");
    setExpertId(activeTask?.expertId ?? "");
    setRunAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat("none");
    setIntervalMinutes(60);
    setWeekdays([]);
    setMonthDays([]);
    setEndsOn("");
  };

  const openCreate = (template?: ReturnType<typeof useTemplate>) => {
    reset();
    if (template) {
      setTitle(template.title);
      setPrompt(template.prompt);
      setRepeat(template.repeat);
      setRunAt(localDateTimeValue(template.runAt));
      if (template.repeat === "weekly") setWeekdays([1, 2, 3, 4, 5]);
      if (template.repeat === "monthly") setMonthDays([1]);
    }
    setShowForm(true);
    setView("schedules");
  };

  const openEdit = (schedule: AgentSchedule) => {
    setEditingId(schedule.id);
    setTitle(schedule.title);
    setPrompt(schedule.prompt);
    setWorkspacePath(schedule.workspacePath ?? "");
    setExpertId(schedule.expertId ?? "");
    setRunAt(localDateTimeValue(new Date(schedule.runAt)));
    setRepeat(schedule.repeat);
    setIntervalMinutes(schedule.intervalMinutes ?? 60);
    setWeekdays(schedule.weekdays ?? []);
    setMonthDays(schedule.monthDays ?? []);
    setEndsOn(dateValue(schedule.endsAt ?? undefined));
    setShowForm(true);
    setView("schedules");
  };

  const createOrUpdate = async () => {
    if (!title.trim() || !prompt.trim() || !runAt) {
      message.warning("请填写任务名称、执行指令和首次执行时间。");
      return;
    }
    const instant = new Date(runAt);
    if (!Number.isFinite(instant.getTime())) {
      message.error("执行时间无效。");
      return;
    }
    const existing = editingId ? snapshot.schedules.find(item => item.id === editingId) : undefined;
    if (instant.getTime() <= Date.now() && (existing?.enabled ?? true)) {
      message.warning("首次执行时间需要晚于当前时间。");
      return;
    }
    const end = endsOn ? new Date(endsOn + "T23:59:59") : null;
    if (end && (!Number.isFinite(end.getTime()) || end.getTime() < instant.getTime())) {
      message.error("有效期不能早于首次执行时间。");
      return;
    }

    setSaving(true);
    try {
      const id = editingId ?? crypto.randomUUID();
      await window.browser.saveAgentSchedule({
        ...(existing ?? {}),
        id,
        title: title.trim(),
        prompt: prompt.trim(),
        workspacePath: workspacePath || null,
        expertId: expertId || null,
        runAt: instant.toISOString(),
        repeat,
        intervalMinutes: repeat === "interval" ? intervalMinutes : undefined,
        weekdays: repeat === "weekly" || repeat === "biweekly" ? (weekdays.length ? weekdays : [instant.getDay()]) : undefined,
        monthDays: repeat === "monthly" ? (monthDays.length ? monthDays : [instant.getDate()]) : undefined,
        endsAt: end?.toISOString() ?? null,
        enabled: existing?.enabled ?? true,
      });
      setShowForm(false);
      reset();
      onChanged();
      message.success(editingId ? "定时任务已更新。" : "已创建本地定时任务。");
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
      message.success("定时任务已删除；已有运行记录会保留。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runNow = async (schedule: AgentSchedule) => {
    setRunningId(schedule.id);
    try {
      await window.browser.runAgentScheduleNow(schedule.id);
      onChanged();
      message.success("定时任务已执行。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningId(null);
    }
  };

  const toggleNumber = (values: number[], value: number, setter: (next: number[]) => void) => {
    setter(values.includes(value) ? values.filter(item => item !== value) : [...values, value].sort((a, b) => a - b));
  };

  const formatDuration = (value?: number) => {
    if (value === undefined) return "—";
    if (value < 1000) return value + " ms";
    if (value < 60_000) return (value / 1000).toFixed(1) + " 秒";
    return Math.floor(value / 60_000) + " 分钟 " + Math.floor((value % 60_000) / 1000) + " 秒";
  };

  return <section className="pure-management-page pure-schedule-page">
    <header className="pure-page-heading">
      <div>
        <div className="pure-page-eyebrow"><CalendarOutlined /> AUTOMATION</div>
        <h1>定时任务</h1>
        <p>按计划触发 Agent，集中查看每次运行的状态和结果。任务只在桌面应用运行期间执行。</p>
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>新建任务</Button>
    </header>

    <div className="pure-schedule-tabs">
      <button type="button" className={view === "schedules" ? "active" : ""} onClick={() => setView("schedules")}>
        定时任务 <span>{snapshot.schedules.length}</span>
      </button>
      <button type="button" className={view === "runs" ? "active" : ""} onClick={() => setView("runs")}>
        运行记录 <span>{snapshot.scheduleRuns.length}</span>
      </button>
    </div>

    <div className="pure-schedule-toolbar">
      <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder={view === "schedules" ? "搜索任务名称或指令" : "搜索任务、结果或错误"} />
      {view === "schedules"
        ? <Select value={scheduleFilter} onChange={setScheduleFilter} options={[
            { value: "all", label: "全部状态" }, { value: "enabled", label: "已启用" }, { value: "paused", label: "已暂停" },
          ]} />
        : <Select value={runFilter} onChange={setRunFilter} options={[
            { value: "all", label: "全部记录" }, { value: "running", label: "运行中" },
            { value: "success", label: "成功" }, { value: "error", label: "失败" },
          ]} />}
    </div>

    {view === "schedules" && <>
      {!snapshot.schedules.length && !showForm && <div className="pure-schedule-templates">
        <div className="pure-schedule-templates-title">从常用任务开始</div>
        <div className="pure-schedule-template-grid">
          <button type="button" onClick={() => openCreate(useTemplate("daily-brief"))}>
            <strong>每日 AI 行业简报</strong><span>每天收集行业动态并整理来源</span>
          </button>
          <button type="button" onClick={() => openCreate(useTemplate("weekly-report"))}>
            <strong>每周项目进展</strong><span>汇总 Workspace 中的变更和风险</span>
          </button>
          <button type="button" onClick={() => openCreate(useTemplate("monthly-review"))}>
            <strong>月度工作复盘</strong><span>回顾阶段成果并整理下月计划</span>
          </button>
        </div>
      </div>}

      {showForm && <section className="pure-editor-card pure-schedule-editor">
        <div className="pure-editor-title">{editingId ? "编辑定时任务" : "新建定时任务"}</div>
        <label>任务名称<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="例如：每周整理项目进展" /></label>
        <label>执行指令<textarea rows={5} maxLength={30000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="写清楚任务目标、执行范围、结果格式，以及需要保留的证据或来源。" /></label>
        <div className="pure-form-grid">
          <label>Workspace
            <select value={workspacePath} onChange={event => setWorkspacePath(event.target.value)}>
              <option value="">个人工作区（不访问项目文件）</option>
              {snapshot.workspaces.filter(item => item.path).map(item => <option key={item.path} value={item.path as string}>{item.name}</option>)}
            </select>
          </label>
          <label>Expert
            <select value={expertId} onChange={event => setExpertId(event.target.value)}>
              <option value="">跟随当前全局 Agent 设置</option>
              {snapshot.experts.map(expert => <option key={expert.id} value={expert.id}>{expert.name}</option>)}
            </select>
          </label>
          <label>首次执行时间<input type="datetime-local" value={runAt} onChange={event => setRunAt(event.target.value)} /></label>
          <label>重复规则
            <select value={repeat} onChange={event => setRepeat(event.target.value as AgentScheduleRepeat)}>
              <option value="none">仅执行一次</option>
              <option value="interval">按间隔重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="biweekly">每双周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
            </select>
          </label>
          {repeat === "interval" && <label>执行间隔（分钟）
            <input type="number" min={1} max={525600} value={intervalMinutes}
              onChange={event => setIntervalMinutes(Math.max(1, Math.min(525600, Number(event.target.value) || 1)))} />
          </label>}
          {(repeat === "weekly" || repeat === "biweekly") && <fieldset className="pure-schedule-choice-field">
            <legend>执行日</legend>
            <div className="pure-schedule-choice-list">
              {WEEKDAYS.map(day => <label key={day.value}>
                <input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => toggleNumber(weekdays, day.value, setWeekdays)} />
                {day.label}
              </label>)}
            </div>
          </fieldset>}
          {repeat === "monthly" && <fieldset className="pure-schedule-choice-field">
            <legend>每月执行日期</legend>
            <div className="pure-schedule-month-days">
              {MONTH_DAYS.map(day => <label key={day}>
                <input type="checkbox" checked={monthDays.includes(day)} onChange={() => toggleNumber(monthDays, day, setMonthDays)} />
                {day}
              </label>)}
            </div>
          </fieldset>}
          {repeat !== "none" && <label>有效期截止日期（可选）
            <input type="date" value={endsOn} onChange={event => setEndsOn(event.target.value)} />
          </label>}
        </div>
        <div className="pure-editor-actions">
          <Button onClick={() => { setShowForm(false); reset(); }}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void createOrUpdate()}>{editingId ? "保存修改" : "创建任务"}</Button>
        </div>
        <p className="pure-form-help">任务会使用指定 Workspace 和 Expert，以独立 Session 执行并保留运行记录。它继承当前 Agent 的模型和权限；无人值守任务不会自动提升权限。应用退出或电脑休眠期间不会执行，重新启动后只处理当前已到期的任务，不逐次补跑错过的周期。</p>
      </section>}

      <div className="pure-schedule-list">
        {!filteredSchedules.length && (snapshot.schedules.length || search || scheduleFilter !== "all")
          ? <Empty description="没有符合条件的定时任务" />
          : filteredSchedules.map(schedule => <article className={"pure-schedule-card" + (schedule.enabled ? "" : " disabled")} key={schedule.id}>
            <div className="pure-schedule-main">
              <div className="pure-schedule-title-row">
                <strong>{schedule.title}</strong>
                <Tag color={!schedule.enabled ? "default" : schedule.lastRunStatus === "error" ? "error" : "success"}>
                  {!schedule.enabled ? "已暂停" : schedule.lastRunStatus === "error" ? "上次失败" : "已启用"}
                </Tag>
              </div>
              <p>{schedule.prompt}</p>
              <div className="pure-schedule-meta">
                <span><ClockCircleOutlined /> 下次执行：{schedule.enabled ? formatDate(schedule.runAt) : "已暂停"}</span>
                <span>{ruleLabel(schedule)}</span>
                <span>{schedule.workspacePath ? snapshot.workspaces.find(item => item.path === schedule.workspacePath)?.name ?? schedule.workspacePath : "个人工作区"}</span>
                {schedule.lastRunAt && <span>上次运行：{formatDate(new Date(schedule.lastRunAt).toISOString())} · {schedule.lastRunStatus === "success" ? "成功" : "失败"}</span>}
                {schedule.endsAt && <span>有效期至：{new Date(schedule.endsAt).toLocaleDateString()}</span>}
              </div>
              {schedule.lastError && <div className="pure-schedule-error">{schedule.lastError}</div>}
            </div>
            <div className="pure-schedule-actions">
              <Button size="small" icon={<PlayCircleOutlined />} loading={runningId === schedule.id}
                disabled={Boolean(runningId && runningId !== schedule.id)} onClick={() => void runNow(schedule)}>立即运行</Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(schedule)}>编辑</Button>
              <Button size="small" onClick={() => void updateEnabled(schedule, !schedule.enabled)}>{schedule.enabled ? "暂停" : "启用"}</Button>
              <Popconfirm title="删除这个定时任务？" description="已有运行记录和执行结果会保留。" okText="删除" cancelText="取消" onConfirm={() => void remove(schedule)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </article>)}
      </div>
    </>}

    {view === "runs" && <div className="pure-schedule-runs">
      {!filteredRuns.length ? <Empty description="还没有符合条件的运行记录" /> : filteredRuns.map(run => <article className="pure-schedule-run-card" key={run.id}>
        <div className="pure-schedule-run-heading">
          <strong>{run.scheduleTitle}</strong>
          <Tag color={run.status === "success" ? "success" : run.status === "error" ? "error" : "processing"}>{runStatusLabel(run)}</Tag>
        </div>
        <div className="pure-schedule-meta">
          <span>{formatDate(new Date(run.startedAt).toISOString())}</span>
          <span>{run.trigger === "manual" ? "手动运行" : "计划触发"}</span>
          <span>耗时：{formatDuration(run.durationMs)}</span>
        </div>
        {run.resultPreview && <p className="pure-schedule-run-preview">{run.resultPreview}</p>}
        {run.error && <p className="pure-schedule-error">{run.error}</p>}
        <div className="pure-schedule-run-actions">
          {run.taskId && <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => onOpenTask(run.taskId as string)}>查看完整执行对话</Button>}
          {run.status === "running" && <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onChanged}>刷新状态</Button>}
        </div>
      </article>)}
    </div>}
  </section>;
}
