import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AgentWorkspacePreferences, BrowserDownloadEvent, BrowserState, BrowserTabState, WorkspaceDocument } from "../shared/types";
import { activateWorkspaceTab, createWorkspaceTabGroup, DEFAULT_WORKSPACE_DOCUMENT, setWorkspacePanelVisibility, ungroupWorkspacePanel } from "../shared/workspace-document";
import AgentPanel from "./AgentPanel";
import PureAgentWorkspace from "./PureAgentWorkspace";
import { Button } from "antd";
import { RobotOutlined } from "@ant-design/icons";

const EMPTY_STATE: BrowserState = { tabs: [], activeTabId: null };
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

function displayTitle(tab: BrowserTabState): string {
  if (tab.title && tab.title.trim()) return tab.title.trim();
  if (tab.url === "about:blank") return "New tab";
  try {
    return new URL(tab.url).hostname || tab.url;
  } catch {
    return tab.url || "New tab";
  }
}

function App() {
  const isFloatingAgentWindow = new URLSearchParams(window.location.search).get("agent-panel") === "1";
  const [browserState, setBrowserState] = useState<BrowserState>(EMPTY_STATE);
  const [address, setAddress] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [findText, setFindText] = useState("");
  const [latestDownload, setLatestDownload] = useState<BrowserDownloadEvent | null>(null);
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentWidth, setAgentWidth] = useState(390);
  const [agentPosition, setAgentPosition] = useState<"left" | "right" | "top" | "bottom">("right");
  const [workspaceDocument, setWorkspaceDocument] = useState<WorkspaceDocument>(DEFAULT_WORKSPACE_DOCUMENT);
  const [agentWorkspacePreferences, setAgentWorkspacePreferences] = useState<AgentWorkspacePreferences | null>(null);
  const [chromeHeight, setChromeHeight] = useState(91);
  const [dockDragActive, setDockDragActive] = useState(false);
  const splitterDrag = useRef<{ startCoordinate: number; startWidth: number; width: number } | null>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const browserWorkspaceRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const workspaceGroup = useMemo(() => workspaceDocument.tabGroups.find((group) => group.panelIds.includes("browser") && group.panelIds.includes("agent")) ?? null, [workspaceDocument]);
  const groupedWorkspace = Boolean(workspaceGroup);
  const activeWorkspacePanel = workspaceDocument.activePanelId;

  const activeTab = useMemo(
    () => browserState.tabs.find((tab) => tab.id === browserState.activeTabId) ?? null,
    [browserState],
  );

  useEffect(() => {
    void window.browser.getWorkspaceDocument().then(setWorkspaceDocument).catch((error: unknown) => console.error("Unable to load workspace document", error));
    void window.browser.getWorkspaceLayout().then((layout) => {
      setAgentWidth(layout.agentPanelWidth);
      setAgentOpen(layout.agentPanelVisible);
      setAgentPosition(layout.agentPanelPosition ?? "right");
    }).catch((error: unknown) => console.error("Unable to load workspace layout", error));
    const unsubscribeState = window.browser.onState(setBrowserState);
    const unsubscribeLayout = window.browser.onWorkspaceLayoutUpdated((layout) => {
      void window.browser.getWorkspaceDocument().then(setWorkspaceDocument).catch((error: unknown) => console.error("Unable to refresh workspace document", error));
      setAgentOpen(layout.agentPanelVisible);
      setAgentWidth(layout.agentPanelWidth);
      setAgentPosition(layout.agentPanelPosition);
    });
    const unsubscribeFocus = window.browser.onFocusAddress(() => {
      addressRef.current?.focus();
      addressRef.current?.select();
    });
    const unsubscribeFind = window.browser.onFindRequested(() => {
      setShowFind(true);
      window.setTimeout(() => findRef.current?.focus(), 0);
    });
    const unsubscribeDownload = window.browser.onDownload(setLatestDownload);
    const unsubscribeAgentWorkspace = window.browser.onAgentWorkspaceUpdated((snapshot) => setAgentWorkspacePreferences(snapshot.preferences));
    void window.browser.getAgentWorkspaceSnapshot().then((snapshot) => setAgentWorkspacePreferences(snapshot.preferences)).catch((error: unknown) => console.error("Unable to load Agent workspace preferences", error));
    const unsubscribeAgentToggle = window.browser.onToggleAgent(() => {
      void window.browser.getWorkspaceDocument().then(async (document) => {
        const group = document.tabGroups.find((item) => item.panelIds.includes("browser") && item.panelIds.includes("agent"));
        if (group) {
          const target = document.activePanelId === "agent" ? "browser" : "agent";
          const next = activateWorkspaceTab(document, group.id, target);
          const visible = setWorkspacePanelVisibility(setWorkspacePanelVisibility(next, "browser", target === "browser"), "agent", target === "agent");
          const saved = await window.browser.saveWorkspaceDocument(visible);
          setWorkspaceDocument(saved);
          return;
        }
        const layout = await window.browser.getWorkspaceLayout();
        if (!layout.agentPanelVisible) { void window.browser.redockAgentPanel(); return; }
        setAgentOpen(false);
        await window.browser.saveWorkspaceLayout({ ...layout, agentPanelVisible: false });
      }).catch((error: unknown) => console.error("Unable to toggle Agent panel", error));
    });

    void window.browser.getState().then(setBrowserState).catch((error: unknown) => {
      console.error("Unable to load browser state", error);
    });

    return () => {
      unsubscribeState();
      unsubscribeLayout();
      unsubscribeFocus();
      unsubscribeFind();
      unsubscribeDownload();
      unsubscribeAgentWorkspace();
      unsubscribeAgentToggle();
    };
  }, []);

  useEffect(() => {
    setAddress(activeTab?.url ?? "");
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    const chrome = chromeRef.current;
    const workspace = appShellRef.current;
    if (!chrome || !workspace) return;

    const updateBounds = () => {
      const workspaceBounds = workspace.getBoundingClientRect();
      const nextChromeHeight = Math.ceil(chrome.getBoundingClientRect().height);
      setChromeHeight(nextChromeHeight);
      window.browser.setContentBounds({
        top: nextChromeHeight,
        left: Math.max(0, Math.floor(workspaceBounds.left)),
        width: Math.max(0, Math.floor(workspaceBounds.width)),
      });
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(chrome);
    observer.observe(workspace);
    updateBounds();

    return () => observer.disconnect();
  }, [agentOpen, agentPosition, groupedWorkspace, activeWorkspacePanel, agentWorkspacePreferences?.mode]);

  useEffect(() => {
    if (showFind) {
      findRef.current?.focus();
      findRef.current?.select();
    }
  }, [showFind]);

  const createTab = useCallback(() => {
    void window.browser.createTab();
  }, []);

  const navigate = useCallback(() => {
    if (!activeTab || !address.trim()) return;
    void window.browser.navigate(activeTab.id, address.trim());
    addressRef.current?.blur();
  }, [activeTab, address]);

  const closeFind = useCallback(() => {
    if (activeTab) void window.browser.stopFindInPage(activeTab.id);
    setShowFind(false);
    setFindText("");
  }, [activeTab]);

  const runFind = useCallback((value: string) => {
    setFindText(value);
    if (activeTab && value.trim()) {
      void window.browser.findInPage(activeTab.id, value);
    }
  }, [activeTab]);

  const isSecure = activeTab?.url.startsWith("https://") ?? false;

  const switchToPureAgent = async () => {
    try {
      const current = agentWorkspacePreferences ?? (await window.browser.getAgentWorkspaceSnapshot()).preferences;
      await window.browser.saveAgentWorkspacePreferences({ ...current, mode: "pure" });
    } catch (error) {
      console.error("Unable to switch to Pure Agent mode", error);
    }
  };

  const persistWorkspaceDocument = async (next: WorkspaceDocument) => {
    try {
      const saved = await window.browser.saveWorkspaceDocument(next);
      setWorkspaceDocument(saved);
    } catch (error) { console.error("Unable to save workspace document", error); }
  };
  const groupAgentWithBrowser = (activePanel: "browser" | "agent" = "browser") => {
    const grouped = createWorkspaceTabGroup(workspaceDocument, "browser-agent-tabs", ["browser", "agent"], activePanel);
    const visibleDocument = setWorkspacePanelVisibility(setWorkspacePanelVisibility(grouped, "browser", activePanel === "browser"), "agent", activePanel === "agent");
    void persistWorkspaceDocument(visibleDocument);
  };
  const activateWorkspacePanel = (panelId: "browser" | "agent") => {
    if (!workspaceGroup) return;
    const next = activateWorkspaceTab(workspaceDocument, workspaceGroup.id, panelId);
    const visibleDocument = setWorkspacePanelVisibility(setWorkspacePanelVisibility(next, "browser", panelId === "browser"), "agent", panelId === "agent");
    void persistWorkspaceDocument(visibleDocument);
  };
  const splitAgentFromBrowser = () => {
    if (!workspaceGroup) return;
    const next = ungroupWorkspacePanel(workspaceDocument, workspaceGroup.id, "agent");
    const visibleDocument = setWorkspacePanelVisibility(setWorkspacePanelVisibility(next, "browser", true), "agent", true);
    void persistWorkspaceDocument(visibleDocument);
  };

  const saveWorkspaceLayout = (visible = agentOpen, width = agentWidth, position = agentPosition) => {
    void window.browser.saveWorkspaceLayout({ version: 1, agentPanelWidth: width, agentPanelVisible: visible, agentPanelPosition: position }).catch((error: unknown) => console.error("Unable to save workspace layout", error));
  };
  const onSplitterPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const coordinate = agentPosition === "left" || agentPosition === "right" ? event.clientX : event.clientY;
    splitterDrag.current = { startCoordinate: coordinate, startWidth: agentWidth, width: agentWidth };
  };
  const onSplitterPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitterDrag.current;
    if (!drag) return;
    const coordinate = agentPosition === "left" || agentPosition === "right" ? event.clientX : event.clientY;
    const delta = agentPosition === "left" || agentPosition === "top" ? coordinate - drag.startCoordinate : drag.startCoordinate - coordinate;
    const next = Math.max(280, Math.min(720, drag.startWidth + delta));
    if (next !== drag.width) { drag.width = next; setAgentWidth(next); }
  };
  const onSplitterPointerUp = () => {
    const drag = splitterDrag.current;
    if (!drag) return;
    splitterDrag.current = null;
    saveWorkspaceLayout(agentOpen, drag.width);
  };

  const horizontalDock = agentPosition === "left" || agentPosition === "right";
  const agentFirst = agentPosition === "left" || agentPosition === "top";
  const shellStyle = groupedWorkspace ? { gridTemplateColumns: "minmax(0, 1fr)" } : agentOpen ? horizontalDock
    ? { gridTemplateColumns: agentFirst ? `${agentWidth}px 6px minmax(0, 1fr)` : `minmax(0, 1fr) 6px ${agentWidth}px`, gridTemplateRows: "minmax(0, 1fr)" }
    : { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: agentFirst ? `${agentWidth}px 6px minmax(0, 1fr)` : `minmax(0, 1fr) 6px ${agentWidth}px` }
    : { gridTemplateColumns: "minmax(0, 1fr)" };
  const browserPlacement = groupedWorkspace ? { gridColumn: 1, gridRow: 1 } : agentOpen && !horizontalDock ? { gridRow: agentFirst ? 3 : 1, gridColumn: 1 } : agentOpen && agentFirst ? { gridColumn: 3, gridRow: 1 } : { gridColumn: 1, gridRow: 1 };
  const splitterPlacement = agentOpen && !groupedWorkspace && !horizontalDock ? { gridRow: 2, gridColumn: 1 } : agentOpen && !groupedWorkspace ? { gridColumn: 2, gridRow: 1 } : { gridColumn: 2, gridRow: 1 };
  const agentPlacement = agentOpen && !groupedWorkspace && !horizontalDock ? { gridRow: agentFirst ? 1 : 3, gridColumn: 1 } : agentOpen && !groupedWorkspace && agentFirst ? { gridColumn: 1, gridRow: 1 } : { gridColumn: 3, gridRow: 1 };
  if (isFloatingAgentWindow) {
    return <div className="agent-floating-root"><AgentPanel onClose={() => { void window.browser.redockAgentPanel(); }} onDock={(position) => { void window.browser.redockAgentPanel(position); }} /></div>;
  }
  if (agentWorkspacePreferences?.mode === "pure") {
    return <PureAgentWorkspace browserState={browserState} />;
  }

  return (
    <div ref={appShellRef} className={"app-shell" + (IS_MAC ? " is-mac" : "") + (agentOpen && !groupedWorkspace ? " agent-open" : "") + (groupedWorkspace ? " agent-grouped" : "")} data-agent-position={agentPosition} style={shellStyle}>
      <div className="browser-workspace" ref={browserWorkspaceRef} style={browserPlacement}>
      <div className={"browser-chrome" + (IS_MAC ? " is-mac" : "")} ref={chromeRef}>
        <div className="tab-strip">
          <div className="tabs">
            {browserState.tabs.map((tab) => (
              <div
                className={"tab" + (tab.id === browserState.activeTabId ? " active" : "")}
                key={tab.id}
                onMouseDown={() => void window.browser.activateTab(tab.id)}
                title={displayTitle(tab)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void window.browser.activateTab(tab.id);
                  }
                }}
              >
                <span className="tab-favicon">
                  {tab.favicon ? <img src={tab.favicon} alt="" /> : <span className="globe-mark">◎</span>}
                </span>
                <span className="tab-title">{displayTitle(tab)}</span>
                {tab.isLoading && <span className="tab-loading" aria-label="Loading" />}
                <button
                  className="tab-close"
                  type="button"
                  aria-label={"Close " + displayTitle(tab)}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void window.browser.closeTab(tab.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="new-tab-button" type="button" aria-label="New tab" title="New tab" onClick={createTab}>
            +
          </button>
          {!agentOpen && !groupedWorkspace && <button className="agent-launch-button" type="button"
            aria-label="打开 Agent 面板" title="打开 Agent 面板"
            onClick={() => { void window.browser.redockAgentPanel(); }}>
            <RobotOutlined />
          </button>}
        </div>

        <div className="toolbar">
          <div className="navigation-controls">
            <button className="toolbar-button" type="button" aria-label="Go back" title="Back"
              disabled={!activeTab?.canGoBack}
              onClick={() => activeTab && void window.browser.goBack(activeTab.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg>
            </button>
            <button className="toolbar-button" type="button" aria-label="Go forward" title="Forward"
              disabled={!activeTab?.canGoForward}
              onClick={() => activeTab && void window.browser.goForward(activeTab.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
            <button className="toolbar-button" type="button"
              aria-label={activeTab?.isLoading ? "Stop loading" : "Reload"}
              title={activeTab?.isLoading ? "Stop" : "Reload"}
              onClick={() => {
                if (!activeTab) return;
                if (activeTab.isLoading) void window.browser.stop(activeTab.id);
                else void window.browser.reload(activeTab.id);
              }}>
              {activeTab?.isLoading
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 1 4M20 4v7h-7" /></svg>}
            </button>
            <button className="toolbar-button home-button" type="button" aria-label="Home" title="Open home page"
              onClick={() => activeTab && void window.browser.navigate(activeTab.id, "https://www.google.com/")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10h-6v-6H9v6H3z" /></svg>
            </button>
          </div>

          <form className="address-form" onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}>
            <span className={"address-security" + (isSecure ? " secure" : "")} aria-hidden="true">
              {isSecure ? "⌑" : "○"}
            </span>
            <input
              ref={addressRef}
              className="address-input"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="Search or enter a web address"
              aria-label="Search or enter a web address"
              spellCheck={false}
            />
            {address && (
              <button className="address-clear" type="button" aria-label="Clear address" onClick={() => {
                setAddress("");
                addressRef.current?.focus();
              }}>×</button>
            )}
          </form>

          <div className="toolbar-actions">
            {groupedWorkspace && <div className="workspace-tab-group">
              <Button size="small" type={activeWorkspacePanel === "browser" ? "primary" : "text"} onClick={() => activateWorkspacePanel("browser")}>Browser</Button>
              <Button size="small" type={activeWorkspacePanel === "agent" ? "primary" : "text"} onClick={() => activateWorkspacePanel("agent")}>Agent</Button>
              <Button size="small" type="text" onClick={splitAgentFromBrowser}>Split</Button>
            </div>}
            <button className="toolbar-button download-button" type="button"
              aria-label="Dismiss recent download status"
              title={latestDownload ? latestDownload.fileName : "Downloads"}
              onClick={() => setLatestDownload(null)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 19h16" /></svg>
              {latestDownload && <span className="download-dot" />}
            </button>
            <div className="profile-mark" title="Browser profile">A</div>
          </div>
        </div>
        {dockDragActive && <div className="workspace-dock-targets" onDragOver={(event) => event.preventDefault()}>
          {(["left", "right", "top", "bottom"] as const).map((position) => <button key={position} className={"dock-" + position} type="button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.getData("text/plain") !== "agent-panel") return; setDockDragActive(false); setAgentPosition(position); if (groupedWorkspace) splitAgentFromBrowser(); saveWorkspaceLayout(true, agentWidth, position); }}>{position}</button>)}
        </div>}

        {showFind && (
          <div className="find-bar">
            <input
              ref={findRef}
              value={findText}
              onChange={(event) => runFind(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeFind();
                if (event.key === "Enter" && activeTab && findText.trim()) {
                  void window.browser.findInPage(activeTab.id, findText);
                }
              }}
              placeholder="Find in page"
              aria-label="Find in page"
            />
            <button type="button" onClick={() => activeTab && void window.browser.findInPage(activeTab.id, findText)}>Find next</button>
            <button type="button" className="find-close" aria-label="Close find" onClick={closeFind}>×</button>
          </div>
        )}

        {latestDownload && (
          <div className="download-status" role="status">
            <span className="download-status-name">{latestDownload.fileName}</span>
            <span>
              {latestDownload.status === "completed"
                ? "Download complete"
                : latestDownload.status === "cancelled"
                  ? "Download cancelled"
                  : latestDownload.totalBytes > 0
                    ? Math.round((latestDownload.receivedBytes / latestDownload.totalBytes) * 100) + "%"
                    : "Downloading"}
            </span>
            <button type="button" aria-label="Dismiss download status" onClick={() => setLatestDownload(null)}>×</button>
          </div>
        )}
      </div>
      </div>
      {agentOpen && !groupedWorkspace && <div className={"workspace-splitter" + (horizontalDock ? " vertical" : " horizontal")} style={splitterPlacement} role="separator" aria-orientation={horizontalDock ? "vertical" : "horizontal"} aria-label="Resize Agent panel" tabIndex={0}
        onPointerDown={onSplitterPointerDown} onPointerMove={onSplitterPointerMove} onPointerUp={onSplitterPointerUp} onPointerCancel={onSplitterPointerUp}
        onKeyDown={(event) => { const keys = horizontalDock ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]; if (keys.includes(event.key)) { event.preventDefault(); const increase = agentPosition === "left" || agentPosition === "top" ? (event.key === "ArrowRight" || event.key === "ArrowDown") : (event.key === "ArrowLeft" || event.key === "ArrowUp"); const next = Math.max(280, Math.min(720, agentWidth + (increase ? 16 : -16))); setAgentWidth(next); saveWorkspaceLayout(true, next); } }} />}
      {agentOpen && !groupedWorkspace && <div className="agent-panel-slot" style={agentPlacement}><AgentPanel
        onClose={() => { setAgentOpen(false); saveWorkspaceLayout(false); }}
        onFloat={() => { void window.browser.floatAgentPanel(); }}
        onDragState={setDockDragActive}
        onModeChange={() => void switchToPureAgent()}
        onMaximize={() => groupAgentWithBrowser("agent")}
        onDock={(position) => { setAgentPosition(position); saveWorkspaceLayout(agentOpen, agentWidth, position); }}
      /></div>}
      {groupedWorkspace && activeWorkspacePanel === "agent" && <div className="agent-group-content" style={{ top: chromeHeight }}><AgentPanel onClose={() => activateWorkspacePanel("browser")} onFloat={() => { void window.browser.floatAgentPanel(); }} onDragState={setDockDragActive} onModeChange={() => void switchToPureAgent()} onRestore={splitAgentFromBrowser} onDock={(position) => { splitAgentFromBrowser(); setAgentPosition(position); saveWorkspaceLayout(true, agentWidth, position); }} /></div>}
    </div>
  );
}

export default App;