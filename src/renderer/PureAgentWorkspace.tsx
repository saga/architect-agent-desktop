import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Select, message } from "antd";
import { EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import type { AgentWorkspacePreferences, AgentWorkspaceRightTab, AgentWorkspaceSnapshot, BrowserState } from "../shared/types";
import AgentPanel from "./AgentPanel";
import ExpertManager from "./ExpertManager";
import PureAgentRightPanel from "./PureAgentRightPanel";
import PureAgentSidebar, { type PureAgentSection } from "./PureAgentSidebar";
import ScheduleManager from "./ScheduleManager";

interface PureAgentWorkspaceProps { browserState: BrowserState; }

interface SplitDrag {
  kind: "left" | "right";
  startX: number;
  startWidth: number;
}

export default function PureAgentWorkspace({ browserState }: PureAgentWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<AgentWorkspaceSnapshot | null>(null);
  const [section, setSection] = useState<PureAgentSection>("chat");
  const [loading, setLoading] = useState(true);
  const [splitDrag, setSplitDrag] = useState(false);
  const dragRef = useRef<SplitDrag | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const latestSnapshot = useRef<AgentWorkspaceSnapshot | null>(null);

  const refresh = useCallback(async () => {
    const result = await window.browser.getAgentWorkspaceSnapshot();
    latestSnapshot.current = result;
    setSnapshot(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void window.browser.getAgentWorkspaceSnapshot().then(result => {
      if (!active) return;
      latestSnapshot.current = result;
      setSnapshot(result);
      setLoading(false);
    }).catch(error => {
      if (active) {
        setLoading(false);
        message.error(error instanceof Error ? error.message : String(error));
      }
    });
    const unsubscribe = window.browser.onAgentWorkspaceUpdated(result => {
      latestSnapshot.current = result;
      setSnapshot(result);
    });
    return () => {
      active = false;
      unsubscribe();
      window.browser.setContentBounds({ top: 0, left: 0, width: 0 });
    };
  }, []);

  const preferences = snapshot?.preferences;
  const activeTask = useMemo(
    () => snapshot?.tasks.find(task => task.id === snapshot.activeTaskId) ?? null,
    [snapshot],
  );
  const activeExpert = useMemo(
    () => snapshot?.experts.find(expert => expert.id === activeTask?.expertId) ?? null,
    [snapshot, activeTask],
  );

  const savePreferences = async (next: AgentWorkspacePreferences) => {
    try {
      const saved = await window.browser.saveAgentWorkspacePreferences(next);
      setSnapshot(current => current ? { ...current, preferences: saved } : current);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const switchToSidepanel = async () => {
    if (!preferences) return;
    try {
      await window.browser.saveAgentWorkspacePreferences({ ...preferences, mode: "sidepanel" });
      await window.browser.redockAgentPanel("right");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const createTask = async (workspacePath = activeTask?.workspacePath ?? null) => {
    try {
      await window.browser.createAgentTask({
        title: "New task",
        workspacePath,
        expertId: activeTask?.expertId ?? null,
      });
      setSection("chat");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const activateTask = async (taskId: string) => {
    try {
      await window.browser.activateAgentTask(taskId);
      setSection("chat");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const addWorkspace = async () => {
    try {
      const task = await window.browser.agentAddWorkspace();
      if (task) {
        setSection("chat");
        await refresh();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const updateTaskExpert = async (expertId: string | null) => {
    if (!activeTask) return;
    try {
      await window.browser.setAgentTaskExpert(activeTask.id, expertId);
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const setRightTab = (tab: AgentWorkspaceRightTab) => {
    if (!preferences) return;
    void savePreferences({ ...preferences, rightPanelVisible: true, rightPanelTab: tab });
  };

  const toggleRightPane = () => {
    if (!preferences) return;
    void savePreferences({ ...preferences, rightPanelVisible: !preferences.rightPanelVisible });
  };

  const onSplitterPointerDown = (kind: SplitDrag["kind"], event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const width = kind === "left" ? preferences?.leftWidth ?? 280 : preferences?.rightWidth ?? 560;
    dragRef.current = { kind, startX: event.clientX, startWidth: width };
    setSplitDrag(true);
  };

  const onSplitterPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !preferences) return;
    const delta = event.clientX - drag.startX;
    if (drag.kind === "left") {
      const leftWidth = Math.max(220, Math.min(420, drag.startWidth + delta));
      setSnapshot(current => { if (!current) return current; const next = { ...current, preferences: { ...current.preferences, leftWidth } }; latestSnapshot.current = next; return next; });
    } else {
      const rightWidth = Math.max(360, Math.min(820, drag.startWidth - delta));
      setSnapshot(current => { if (!current) return current; const next = { ...current, preferences: { ...current.preferences, rightWidth } }; latestSnapshot.current = next; return next; });
    }
  };

  const onSplitterPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setSplitDrag(false);
    const current = latestSnapshot.current;
    if (current) void savePreferences({ ...current.preferences, mode: "pure" });
  };

  useEffect(() => {
    latestSnapshot.current = snapshot;
  }, [snapshot]);

  if (!snapshot || !preferences) {
    return <main className="pure-agent-loading">{loading ? "正在加载 Agent Workspace…" : "Agent Workspace 无法加载。"}</main>;
  }

  const gridColumns = preferences.rightPanelVisible
    ? `${preferences.leftWidth}px 6px minmax(360px, 2fr) 6px ${preferences.rightWidth}px`
    : `${preferences.leftWidth}px 6px minmax(0, 1fr)`;

  return <main className={"pure-agent-shell" + (splitDrag ? " is-resizing" : "")} style={{ gridTemplateColumns: gridColumns }}>
    <PureAgentSidebar
      snapshot={snapshot}
      section={section}
      onSectionChange={setSection}
      onNewTask={() => void createTask()}
      onActivateTask={taskId => void activateTask(taskId)}
      onAddWorkspace={() => void addWorkspace()}
      onActivateWorkspace={workspacePath => void createTask(workspacePath)}
      onOpenSettings={() => void window.browser.openAgentSettings().catch(error => message.error(error instanceof Error ? error.message : String(error)))}
      onSwitchToSidepanel={() => void switchToSidepanel()}
    />
    <div className="pure-left-splitter" role="separator" aria-orientation="vertical"
      onPointerDown={event => onSplitterPointerDown("left", event)} onPointerMove={onSplitterPointerMove}
      onPointerUp={onSplitterPointerUp} onPointerCancel={onSplitterPointerUp} />
    <section className="pure-agent-center">
      {section === "chat" && <>
        <header className="pure-chat-context">
          <div className="pure-chat-context-title">
            <strong>{activeTask?.title ?? "New task"}</strong>
            <span>{activeTask?.workspacePath ?? "个人工作区"}{activeExpert ? " · " + activeExpert.name : ""}</span>
          </div>
          <div className="pure-chat-context-actions">
            <Select size="small" value={activeTask?.expertId ?? ""} style={{ width: 160 }}
              onChange={value => void updateTaskExpert(value || null)}
              options={[{ label: "默认 Agent", value: "" }, ...snapshot.experts.map(expert => ({ label: expert.name, value: expert.id }))]} />
            <Button type="text" size="small" icon={preferences.rightPanelVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={toggleRightPane}>{preferences.rightPanelVisible ? "隐藏右侧" : "显示右侧"}</Button>
          </div>
        </header>
        <AgentPanel
          taskId={activeTask?.id}
          mode="pure"
          onClose={() => void switchToSidepanel()}
          onDock={() => void switchToSidepanel()}
          onModeChange={() => void switchToSidepanel()}
          onToggleRightPane={toggleRightPane}
          rightPaneVisible={preferences.rightPanelVisible}
        />
      </>}
      {section === "schedule" && <ScheduleManager snapshot={snapshot} onChanged={() => void refresh()} />}
      {section === "expert" && <ExpertManager onChanged={() => void refresh()} />}
    </section>
    {preferences.rightPanelVisible && <>
      <div className="pure-right-splitter" role="separator" aria-orientation="vertical"
        onPointerDown={event => onSplitterPointerDown("right", event)} onPointerMove={onSplitterPointerMove}
        onPointerUp={onSplitterPointerUp} onPointerCancel={onSplitterPointerUp} />
      <PureAgentRightPanel snapshot={snapshot} browserState={browserState} activeTab={preferences.rightPanelTab}
        onTabChange={setRightTab} paneRef={paneRef} chromeRef={chromeRef} />
    </>}
  </main>;
}
