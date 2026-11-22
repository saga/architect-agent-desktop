import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import { BellOutlined, CalendarOutlined, FolderOpenOutlined, PlusOutlined, RobotOutlined, SettingOutlined, TeamOutlined } from "@ant-design/icons";
import type { AgentTask, AgentWorkspaceSnapshot } from "../shared/types";

export type PureAgentSection = "chat" | "schedule" | "expert" | "opportunities";

interface PureAgentSidebarProps {
  snapshot: AgentWorkspaceSnapshot;
  section: PureAgentSection;
  onSectionChange: (section: PureAgentSection) => void;
  onNewTask: () => void;
  onActivateTask: (taskId: string) => void;
  onAddWorkspace: () => void;
  onActivateWorkspace: (workspacePath: string | null) => void;
  onOpenSettings: () => void;
  onSwitchToSidepanel: () => void;
}

function taskSubtitle(task: AgentTask): string {
  const time = new Date(task.updatedAt);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PureAgentSidebar({
  snapshot, section, onSectionChange, onNewTask, onActivateTask, onAddWorkspace,
  onActivateWorkspace, onOpenSettings, onSwitchToSidepanel,
}: PureAgentSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(snapshot.workspaces.map(item => item.path ?? "__personal__")));
  const knownWorkspaceKeys = useRef(new Set(snapshot.workspaces.map(item => item.path ?? "__personal__")));
  useEffect(() => {
    const currentKeys = new Set(snapshot.workspaces.map(item => item.path ?? "__personal__"));
    const added = [...currentKeys].filter(key => !knownWorkspaceKeys.current.has(key));
    if (added.length) setExpanded(current => new Set([...current, ...added]));
    knownWorkspaceKeys.current = currentKeys;
  }, [snapshot.workspaces]);
  const tasksByWorkspace = useMemo(() => {
    const grouped = new Map<string, AgentTask[]>();
    for (const task of snapshot.tasks) {
      const key = task.workspacePath ?? "__personal__";
      const list = grouped.get(key) ?? [];
      list.push(task);
      grouped.set(key, list);
    }
    return grouped;
  }, [snapshot.tasks]);

  const toggleExpanded = (key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return <aside className="pure-sidebar">
    <header className="pure-sidebar-brand">
      <div className="pure-brand-mark"><RobotOutlined /></div>
      <div className="pure-brand-copy"><strong>Architect Agent</strong><span>Workspace</span></div>
      <Tooltip title="切换到浏览器 Sidepanel">
        <Button type="text" size="small" onClick={onSwitchToSidepanel}>Sidepanel</Button>
      </Tooltip>
    </header>

    <div className="pure-primary-actions">
      <Button type="primary" block icon={<PlusOutlined />} onClick={onNewTask}>New task</Button>
    </div>

    <nav className="pure-sidebar-nav" aria-label="Agent workspace navigation">
      <button type="button" className={section === "schedule" ? "active" : ""} onClick={() => onSectionChange("schedule")}>
        <CalendarOutlined /><span>定时任务</span>
        {snapshot.schedules.some(item => item.enabled) && <span className="pure-nav-count">{snapshot.schedules.filter(item => item.enabled).length}</span>}
      </button>
      <button type="button" className={section === "expert" ? "active" : ""} onClick={() => onSectionChange("expert")}>
        <TeamOutlined /><span>Expert</span>
        <span className="pure-nav-count">{snapshot.experts.length}</span>
      </button>
      <button type="button" className={section === "opportunities" ? "active" : ""} onClick={() => onSectionChange("opportunities")}>
        <BellOutlined /><span>主动建议</span>
        {!snapshot.proactiveSettings?.quietMode && (snapshot.proactiveOpportunities?.length ?? 0) > 0 && <span className="pure-nav-count">{snapshot.proactiveOpportunities?.length}</span>}
      </button>
    </nav>

    <div className="pure-workspace-list">
      <div className="pure-workspace-heading">
        <span>Workspaces</span>
        <Tooltip title="添加本地文件夹"><Button type="text" size="small" icon={<PlusOutlined />} onClick={onAddWorkspace} /></Tooltip>
      </div>
      {snapshot.workspaces.map(workspace => {
        const key = workspace.path ?? "__personal__";
        const items = tasksByWorkspace.get(key) ?? [];
        const isExpanded = expanded.has(key);
        const isActiveWorkspace = snapshot.tasks.some(task => task.id === snapshot.activeTaskId && task.workspacePath === workspace.path);
        return <section className={"pure-workspace-group" + (isActiveWorkspace ? " active" : "")} key={key}>
          <div className="pure-workspace-row">
            <button type="button" className="pure-workspace-toggle" onClick={() => toggleExpanded(key)} aria-expanded={isExpanded}>
              <span className={"pure-chevron" + (isExpanded ? " expanded" : "")}>›</span>
              <FolderOpenOutlined />
              <span className="pure-workspace-name" title={workspace.path ?? "不关联本地文件夹"}>{workspace.name ?? "个人工作区"}</span>
              <span className="pure-workspace-count">{workspace.taskCount}</span>
            </button>
            <Tooltip title="在此 Workspace 新建任务">
              <button type="button" className="pure-workspace-new" aria-label={"在 " + (workspace.name ?? "个人工作区") + " 新建任务"}
                onClick={() => onActivateWorkspace(workspace.path)}>+</button>
            </Tooltip>
          </div>
          {isExpanded && <div className="pure-task-list">
            {items.map(task => <button type="button" key={task.id}
              className={"pure-task-item" + (task.id === snapshot.activeTaskId ? " active" : "")}
              onClick={() => { onSectionChange("chat"); onActivateTask(task.id); }}>
              <span className="pure-task-dot" />
              <span className="pure-task-title" title={task.title}>{task.title}</span>
              <span className="pure-task-date">{taskSubtitle(task)}</span>
            </button>)}
          </div>}
        </section>;
      })}
      {!snapshot.workspaces.length && <div className="pure-sidebar-empty">添加本地文件夹，开始组织任务</div>}
    </div>

    <footer className="pure-sidebar-footer">
      <div className="pure-sidebar-provider">
        <span className="pure-status-dot" />
        <span>{snapshot.tasks.length} 个 Task</span>
      </div>
      <Button block type="text" icon={<SettingOutlined />} onClick={onOpenSettings}>Settings</Button>
    </footer>
  </aside>;
}
