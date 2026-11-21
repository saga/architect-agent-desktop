import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button, Empty, Input, Tabs, Tooltip, message } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, FileOutlined, FolderOpenOutlined, GlobalOutlined, ReloadOutlined } from "@ant-design/icons";
import XMarkdown from "@ant-design/x-markdown";
import { markdownComponents } from "./MarkdownLink";
import AgentA2UICard from "./components/AgentA2UICard";
import type { AgentSessionItem, AgentWorkspaceRightTab, AgentWorkspaceSnapshot, BrowserState } from "../shared/types";

interface PureAgentRightPanelProps {
  snapshot: AgentWorkspaceSnapshot;
  browserState: BrowserState;
  activeTab: AgentWorkspaceRightTab;
  onTabChange: (tab: AgentWorkspaceRightTab) => void;
  paneRef: RefObject<HTMLDivElement | null>;
  chromeRef: RefObject<HTMLDivElement | null>;
}

function tabTitle(tab: BrowserState["tabs"][number]): string {
  if (tab.title?.trim()) return tab.title.trim();
  try { return new URL(tab.url).hostname || tab.url; } catch { return tab.url || "New tab"; }
}

export default function PureAgentRightPanel({ snapshot, browserState, activeTab, onTabChange, paneRef, chromeRef }: PureAgentRightPanelProps) {
  const task = snapshot.tasks.find(item => item.id === snapshot.activeTaskId);
  const [address, setAddress] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [messages, setMessages] = useState<AgentSessionItem[]>([]);
  const fileRequestId = useRef(0);
  const currentTab = browserState.tabs.find(tab => tab.id === browserState.activeTabId);

  useEffect(() => { setAddress(currentTab?.url ?? ""); }, [currentTab?.id, currentTab?.url]);

  useEffect(() => {
    const pane = paneRef.current;
    const chrome = chromeRef.current;
    if (!pane || !chrome || activeTab !== "browser") {
      window.browser.setContentBounds({ top: 0, left: 0, width: 0 });
      return;
    }
    const update = () => {
      const paneBounds = pane.getBoundingClientRect();
      const chromeBounds = chrome.getBoundingClientRect();
      window.browser.setContentBounds({
        top: Math.max(0, Math.floor(chromeBounds.bottom)),
        left: Math.max(0, Math.floor(paneBounds.left)),
        width: Math.max(0, Math.floor(paneBounds.width)),
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    observer.observe(chrome);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.browser.setContentBounds({ top: 0, left: 0, width: 0 });
    };
  }, [activeTab, paneRef, chromeRef]);

  useEffect(() => {
    let active = true;
    setFiles([]);
    setSelectedFile("");
    setFileContent("");
    if (!task?.workspacePath) return () => { active = false; };
    setFileLoading(true);
    void window.browser.agentWorkspaceListFiles(task.workspacePath)
      .then(result => { if (active) setFiles(result); })
      .catch(error => { if (active) message.error(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setFileLoading(false); });
    return () => { active = false; fileRequestId.current += 1; };
  }, [task?.workspacePath, activeTab]);

  useEffect(() => {
    let active = true;
    setMessages([]);
    if (!task) return () => { active = false; };
    void window.browser.agentLoadSession(task.id)
      .then(items => { if (active) setMessages(items); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [task?.id, snapshot.tasks.find(item => item.id === task?.id)?.updatedAt]);

  const openFile = async (file: string) => {
    if (!task?.workspacePath) return;
    const requestId = ++fileRequestId.current;
    const workspacePath = task.workspacePath;
    setSelectedFile(file);
    setContentLoading(true);
    try {
      const content = await window.browser.agentWorkspaceReadFile(workspacePath, file);
      if (requestId === fileRequestId.current) setFileContent(content);
    } catch (error) {
      if (requestId === fileRequestId.current) setFileContent(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === fileRequestId.current) setContentLoading(false);
    }
  };

  const navigate = () => {
    if (!currentTab || !address.trim()) return;
    void window.browser.navigate(currentTab.id, address.trim());
  };

  const resultMessages = useMemo(() => messages.filter(item => item.kind === "assistant" || item.kind === "error" || item.kind === "a2ui").slice(-12), [messages]);

  return <aside className="pure-right-panel">
    <header className="pure-right-header">
      <Tabs activeKey={activeTab} onChange={key => onTabChange(key as AgentWorkspaceRightTab)} items={[
        { key: "browser", label: <span><GlobalOutlined /> Browser</span> },
        { key: "files", label: <span><FolderOpenOutlined /> Files</span> },
        { key: "results", label: <span><FileOutlined /> Results</span> },
      ]} />
    </header>

    {activeTab === "browser" && <div className="pure-right-browser" ref={paneRef}>
      <div className="pure-right-browser-chrome" ref={chromeRef}>
        <div className="pure-right-tab-strip">
          <div className="pure-right-tabs">
            {browserState.tabs.map(tab => <button type="button" key={tab.id}
              className={"pure-right-tab" + (tab.id === browserState.activeTabId ? " active" : "")}
              onClick={() => void window.browser.activateTab(tab.id)} title={tabTitle(tab)}>
              <span>{tab.favicon ? <img src={tab.favicon} alt="" /> : <GlobalOutlined />}</span>
              <span>{tabTitle(tab)}</span>
              <span className="pure-right-tab-close" onClick={event => { event.stopPropagation(); void window.browser.closeTab(tab.id); }}>×</span>
            </button>)}
          </div>
          <Tooltip title="New tab"><Button type="text" size="small" onClick={() => void window.browser.createTab()}>+</Button></Tooltip>
        </div>
        <div className="pure-right-browser-toolbar">
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} disabled={!currentTab?.canGoBack} onClick={() => currentTab && void window.browser.goBack(currentTab.id)} />
          <Button type="text" size="small" icon={<ArrowRightOutlined />} disabled={!currentTab?.canGoForward} onClick={() => currentTab && void window.browser.goForward(currentTab.id)} />
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => currentTab && void window.browser.reload(currentTab.id)} />
          <form onSubmit={event => { event.preventDefault(); navigate(); }}>
            <Input size="small" value={address} onChange={event => setAddress(event.target.value)} placeholder="Search or enter a web address" />
          </form>
        </div>
      </div>
      <div className="pure-right-browser-placeholder">网页视图由内置浏览器渲染</div>
    </div>}

    {activeTab === "files" && <div className="pure-file-browser">
      {!task?.workspacePath ? <Empty description="当前 Task 未关联 Workspace" /> : <>
        <div className="pure-file-browser-heading"><strong>{task.workspacePath}</strong><span>{files.length} 个文件</span></div>
        <div className="pure-file-browser-content">
          <nav className="pure-file-list">
            {fileLoading && <span className="pure-muted">正在读取文件列表…</span>}
            {files.map(file => <button type="button" key={file} className={selectedFile === file ? "active" : ""} onClick={() => void openFile(file)}>
              <FileOutlined /><span>{file}</span>
            </button>)}
            {!fileLoading && !files.length && <span className="pure-muted">没有可显示的文本文件。</span>}
          </nav>
          <section className="pure-file-preview">
            {selectedFile ? <><header>{selectedFile}</header>{contentLoading ? <div className="pure-muted">读取中…</div> : <pre>{fileContent}</pre>}</> : <Empty description="选择一个文件查看内容" />}
          </section>
        </div>
      </>}
    </div>}

    {activeTab === "results" && <div className="pure-results-list">
      {resultMessages.length ? resultMessages.map(item => <article className={"pure-result-item " + item.kind} key={item.id}>
        <div className="pure-result-meta">{item.kind === "error" ? "错误" : "Agent 结果"} · {new Date(item.createdAt).toLocaleString()}</div>
        {item.kind === "assistant" ? <XMarkdown content={item.content} components={markdownComponents} escapeRawHtml /> : item.kind === "a2ui" ? <AgentA2UICard content={item.content} /> : <pre>{item.content}</pre>}
      </article>) : <Empty description="完成任务后，Agent 的结果会显示在这里" />}
    </div>}
  </aside>;
}
