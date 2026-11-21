import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  desktopCapturer,
  ipcMain,
  Menu,
  Notification,
  type MenuItemConstructorOptions,
  screen,
  session,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AGENT_TOOL_IDS, CopilotDesktopAgent } from "./copilot";
import { AgentTraceStore } from "./agent-trace-store";
import { BrowserCdp, withCdpDeadline } from "./browser-cdp";
import path from "node:path";
import { isTrustedAppUrl } from "./app-url-policy";
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import type { AgentChatMessage, AgentProvider, AgentSessionItem, AgentSettings, AgentTask, AgentExpert, AgentSchedule, AgentScheduleRun, AgentWorkspaceSnapshot, AgentToolPermission, BrowserDownloadEvent, BrowserState, BrowserTabState } from "../shared/types";
import { parseAgentSessionItems } from "./agent-session";
import { installCrashHandlers, recordCrash, recordOperation } from "./diagnostics";
import { writeJsonAtomic } from "./json-store";
import { exportPlugin, importPlugin, listPlugins, readEnabledPluginInstructions, removePlugin, setPluginEnabled } from "./plugins/plugin-registry";
import { importAgentSkill, importAgentSkillArchive, listAgentSkills, listMcpServers, readEnabledAgentSkillInstructions, removeAgentSkill, removeMcpServer, saveMcpServer, setAgentSkillEnabled, setMcpServerEnabled } from "./agent-extensions";
import { disposeLoginShellEnvironment, primeLoginShellEnvironment } from "./login-shell-env";
import { calculateLayout } from "./layout/layout-engine";
import { NativeViewStackManager } from "./layout/native-view-stack";
import { findPanel, setPanelVisibility } from "./layout/layout-tree";
import { DEFAULT_WORKSPACE_LAYOUT, parseWorkspaceLayout } from "../shared/workspace-layout";
import type { WorkspaceDocument, WorkspaceLayoutState, WorkspaceProject, McpServerConfig } from "../shared/types";
import { parseWorkspaceDocument, createFloatingPanel, redockFloatingPanel } from "../shared/workspace-document";
import { parseAgentTasks, parseAgentExperts, parseAgentSchedules, parseAgentScheduleRuns, parseAgentWorkspacePreferences, nextScheduleRunAt } from "./agent-workspace-store";
import { listWorkspaceFiles, readWorkspaceFile } from "./workspace-files";

const APP_ID = "com.saga.architectagentdesktop";
const HOME_URL = "https://www.google.com/";
const BROWSER_PARTITION = "persist:architect-agent-browser";
const DEFAULT_CONTENT_TOP = 91;

const ASKABLE_PERMISSIONS = new Set(["media", "display-capture", "geolocation", "notifications", "clipboard-read"]);

interface BrowserTab {
  id: string;
  view: WebContentsView;
  cdp: BrowserCdp;
  title: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
}

const tabs = new Map<string, BrowserTab>();
const tabOrder: string[] = [];
const permissionGrants = new Map<string, Set<string>>();

let mainWindow: BrowserWindow | null = null;
const nativeViewStack = new NativeViewStackManager(() => mainWindow);
let agentSettingsWindow: BrowserWindow | null = null;
let sessionExplorerWindow: BrowserWindow | null = null;
let agentPanelWindow: BrowserWindow | null = null;
let closingAgentPanelForRedock = false;
let isQuitting = false;
let browserSession: Session;
let activeTabId: string | null = null;
let attachedView: WebContentsView | null = null;
let snapshotView: WebContentsView | null = null;
let snapshotActive = false;
let snapshotCapturing = false;
let currentBrowserBounds: { x: number; y: number; width: number; height: number } | null = null;
let contentTop = DEFAULT_CONTENT_TOP;
let contentLeft = 0;
let contentWidth: number | null = null;
const SETTINGS_PATH = path.join(app.getPath("userData"), "agent-settings.json");
const AGENT_SESSION_ROOT = path.join(app.getPath("userData"), "agent-sessions");
const AGENT_TASKS_PATH = path.join(app.getPath("userData"), "agent-tasks.json");
const AGENT_EXPERTS_PATH = path.join(app.getPath("userData"), "agent-experts.json");
const AGENT_SCHEDULES_PATH = path.join(app.getPath("userData"), "agent-schedules.json");
const AGENT_SCHEDULE_RUNS_PATH = path.join(app.getPath("userData"), "agent-schedule-runs.json");
const AGENT_WORKSPACE_PREFERENCES_PATH = path.join(app.getPath("userData"), "agent-workspace-preferences.json");
const ACTIVE_AGENT_TASK_PATH = path.join(app.getPath("userData"), "active-agent-task.json");
const LEGACY_AGENT_SESSION_ITEMS = 200;
const AGENT_DATA_SETTINGS_PATH = path.join(app.getPath("userData"), "agent-data.json");
function loadAgentDataDirectory(): string {
  try {
    const raw = JSON.parse(readFileSync(AGENT_DATA_SETTINGS_PATH, "utf8")) as { directory?: unknown };
    if (typeof raw.directory === "string" && raw.directory.trim()) return path.resolve(raw.directory);
  } catch { /* use the application default */ }
  return path.join(app.getPath("userData"), "agent-data");
}
function createAgentTraceStore(): AgentTraceStore {
  const configured = loadAgentDataDirectory();
  try { return new AgentTraceStore(configured); }
  catch (primaryError) {
    const fallback = path.join(app.getPath("userData"), "agent-data");
    console.error("[agent-trace] configured data directory is unavailable", primaryError);
    if (path.resolve(configured) !== path.resolve(fallback)) {
      try { return new AgentTraceStore(fallback); }
      catch (fallbackError) { console.error("[agent-trace] default data directory is unavailable", fallbackError); }
    }
    return new AgentTraceStore(":memory:");
  }
}
const agentTraceStore = createAgentTraceStore();
let activeAgentTraceId: string | null = null;
let activeAgentTaskId = "";
const approvedAgentFiles = new Map<string, Set<string>>();
let agentRequestPending = false;
let taskActivationPending = false;
let scheduledCapture: { taskId: string; answer: string; error?: string } | null = null;
function currentTraceSessionId(): string {
  const task = agentTasks.find(item => item.id === activeAgentTaskId);
  return task?.sessionId ?? createHash("sha256").update(workspaceProject.path ?? "__default_workspace__").digest("hex").slice(0, 32);
}
function recordAgentTrace(type: string, data: unknown, status?: string, payloadComplete = true): void {
  const sessionId = currentTraceSessionId();
  try {
    agentTraceStore.record({
      sessionId,
      traceId: activeAgentTraceId ?? randomUUID(),
      workspacePath: workspaceProject.path,
      provider: agentSettings.provider,
      model: agentSettings.provider === "copilot" ? agentSettings.copilotModel : agentSettings.codebuddyModel,
      type,
      status,
      data,
      payloadComplete,
    });
  } catch (error) {
    recordOperation("agent-trace", "trace write failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

function recordTaskTrace(task: AgentTask, type: string, data: unknown): void {
  try {
    agentTraceStore.record({
      sessionId: task.sessionId,
      traceId: randomUUID(),
      workspacePath: task.workspacePath,
      provider: agentSettings.provider,
      model: agentSettings.provider === "copilot" ? agentSettings.copilotModel : agentSettings.codebuddyModel,
      type,
      status: "completed",
      data,
    });
  } catch (error) {
    recordOperation("agent-trace", "task trace write failed: " + (error instanceof Error ? error.message : String(error)));
  }
}
const LEGACY_AGENT_SESSION_PATH = path.join(app.getPath("userData"), "agent-session.json");
const WORKSPACE_PROJECT_PATH = path.join(app.getPath("userData"), "workspace-project.json");
const WORKSPACE_LAYOUT_PATH = path.join(app.getPath("userData"), "workspace-layout.json");
const WORKSPACE_DOCUMENT_PATH = path.join(app.getPath("userData"), "workspace-document.json");
const WINDOW_STATE_PATH = path.join(app.getPath("userData"), "window-state.json");
const PLUGIN_ROOT = path.join(app.getPath("userData"), "plugins");
const PLUGIN_REGISTRY_PATH = path.join(app.getPath("userData"), "plugins.json");
const MCP_CONFIG_PATH = path.join(app.getPath("userData"), "mcp-servers.json");
const AGENT_SKILL_ROOT = path.join(app.getPath("userData"), "skills");
const AGENT_SKILL_REGISTRY_PATH = path.join(app.getPath("userData"), "skills.json");
function loadWorkspaceProject(): WorkspaceProject {
  try {
    const raw = JSON.parse(readFileSync(WORKSPACE_PROJECT_PATH, "utf8")) as { path?: unknown };
    if (typeof raw.path !== "string" || !raw.path.trim()) return { path: null, name: null };
    const selected = realpathSync(raw.path);
    if (!statSync(selected).isDirectory()) return { path: null, name: null };
    return { path: selected, name: path.basename(selected) || selected };
  } catch { return { path: null, name: null }; }
}
let workspaceProject = loadWorkspaceProject();
function loadJsonValue(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return null; }
}
const now = Date.now();
const initialSessionId = createHash("sha256").update(workspaceProject.path ?? "__default_workspace__").digest("hex").slice(0, 32);
let agentTasks = parseAgentTasks(loadJsonValue(AGENT_TASKS_PATH));
if (!agentTasks.length) {
  const legacySessions = agentTraceStore.listSessions(500);
  const migrated = legacySessions.flatMap((row): AgentTask[] => {
    const sessionId = typeof row.id === "string" ? row.id : "";
    const hasHistory = Number(row.messageCount ?? 0) > 0 || Number(row.eventCount ?? 0) > 0;
    if (!sessionId || !hasHistory) return [];
    const workspacePath = typeof row.workspacePath === "string" && row.workspacePath.trim() ? row.workspacePath : null;
    const createdAtValue = typeof row.createdAt === "string" ? Date.parse(row.createdAt) : Number(row.createdAt);
    const updatedAtValue = typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) : Number(row.updatedAt);
    const createdAt = Number.isFinite(createdAtValue) && createdAtValue > 0 ? createdAtValue : now;
    const updatedAt = Number.isFinite(updatedAtValue) && updatedAtValue > 0 ? updatedAtValue : createdAt;
    const workspaceName = workspacePath ? path.basename(workspacePath) || workspacePath : "个人工作区";
    return [{
      id: "legacy-" + sessionId,
      sessionId,
      title: workspacePath ? workspaceName + " · 历史会话" : "个人工作区 · 历史会话",
      workspacePath,
      expertId: null,
      createdAt,
      updatedAt,
    }];
  });
  if (!migrated.some(task => task.sessionId === initialSessionId)) {
    migrated.push({
      id: "legacy-" + initialSessionId,
      sessionId: initialSessionId,
      title: workspaceProject.name ? workspaceProject.name + " · 默认任务" : "个人工作区 · 默认任务",
      workspacePath: workspaceProject.path,
      expertId: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  agentTasks = migrated.sort((a, b) => b.updatedAt - a.updatedAt);
  writeJsonAtomic(AGENT_TASKS_PATH, agentTasks);
}
let agentExperts = parseAgentExperts(loadJsonValue(AGENT_EXPERTS_PATH));
if (!agentExperts.length) {
  agentExperts = [
    { id: "general", name: "通用助手", description: "通用桌面 Agent，适合日常任务和跨领域问题。", systemPrompt: "作为通用桌面 Agent，先明确目标，再使用可用工具完成任务。", toolPermission: "none", allowAllTools: false, skills: [], tools: [], createdAt: now, updatedAt: now },
    { id: "researcher", name: "研究分析师", description: "擅长网页研究、资料归纳、比较分析和报告整理。", systemPrompt: "你是一名严谨的研究分析师。优先使用一手资料，区分事实、推断和不确定性，保留来源与证据。先研究再综合，不要编造引用。", toolPermission: "none", allowAllTools: false, skills: [], tools: [], createdAt: now, updatedAt: now },
    { id: "developer", name: "开发工程师", description: "擅长代码阅读、实现、测试和调试。", systemPrompt: "你是一名资深软件工程师。先理解现有架构和代码约定，优先做范围明确的最小变更，执行相关类型检查和测试，并报告实际验证结果。", toolPermission: "none", allowAllTools: false, skills: [], tools: [], createdAt: now, updatedAt: now },
  ];
  writeJsonAtomic(AGENT_EXPERTS_PATH, agentExperts);
}
let agentSchedules = parseAgentSchedules(loadJsonValue(AGENT_SCHEDULES_PATH));
let agentScheduleRuns = parseAgentScheduleRuns(loadJsonValue(AGENT_SCHEDULE_RUNS_PATH));
let recoveredScheduleRuns = false;
for (const run of agentScheduleRuns) {
  if (run.status === "running") {
    run.status = "error";
    run.finishedAt = Date.now();
    run.durationMs = Math.max(0, run.finishedAt - run.startedAt);
    run.error = "应用在上次执行期间退出，任务未能完成。";
    recoveredScheduleRuns = true;
  }
}
if (recoveredScheduleRuns) writeJsonAtomic(AGENT_SCHEDULE_RUNS_PATH, agentScheduleRuns);
let agentWorkspacePreferences = parseAgentWorkspacePreferences(loadJsonValue(AGENT_WORKSPACE_PREFERENCES_PATH));
const savedActiveTask = loadJsonValue(ACTIVE_AGENT_TASK_PATH) as { taskId?: unknown } | null;
const interruptedScheduleRun = typeof savedActiveTask?.taskId === "string"
  ? agentScheduleRuns.find(run => run.taskId === savedActiveTask.taskId && run.error === "应用在上次执行期间退出，任务未能完成。")
  : undefined;
const recoveredActiveTaskId = interruptedScheduleRun?.previousTaskId;
const preferredActiveTaskId = recoveredActiveTaskId && agentTasks.some(task => task.id === recoveredActiveTaskId)
  ? recoveredActiveTaskId
  : savedActiveTask?.taskId;
activeAgentTaskId = typeof preferredActiveTaskId === "string" && agentTasks.some(task => task.id === preferredActiveTaskId)
  ? preferredActiveTaskId
  : (agentTasks.find(task => task.sessionId === initialSessionId)?.id ?? agentTasks[0].id);
writeJsonAtomic(ACTIVE_AGENT_TASK_PATH, { taskId: activeAgentTaskId });
const startupTask = agentTasks.find(task => task.id === activeAgentTaskId);
if (startupTask) {
  try {
    const root = startupTask.workspacePath ? realpathSync(startupTask.workspacePath) : null;
    workspaceProject = root && statSync(root).isDirectory() ? { path: root, name: path.basename(root) || root } : { path: null, name: null };
  } catch { workspaceProject = { path: null, name: null }; }
}
function currentAgentSessionPath(sessionId = currentTraceSessionId()): string {
  return path.join(AGENT_SESSION_ROOT, sessionId + ".json");
}
function loadWorkspaceLayout(): WorkspaceLayoutState {
  try { return parseWorkspaceLayout(JSON.parse(readFileSync(WORKSPACE_LAYOUT_PATH, "utf8"))); }
  catch { return { ...DEFAULT_WORKSPACE_LAYOUT }; }
}
let workspaceLayout = loadWorkspaceLayout();
function loadWorkspaceDocument(): WorkspaceDocument {
  try { return parseWorkspaceDocument(JSON.parse(readFileSync(WORKSPACE_DOCUMENT_PATH, "utf8"))); }
  catch { return parseWorkspaceDocument(workspaceLayout); }
}
let workspaceDocument = loadWorkspaceDocument();
const DEFAULT_SETTINGS: AgentSettings = { provider: "copilot", copilotModel: "", codebuddyModel: "", thinkingLevel: "medium", toolPermission: "none", systemPrompt: "You are a helpful desktop browser agent. Use browser tools to inspect the current page before answering, explain what you did, and keep responses concise. The application safety rules take priority over this prompt." };
function loadAgentSettings(): AgentSettings {
  try { const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<AgentSettings> & { toolPermissionModelVersion?: number }; const hasExplicitPermissionModel = raw.toolPermissionModelVersion === 2; return { ...DEFAULT_SETTINGS, ...raw, provider: raw.provider === "codebuddy" ? "codebuddy" : "copilot", thinkingLevel: raw.thinkingLevel === "low" || raw.thinkingLevel === "high" || raw.thinkingLevel === "xhigh" ? raw.thinkingLevel : "medium", toolPermission: hasExplicitPermissionModel && (raw.toolPermission === "none" || raw.toolPermission === "browser-only" || raw.toolPermission === "assisted" || raw.toolPermission === "allow-all") ? raw.toolPermission : "none", contextWindow: typeof raw.contextWindow === "number" && Number.isSafeInteger(raw.contextWindow) && raw.contextWindow > 0 ? raw.contextWindow : undefined, copilotModel: typeof raw.copilotModel === "string" ? raw.copilotModel.slice(0, 200) : "", codebuddyModel: typeof raw.codebuddyModel === "string" ? raw.codebuddyModel.slice(0, 200) : "", systemPrompt: typeof raw.systemPrompt === "string" ? (raw.systemPrompt.trim() ? raw.systemPrompt.slice(0, 12000) : DEFAULT_SETTINGS.systemPrompt) : DEFAULT_SETTINGS.systemPrompt }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function taskForId(taskId?: string): AgentTask {
  const task = agentTasks.find(item => item.id === (taskId ?? activeAgentTaskId));
  if (!task) throw new Error("Agent Task 不存在。");
  return task;
}
function loadAgentSession(taskId?: string): AgentSessionItem[] {
  const task = taskForId(taskId);
  const stored = agentTraceStore.listSessionItems(task.sessionId);
  if (stored.length) return parseAgentSessionItems(stored);
  try {
    const parsed = JSON.parse(readFileSync(currentAgentSessionPath(task.sessionId), "utf8")) as { items?: unknown };
    return parseAgentSessionItems(parsed.items);
  } catch {
    if (!task.workspacePath && task.sessionId === initialSessionId) {
      try {
        const legacy = JSON.parse(readFileSync(LEGACY_AGENT_SESSION_PATH, "utf8")) as { items?: unknown };
        return parseAgentSessionItems(legacy.items);
      } catch { /* no legacy default-workspace session */ }
    }
    return [];
  }
}
function saveAgentSession(items: AgentSessionItem[], taskId?: string): void {
  const task = taskForId(taskId);
  const complete = parseAgentSessionItems(items);
  try {
    agentTraceStore.saveSessionItems(task.sessionId, task.workspacePath, complete);
    writeJsonAtomic(currentAgentSessionPath(task.sessionId), { version: 1, updatedAt: Date.now(), items: complete.slice(-LEGACY_AGENT_SESSION_ITEMS) });
    task.updatedAt = Date.now();
    writeJsonAtomic(AGENT_TASKS_PATH, agentTasks);
  } catch (error) {
    recordOperation("session", "save failed: " + (error instanceof Error ? error.message : String(error)));
    throw error;
  }
}
let agentSettings = loadAgentSettings();
const copilotAgent = new CopilotDesktopAgent((payload) => {
  if (payload.type === "status" || payload.type === "tool" || payload.type === "error" || payload.type === "done") {
    recordOperation("agent", [payload.type, payload.status, payload.toolName, payload.toolState, payload.text].filter(Boolean).join(" "));
  }
  if (scheduledCapture && scheduledCapture.taskId === activeAgentTaskId) {
    if (payload.type === "delta" && payload.text) scheduledCapture.answer += payload.text;
    if (payload.type === "message" && payload.text) scheduledCapture.answer = payload.text;
    if (payload.type === "error" && payload.text) scheduledCapture.error = payload.text;
  }
  const event = { ...payload, taskId: activeAgentTaskId };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("copilot:event", event);
  if (agentPanelWindow && !agentPanelWindow.isDestroyed()) agentPanelWindow.webContents.send("copilot:event", event);
}, {
  async getCurrentPage() {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return "No active browser tab.";
    return await tab.view.webContents.executeJavaScript(`(() => {
      const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const bodyText = clean(document.body?.innerText).slice(0, 18000);
      const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 40).map(e => clean(e.innerText));
      const links = [...document.querySelectorAll("a[href]")].filter(visible).slice(0, 60).map(a => ({ text: clean(a.innerText || a.getAttribute("aria-label")), href: a.href }));
      const controls = [...document.querySelectorAll("button,input,textarea,select,[role=button]")].filter(visible).slice(0, 60).map(e => ({ tag:e.tagName.toLowerCase(), type:e.type || "", text:clean(e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder")), name:e.getAttribute("name"), id:e.id }));
      return JSON.stringify({ title:document.title, url:location.href, note:"Use browser_snapshot for eN uids accepted by browser_click and browser_fill.", headings, text:bodyText, links, controls });
    })()`);
  },
  async snapshot() {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) throw new Error("No active tab.");
    const result = await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.snapshot(tab.view.webContents), "snapshot");
    const tree = result.tree.length > 120000 ? result.tree.slice(0, 120000) + "\n… (snapshot truncated)" : result.tree;
    return "URL: " + result.url + "\nTitle: " + result.title + "\n\nAccessibility tree (use the eN uid with browser_click or browser_fill):\n" + tree;
  },
  async screenshot(fullPage) {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) throw new Error("No active tab.");
    const image = await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.screenshot(tab.view.webContents, { fullPage }), "screenshot");
    return { text: "Captured " + (fullPage ? "full-page " : "") + "screenshot of " + (tab.url || "the active tab") + ".", image };
  },
  async console(limit) {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) throw new Error("No active tab.");
    const messages = await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.console(tab.view.webContents, limit), "console");
    if (!messages.length) return "No console messages.";
    return messages.map((entry, index) => `${index + 1}. [${entry.type}] ${entry.text.slice(0, 2000)}`).join("\n");
  },
  async listTabs() {
    return JSON.stringify({ activeTabId, tabs: currentState().tabs.map(t => ({ id:t.id, title:t.title, url:t.url, active:t.id===activeTabId, loading:t.isLoading })) });
  },
  async navigate(url) {
    if (!safeWebUrl(url)) throw new Error("Only http(s) URLs are allowed.");
    if (!activeTabId) throw new Error("No active tab.");
    const tab=tabs.get(activeTabId); if (!tab) throw new Error("Active tab not found.");
    await tab.view.webContents.loadURL(url); return "Navigated active tab to " + url;
  },
  async openTab(url) {
    if (!safeWebUrl(url)) throw new Error("Only http(s) URLs are allowed.");
    const id=await createTab(url); return "Opened new tab " + id + " at " + url;
  },
  async switchTab(tabId) {
    if (!tabs.has(tabId)) throw new Error("Unknown tab ID.");
    activateTab(tabId); return "Switched to tab " + tabId;
  },
  async click(uid) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.click(tab.view.webContents, uid), "click");
    return "Clicked element " + uid + ". Call browser_snapshot again if you need updated uids.";
  },
  async fill(uid, value) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.fill(tab.view.webContents, uid, value), "fill");
    return "Filled element " + uid + ". Form was not submitted.";
  },
  async scroll(direction, amount) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    await tab.view.webContents.executeJavaScript("window.scrollBy({top:" + (direction==="down" ? amount : -amount) + ",behavior:'smooth'})");
    return "Scrolled " + direction + " by " + amount + " pixels.";
  },
  async executeJavaScript(code) {
    if (!code.trim()) throw new Error("No JavaScript provided.");
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    const result=await tab.view.webContents.executeJavaScript(`(async () => {\n${code}\n})()`, true);
    if (result===undefined || result===null) return "JavaScript executed.";
    return typeof result==="string" ? result : JSON.stringify(result);
  },
  async injectCss(css) {
    if (!css.trim()) throw new Error("No CSS provided.");
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    await tab.view.webContents.executeJavaScript(`(() => {
      let style=document.querySelector("style[data-agent-injected-css]");
      if (!style) { style=document.createElement("style"); style.setAttribute("data-agent-injected-css","true"); document.head.appendChild(style); }
      style.textContent=${JSON.stringify(css)};
      return true;
    })()`, true);
    return "Injected CSS into " + tab.url + ".";
  },
  async cdp(method, params) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    const result=await withCdpDeadline(tab.cdp, tab.view.webContents, () => tab.cdp.send(tab.view.webContents, method, params), method);
    if (result === undefined || result === null) return "CDP " + method + " completed.";
    const text=typeof result === "string" ? result : JSON.stringify(result);
    return text.length > 20000 ? text.slice(0, 20000) + "… (truncated)" : text;
  }
}, agentSettings, (skills) => { const task = agentTasks.find(item => item.id === activeAgentTaskId); const expert = task?.expertId ? agentExperts.find(item => item.id === task.expertId) : undefined; return [readEnabledPluginInstructions(PLUGIN_ROOT, PLUGIN_REGISTRY_PATH, skills, expert ? (expert.allowAllTools ? undefined : expert.tools) : undefined), readEnabledAgentSkillInstructions(AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH)].filter(Boolean).join("\n\n"); }, workspaceProject.path, (type, data, status, payloadComplete) => recordAgentTrace(type, data, status, payloadComplete), (() => { const task = agentTasks.find(item => item.id === activeAgentTaskId); const expert = task?.expertId ? agentExperts.find(item => item.id === task.expertId) : undefined; return expert ? { systemPrompt: expert.systemPrompt, toolPermission: expert.toolPermission, allowAllTools: expert.allowAllTools, skills: expert.skills, tools: expert.tools } : null; })(), () => listMcpServers(MCP_CONFIG_PATH), (workspacePath, query, limit) => agentTraceStore.searchSessionMessages(workspacePath, query, limit), (workspacePath, after, limit) => agentTraceStore.listMemorySources(workspacePath, after, limit));
function persistAgentTasks(): void {
  agentTasks.sort((a, b) => b.updatedAt - a.updatedAt);
  writeJsonAtomic(AGENT_TASKS_PATH, agentTasks);
}
function persistAgentExperts(): void { writeJsonAtomic(AGENT_EXPERTS_PATH, agentExperts); }
function persistAgentSchedules(): void { writeJsonAtomic(AGENT_SCHEDULES_PATH, agentSchedules); }
function persistAgentScheduleRuns(): void { writeJsonAtomic(AGENT_SCHEDULE_RUNS_PATH, agentScheduleRuns); }
function safeWorkspaceProject(rootInput: string | null): WorkspaceProject {
  if (!rootInput) return { path: null, name: null };
  const root = realpathSync(rootInput);
  if (!statSync(root).isDirectory()) throw new Error("所选 Workspace 不是目录。");
  return { path: root, name: path.basename(root) || root };
}
function buildAgentWorkspaceSnapshot(): AgentWorkspaceSnapshot {
  const grouped = new Map<string, AgentWorkspaceSnapshot["workspaces"][number]>();
  const scheduleRunTaskIds = new Set(agentScheduleRuns.map(run => run.taskId).filter((id): id is string => Boolean(id)));
  const visibleTasks = agentTasks.filter(task => !scheduleRunTaskIds.has(task.id));
  for (const task of agentTasks) {
    const isScheduleRun = scheduleRunTaskIds.has(task.id);
    const key = task.workspacePath ?? "";
    const current = grouped.get(key);
    if (current) {
      if (!isScheduleRun) current.taskCount += 1;
      current.updatedAt = Math.max(current.updatedAt, task.updatedAt);
    } else {
      grouped.set(key, {
        path: task.workspacePath,
        name: task.workspacePath ? path.basename(task.workspacePath) || task.workspacePath : "个人工作区",
        taskCount: isScheduleRun ? 0 : 1,
        updatedAt: task.updatedAt,
      });
    }
  }
  return {
    tasks: [...visibleTasks].sort((a, b) => b.updatedAt - a.updatedAt),
    scheduleRunTasks: [...agentTasks.filter(task => scheduleRunTaskIds.has(task.id))].sort((a, b) => b.updatedAt - a.updatedAt),
    activeTaskId: activeAgentTaskId,
    workspaces: [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    experts: [...agentExperts],
    schedules: [...agentSchedules],
    scheduleRuns: [...agentScheduleRuns],
    preferences: { ...agentWorkspacePreferences },
  };
}
function publishAgentWorkspaceSnapshot(): void {
  const snapshot = buildAgentWorkspaceSnapshot();
  for (const window of [mainWindow, agentPanelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("agent-workspace:updated", snapshot);
  }
}
function createAgentTaskRecord(input: { title?: string; workspacePath?: string | null; expertId?: string | null } = {}): AgentTask {
  const workspace = input.workspacePath === undefined ? workspaceProject : safeWorkspaceProject(input.workspacePath);
  if (input.expertId && !agentExperts.some(expert => expert.id === input.expertId)) throw new Error("所选 Expert 不存在。");
  const timestamp = Date.now();
  const task: AgentTask = {
    id: randomUUID(),
    sessionId: randomUUID(),
    title: (input.title?.trim() || "New task").slice(0, 120),
    workspacePath: workspace.path,
    expertId: input.expertId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  agentTasks.unshift(task);
  persistAgentTasks();
  return task;
}
async function activateAgentTask(taskId: string, publish = true, scheduled = false): Promise<AgentTask> {
  if (scheduleRunnerActive && !scheduled) throw new Error("本地 Schedule 正在执行，请稍后切换 Task。");
  if (taskActivationPending || copilotAgent.isBusy()) throw new Error("另一个 Task 切换或 Agent 请求正在运行，请稍后重试。");
  taskActivationPending = true;
  try {
  const task = taskForId(taskId);
  let nextWorkspace: WorkspaceProject;
  try {
    nextWorkspace = safeWorkspaceProject(task.workspacePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const missingPath = task.workspacePath;
    recordOperation("workspace", "Task " + task.id + " references a missing Workspace: " + missingPath);
    // Keep the original path on the Task so the user can reselect or restore it.
    // The active Agent runtime is detached from the missing directory.
    nextWorkspace = { path: null, name: null };
  }
  const expert = task.expertId ? agentExperts.find(item => item.id === task.expertId) : undefined;
  await copilotAgent.setWorkspacePath(nextWorkspace.path);
  await copilotAgent.setTaskContext(expert ? {
    systemPrompt: expert.systemPrompt,
    toolPermission: expert.toolPermission,
      allowAllTools: expert.allowAllTools,
    skills: expert.skills,
    tools: expert.tools,
  } : null);
  await copilotAgent.resetConversation();
  copilotAgent.setApprovedFiles([...(approvedAgentFiles.get(task.id) ?? [])]);
  activeAgentTaskId = task.id;
  workspaceProject = nextWorkspace;
  writeJsonAtomic(ACTIVE_AGENT_TASK_PATH, { taskId: activeAgentTaskId });
  writeJsonAtomic(WORKSPACE_PROJECT_PATH, workspaceProject);
  if (publish) {
    publishWorkspaceProject();
    publishAgentWorkspaceSnapshot();
  }
  return task;
  } finally {
    taskActivationPending = false;
  }
}
let downloadSequence = 0;

function safeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return url.href === "about:blank";
    // Embedded credentials leak into history, screenshots and crash reports.
    return !url.username && !url.password;
  } catch {
    return value === "about:blank";
  }
}

function resolveAddress(input: string): string {
  const value = input.trim();
  if (!value) return HOME_URL;
  if (value === "about:blank") return value;

  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(value);
  const hasHttpScheme = /^https?:/i.test(value);
  const looksLikeSearch = /\s/.test(value) || (!value.includes(".") && !localHost && !hasHttpScheme);

  if (looksLikeSearch) {
    return "https://www.google.com/search?q=" + encodeURIComponent(value);
  }

  const candidate = localHost && !hasHttpScheme
    ? "http://" + value
    : hasHttpScheme
      ? value
      : "https://" + value;

  if (safeWebUrl(candidate)) return candidate;
  return "https://www.google.com/search?q=" + encodeURIComponent(value);
}

function tabSnapshot(tab: BrowserTab): BrowserTabState {
  const webContents = tab.view.webContents;
  return {
    id: tab.id,
    title: tab.title,
    url: webContents.getURL() || tab.url,
    favicon: tab.favicon,
    isLoading: tab.isLoading,
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
  };
}

function currentState(): BrowserState {
  return {
    tabs: tabOrder
      .map((id) => tabs.get(id))
      .filter((tab): tab is BrowserTab => Boolean(tab))
      .map(tabSnapshot),
    activeTabId,
  };
}

function sendState(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("browser:state", currentState());
  }
}

function updateActiveBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !attachedView) return;
  const [width, height] = mainWindow.getContentSize();
  const left = Math.max(0, Math.min(contentLeft, width));
  const top = Math.max(0, Math.min(contentTop, height));
  const viewport = {
    x: left,
    y: 0,
    width: Math.max(0, Math.min(contentWidth ?? (width - left), width - left)),
    height,
  };
  if (agentWorkspacePreferences.mode === "pure") {
    const visible = agentWorkspacePreferences.rightPanelVisible && agentWorkspacePreferences.rightPanelTab === "browser";
    const pureBounds = visible
      ? { x: left, y: top, width: viewport.width, height: Math.max(0, height - top) }
      : { x: 0, y: 0, width: 0, height: 0 };
    currentBrowserBounds = visible ? pureBounds : null;
    if (!visible) hideSnapshot();
    if (activeTabId) nativeViewStack.setBounds("browser:" + activeTabId, pureBounds);
    if (snapshotActive && currentBrowserBounds) nativeViewStack.setBounds("snapshot", currentBrowserBounds);
    return;
  }
  const panelGroup = workspaceDocument.tabGroups.find((group) => group.panelIds.includes("browser") && group.panelIds.includes("agent"));
  let layoutTree = workspaceDocument.root;
  if (panelGroup) {
    layoutTree = setPanelVisibility(layoutTree, "browser", workspaceDocument.activePanelId === "browser");
    layoutTree = setPanelVisibility(layoutTree, "agent", workspaceDocument.activePanelId === "agent");
  } else {
    layoutTree = setPanelVisibility(layoutTree, "agent", workspaceLayout.agentPanelVisible);
    if (layoutTree.type === "split" && layoutTree.first.type === "panel" && layoutTree.second.type === "panel"
      && [layoutTree.first.id, layoutTree.second.id].includes("browser") && [layoutTree.first.id, layoutTree.second.id].includes("agent")) {
      const isHorizontal = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "right";
      const agentFirst = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "top";
      const available = Math.max(1, (isHorizontal ? viewport.width : viewport.height) - (workspaceLayout.agentPanelVisible ? 6 : 0));
      const agentSize = workspaceLayout.agentPanelVisible ? Math.min(workspaceLayout.agentPanelWidth, available - 320) : 0;
      const browserSize = Math.max(0, available - agentSize);
      const browserNode = layoutTree.first.id === "browser" ? layoutTree.first : layoutTree.second;
      const agentNode = layoutTree.first.id === "agent" ? layoutTree.first : layoutTree.second;      layoutTree = {
        ...layoutTree,
        axis: isHorizontal ? "horizontal" : "vertical",
        splitterSize: workspaceLayout.agentPanelVisible ? 6 : 0,
        ratio: workspaceLayout.agentPanelVisible ? Math.max(0.05, Math.min(0.95, (agentFirst ? agentSize : browserSize) / available)) : 0.5,
        first: agentFirst ? agentNode : browserNode,
        second: agentFirst ? browserNode : agentNode,
      };
    }
  }
  const layout = calculateLayout(layoutTree, viewport, { pixelRatio: 1 });
  const browserBounds = layout.bounds.browser;
  if (!browserBounds) {
    currentBrowserBounds = null;
    hideSnapshot();
    if (activeTabId) nativeViewStack.setBounds("browser:" + activeTabId, { x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  currentBrowserBounds = {
    x: browserBounds.x, y: browserBounds.y + top,
    width: browserBounds.width, height: Math.max(0, browserBounds.height - top),
  };
  nativeViewStack.setBounds("browser:" + activeTabId, currentBrowserBounds);
  if (snapshotActive && currentBrowserBounds) nativeViewStack.setBounds("snapshot", currentBrowserBounds);
}

function hideSnapshot(restoreFocus = false): void {
  if (!snapshotView) { snapshotActive = false; return; }
  nativeViewStack.unregister("snapshot", true);
  snapshotView = null;
  snapshotActive = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:snapshot-state", false);
  if (restoreFocus && activeTabId) nativeViewStack.focus("browser:" + activeTabId);
}

async function toggleSnapshot(): Promise<boolean> {
  if (snapshotCapturing) return snapshotActive;
  if (snapshotActive) {
    hideSnapshot(true);
    return false;
  }
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || !mainWindow || mainWindow.isDestroyed() || !currentBrowserBounds || currentBrowserBounds.width <= 0 || currentBrowserBounds.height <= 0) return false;
  snapshotCapturing = true;
  try {
    const tabId = tab.id;
    const pageUrl = tab.view.webContents.getURL();
    const captured = await tab.view.webContents.capturePage();
    if (activeTabId !== tabId || tabs.get(tabId) !== tab || tab.view.webContents.isLoading() || tab.view.webContents.getURL() !== pageUrl) return false;
    const dataUrl = captured.toDataURL();
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  snapshotView = view;
  nativeViewStack.register("snapshot", view, "overlay");
  const html = "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}img{display:block;width:100%;height:100%;object-fit:fill;user-select:none;-webkit-user-drag:none}</style></head><body><img draggable='false' alt='Page snapshot' src='" + dataUrl + "'></body></html>";
  try {
    await view.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    snapshotActive = true;
    nativeViewStack.show("snapshot");
    nativeViewStack.focus("snapshot");
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:snapshot-state", true);
    if (currentBrowserBounds) nativeViewStack.setBounds("snapshot", currentBrowserBounds);
    return true;
    } catch (error) {
      hideSnapshot();
      throw error;
    }
  } finally {
    snapshotCapturing = false;
  }
}

function activateTab(id: string): void {
  hideSnapshot();
  const nextTab = tabs.get(id);
  if (!nextTab || !mainWindow || mainWindow.isDestroyed()) return;

  if (attachedView && activeTabId) nativeViewStack.hide("browser:" + activeTabId);

  activeTabId = id;
  attachedView = nextTab.view;
  nativeViewStack.show("browser:" + id);
  nativeViewStack.focus("browser:" + id);
  updateActiveBounds();
  sendState();
}

function openExternalIfSupported(value: string): void {
  if (/^(mailto|tel):/i.test(value)) {
    void shell.openExternal(value);
  }
}

function attachTabEvents(tab: BrowserTab): void {
  const webContents = tab.view.webContents;

  webContents.on("did-start-loading", () => {
    if (activeTabId === tab.id) hideSnapshot();
    tab.isLoading = true;
    sendState();
  });

  webContents.on("did-stop-loading", () => {
    tab.isLoading = false;
    tab.url = webContents.getURL() || tab.url;
    sendState();
  });

  webContents.on("did-navigate", (_event, url) => {
    tab.url = url;
    tab.cdp.resetUids();
    sendState();
  });

  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = url;
    tab.cdp.resetUids();
    sendState();
  });

  webContents.on("page-title-updated", (_event, title) => {
    tab.title = title;
    sendState();
  });

  webContents.on("page-favicon-updated", (_event, favicons) => {
    tab.favicon = favicons[0] ?? null;
    sendState();
  });

  webContents.on("will-navigate", (event, url) => {
    if (!safeWebUrl(url)) {
      event.preventDefault();
      openExternalIfSupported(url);
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (!safeWebUrl(url)) {
      event.preventDefault();
      openExternalIfSupported(url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (safeWebUrl(url)) {
      void createTab(url);
    } else {
      openExternalIfSupported(url);
    }
    return { action: "deny" };
  });

  webContents.on("before-input-event", (event, input) => {
    handleBrowserShortcut(event, input);
  });

  webContents.on("context-menu", (_event, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const items: MenuItemConstructorOptions[] = [];
    if (params.linkURL) {
      items.push({
        label: "Open link in new tab",
        click: () => { void createTab(params.linkURL); },
      });
      items.push({
        label: "Copy link address",
        click: () => { clipboard.writeText(params.linkURL); },
      });
      items.push({ type: "separator" });
    }
    if (params.srcURL) {
      items.push({
        label: "Open image in new tab",
        click: () => { void createTab(params.srcURL); },
      });
      items.push({ type: "separator" });
    }

    items.push(
      { label: "Back", enabled: webContents.navigationHistory.canGoBack(), click: () => { webContents.navigationHistory.goBack(); } },
      { label: "Forward", enabled: webContents.navigationHistory.canGoForward(), click: () => { webContents.navigationHistory.goForward(); } },
      { label: "Reload", click: () => { webContents.reload(); } },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy || Boolean(params.selectionText) },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll" },
    );
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires for ordinary redirects and cancellations.
    if (!isMainFrame || errorCode === -3) return;
    recordOperation("browser", `did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  webContents.on("render-process-gone", (_event, details) => {
    tab.isLoading = false;
    tab.title = "This page crashed";
    tab.cdp.resetUids();
    recordOperation("browser", `render-process-gone ${details.reason} exitCode=${details.exitCode} url=${tab.url}`);
    sendState();
  });
}

function handleBrowserShortcut(event: Electron.Event, input: Electron.Input): void {
  if (input.type !== "keyDown") return;

  const command = input.control || input.meta;
  const key = input.key.toLowerCase();

  if (command) {
    if (key === "t") {
      event.preventDefault();
      void createTab();
      return;
    }
    if (key === "w") {
      event.preventDefault();
      if (activeTabId) closeTab(activeTabId);
      return;
    }
    if (key === "l") {
      event.preventDefault();
      mainWindow?.webContents.send("browser:focus-address");
      return;
    }
    if (key === "r") {
      event.preventDefault();
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      tab?.view.webContents.reload();
      return;
    }
    if (key === "f") {
      event.preventDefault();
      mainWindow?.webContents.send("browser:find-requested");
      return;
    }
    if (key === "tab") {
      event.preventDefault();
      switchTab(input.shift ? -1 : 1);
      return;
    }
    if (/^[1-8]$/.test(key)) {
      event.preventDefault();
      const id = tabOrder[Number(key) - 1];
      if (id) activateTab(id);
      return;
    }
    if (key === "9") {
      event.preventDefault();
      const id = tabOrder[tabOrder.length - 1];
      if (id) activateTab(id);
      return;
    }
  }

  if (input.alt && (key === "arrowleft" || key === "left")) {
    event.preventDefault();
    const tab = activeTabId ? tabs.get(activeTabId) : undefined;
    if (tab?.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  } else if (input.alt && (key === "arrowright" || key === "right")) {
    event.preventDefault();
    const tab = activeTabId ? tabs.get(activeTabId) : undefined;
    if (tab?.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  }
}

function switchTab(direction: number): void {
  if (tabOrder.length < 2 || !activeTabId) return;
  const currentIndex = tabOrder.indexOf(activeTabId);
  const nextIndex = (currentIndex + direction + tabOrder.length) % tabOrder.length;
  activateTab(tabOrder[nextIndex]);
}

async function createTab(url = HOME_URL): Promise<string> {
  if (!mainWindow || mainWindow.isDestroyed()) return "";

  const id = randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  const tab: BrowserTab = {    id,
    view,
    cdp: new BrowserCdp(),
    title: "New tab",
    url: "about:blank",
    favicon: null,
    isLoading: false,
  };

  tabs.set(id, tab);
  nativeViewStack.register("browser:" + id, view, "browser");
  tabOrder.push(id);
  attachTabEvents(tab);
  activateTab(id);

  const target = resolveAddress(url);
  tab.url = target;
  sendState();

  try {
    await view.webContents.loadURL(target);
  } catch (error) {
    tab.isLoading = false;
    tab.title = "Unable to load page";
    sendState();
    console.error("Navigation failed", target, error);
  }

  return id;
}

function closeTab(id: string): void {
  const index = tabOrder.indexOf(id);
  const tab = tabs.get(id);
  if (!tab || index < 0) return;

  if (attachedView === tab.view) attachedView = null;
  nativeViewStack.unregister("browser:" + id, false);

  tabs.delete(id);
  tabOrder.splice(index, 1);
  tab.cdp.detach(tab.view.webContents);
  tab.view.webContents.close();

  if (activeTabId === id) {
    activeTabId = null;
    if (tabOrder.length > 0) {
      const nextIndex = Math.min(index, tabOrder.length - 1);
      activateTab(tabOrder[nextIndex]);
    } else {
      void createTab();
    }
  } else {
    sendState();
  }
}

function installPermissionHandlers(): void {
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!ASKABLE_PERMISSIONS.has(permission)) {
      callback(false);
      return;
    }

    let origin = "";
    try {
      origin = new URL(details.requestingUrl || webContents.getURL()).origin;
    } catch {
      callback(false);
      return;
    }

    const grants = permissionGrants.get(origin);
    if (grants?.has(permission)) {
      callback(true);
      return;
    }

    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      callback(false);
      return;
    }

    void dialog.showMessageBox(window, {
      type: "question",
      title: "Website permission",
      message: origin + " wants to access " + permission + ".",
      detail: "Allow this website to use this permission for the current app session?",
      buttons: ["Block", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 1) {
        const current = permissionGrants.get(origin) ?? new Set<string>();
        current.add(permission);
        permissionGrants.set(origin, current);
      }
      callback(response === 1);
    }).catch(() => callback(false));
  });

  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!ASKABLE_PERMISSIONS.has(permission)) return false;
    try {
      const origin = new URL(requestingOrigin || webContents?.getURL() || "").origin;
      return permissionGrants.get(origin)?.has(permission) ?? false;
    } catch {
      return false;
    }
  });

  browserSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.userGesture) {
      callback(null);
      return;
    }

    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      callback(null);
      return;
    }

    void desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    }).then(async (sources) => {
      const available = sources.slice(0, 7);
      if (available.length === 0) {
        callback(null);
        return;
      }

      const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "Share your screen",
        message: "Choose a screen or window to share.",
        detail: "The selected source will be shared with the requesting website.",
        buttons: ["Cancel", ...available.map((source) => source.name)],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });

      const selected = available[result.response - 1];
      if (!selected) {
        callback(null);
        return;
      }

      callback({
        video: selected,
        ...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" as const } : {}),
      });
    }).catch((error: unknown) => {
      console.error("Unable to list screen capture sources", error);
      callback(null);
    });
  }, { useSystemPicker: process.platform === "darwin" });

  browserSession.on("will-download", (_event, item) => {
    const id = ++downloadSequence;
    const publish = (status: BrowserDownloadEvent["status"]) => {
      const payload: BrowserDownloadEvent = {
        id,
        fileName: item.getFilename(),
        status,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath() || undefined,
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("browser:download", payload);
      }
    };

    publish("started");
    item.on("updated", () => publish("progress"));
    item.once("done", (_downloadEvent, state) => {
      publish(state === "completed" ? "completed" : "cancelled");
    });
  });
}

function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "文件",
      submenu: [
        { label: "新建标签页", accelerator: "CmdOrCtrl+T", click: () => { void createTab(); } },
        { label: "关闭标签页", accelerator: "CmdOrCtrl+W", click: () => { if (activeTabId) closeTab(activeTabId); } },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "浏览",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", click: () => {
          const tab = activeTabId ? tabs.get(activeTabId) : undefined;
          tab?.view.webContents.reload();
        } },
        { type: "separator" },
        { label: "在页面中查找", accelerator: "CmdOrCtrl+F", click: () => mainWindow?.webContents.send("browser:find-requested") },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Agent",
      submenu: [
        { label: "打开 Session Explorer", accelerator: "CmdOrCtrl+Shift+E", click: () => openSessionExplorerWindow() },
        { label: "Agent 配置…", accelerator: "CmdOrCtrl+Shift+,", click: () => openAgentSettingsWindow() },
        { type: "separator" },
        { label: "显示 / 隐藏 Agent 面板", accelerator: "CmdOrCtrl+Shift+A", click: () => mainWindow?.webContents.send("agent:toggle-panel") },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Architect Agent Desktop 使用说明", click: () => {
          void shell.openExternal("https://github.com/saga/architect-agent-desktop");
        } },
        { label: "关于 Architect Agent Desktop", click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            void dialog.showMessageBox(mainWindow, {
              title: "关于 Architect Agent Desktop",
              message: "Architect Agent Desktop",
              detail: "本地运行的 Agent 工作台与内置浏览器。",
              buttons: ["确定"],
            });
          }
        } },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

interface SavedWindowState { width: number; height: number; x?: number; y?: number; maximized?: boolean; }
function loadWindowState(): SavedWindowState {
  try {
    const raw = JSON.parse(readFileSync(WINDOW_STATE_PATH, "utf8")) as Partial<SavedWindowState>;
    const width = typeof raw.width === "number" && Number.isFinite(raw.width) ? Math.max(820, Math.min(8000, Math.round(raw.width))) : 1360;
    const height = typeof raw.height === "number" && Number.isFinite(raw.height) ? Math.max(560, Math.min(8000, Math.round(raw.height))) : 900;
    const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.round(raw.x) : undefined;
    const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.round(raw.y) : undefined;
    return { width, height, ...(x !== undefined && y !== undefined ? { x, y } : {}), maximized: raw.maximized === true };
  } catch {
    return { width: 1360, height: 900 };
  }
}
function isWindowStateVisible(state: SavedWindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return state.x! >= area.x - 40 && state.y! >= area.y - 40
      && state.x! < area.x + area.width - 80 && state.y! < area.y + area.height - 80;
  });
}
let windowStateTimer: ReturnType<typeof setTimeout> | undefined;
function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  try {
    writeJsonAtomic(WINDOW_STATE_PATH, { ...bounds, maximized });
  } catch {
    // Window geometry is a convenience; ignore write failures.
  }
}
function scheduleWindowStateSave(): void {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => { windowStateTimer = undefined; saveWindowState(); }, 400);
}

async function recoverWindowRenderer(window: BrowserWindow, details: Electron.RenderProcessGoneDetails): Promise<void> {
  recordCrash("render-process-gone", new Error(`reason=${details.reason} exitCode=${details.exitCode}`));
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "窗口渲染进程已停止",
    message: "应用界面意外停止运行。",
    detail: `原因：${details.reason}（退出码 ${details.exitCode}）\n\n重新加载通常可以恢复；正在进行的 Agent 请求会被中断。`,
    buttons: ["重新加载窗口", "退出应用"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) {
    if (!window.isDestroyed()) window.reload();
    return;
  }
  app.quit();
}
function attachWindowDiagnostics(window: BrowserWindow, label: string, recoverWithDialog = false): void {
  const isAllowedUrl = (url: string) => isTrustedAppUrl(
    url,
    path.join(__dirname, "../renderer/index.html"),
    process.env.VITE_DEV_SERVER_URL,
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    recordCrash(`${label}-preload-error`, new Error(`${preloadPath}: ${error.message}`));
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    recordOperation("app", `${label} did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    recordOperation("app", `${label} render-process-gone ${details.reason} exitCode=${details.exitCode}`);
    if (recoverWithDialog) {
      void recoverWindowRenderer(window, details);
      return;
    }
    // Auxiliary windows are disposable; close them so the app stays usable.
    if (!window.isDestroyed()) window.close();
  });
}

function createMainWindow(): void {
  const savedState = loadWindowState();
  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(isWindowStateVisible(savedState) ? { x: savedState.x, y: savedState.y } : {}),
    minWidth: 820,
    minHeight: 560,
    title: "Architect Agent Desktop",
    backgroundColor: "#f4f3f1",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 14 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (savedState.maximized) mainWindow.maximize();
  mainWindow.on("resize", () => { updateActiveBounds(); scheduleWindowStateSave(); });
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", saveWindowState);
  attachWindowDiagnostics(mainWindow, "main", true);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    handleBrowserShortcut(event, input);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    nativeViewStack.closeAll();
    if (snapshotView && !snapshotView.webContents.isDestroyed()) snapshotView.webContents.close();
    snapshotView = null;
    snapshotActive = false;
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    tabs.clear();
    tabOrder.length = 0;
    activeTabId = null;
    attachedView = null;
    mainWindow = null;
  });

  void createTab();
  if (workspaceDocument.floating.some((item) => item.panelId === "agent")) floatAgentPanel();
}

function isTrustedAppSender(webContents: WebContents): boolean {
  return Boolean((mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents) || (agentSettingsWindow && !agentSettingsWindow.isDestroyed() && webContents === agentSettingsWindow.webContents) || (sessionExplorerWindow && !sessionExplorerWindow.isDestroyed() && webContents === sessionExplorerWindow.webContents) || (agentPanelWindow && !agentPanelWindow.isDestroyed() && webContents === agentPanelWindow.webContents));
}

function publishWorkspaceProject(): void {
  for (const window of [mainWindow, agentPanelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("workspace:project-updated", { ...workspaceProject });
  }
}

function publishWorkspaceLayout(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("workspace:layout-updated", { ...workspaceLayout });
}

function redockAgentPanel(position?: "left" | "right" | "top" | "bottom"): void {
  workspaceDocument = redockFloatingPanel(workspaceDocument, "agent");
  writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
  if (agentPanelWindow && !agentPanelWindow.isDestroyed()) {
    closingAgentPanelForRedock = true;
    agentPanelWindow.close();
  }
  agentPanelWindow = null;
  workspaceLayout = { ...workspaceLayout, agentPanelVisible: true, ...(position ? { agentPanelPosition: position } : {}) };
  writeJsonAtomic(WORKSPACE_LAYOUT_PATH, workspaceLayout);
  const root = workspaceDocument.root;
  if (root.type === "split" && root.first.type === "panel" && root.second.type === "panel") {
    const isHorizontal = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "right";
    const agentFirst = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "top";
    const [windowWidth, windowHeight] = mainWindow?.getContentSize() ?? [1200, 800];
    const available = Math.max(1, (isHorizontal ? (contentWidth ?? windowWidth) : windowHeight) - 6);
    const agentSize = workspaceLayout.agentPanelWidth;
    const browserSize = Math.max(0, available - agentSize);
    const browserNode = root.first.id === "browser" ? root.first : root.second;
    const agentNode = root.first.id === "agent" ? root.first : root.second;
    root.axis = isHorizontal ? "horizontal" : "vertical";
    root.ratio = Math.max(0.05, Math.min(0.95, (agentFirst ? agentSize : browserSize) / available));
    root.first = agentFirst ? { ...agentNode, visible: true } : browserNode;
    root.second = agentFirst ? browserNode : { ...agentNode, visible: true };
    workspaceDocument = { ...workspaceDocument, root };
    writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
  }
  publishWorkspaceLayout();
  updateActiveBounds();
}

function floatAgentPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (agentPanelWindow && !agentPanelWindow.isDestroyed()) {
    agentPanelWindow.show(); agentPanelWindow.focus(); return;
  }
  const savedBounds = workspaceDocument.floating.find((item) => item.panelId === "agent")?.bounds;
  const requestedBounds = savedBounds ?? { x: 120, y: 100, width: 480, height: 760 };
  const workArea = screen.getDisplayMatching(requestedBounds).workArea;
  const width = Math.min(Math.max(360, requestedBounds.width), workArea.width);
  const height = Math.min(Math.max(480, requestedBounds.height), workArea.height);
  const restoredBounds = {
    x: Math.max(workArea.x, Math.min(requestedBounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(requestedBounds.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
  const window = new BrowserWindow({
    parent: mainWindow, ...restoredBounds, minWidth: 360, minHeight: 480,
    title: "Browser Agent", backgroundColor: "#ffffff", autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  agentPanelWindow = window;
  attachWindowDiagnostics(window, "agent-panel");
  workspaceDocument = createFloatingPanel(workspaceDocument, "agent", { x: 120, y: 100, width: 480, height: 760 });
  writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
  const updateFloatingBounds = () => {
    const bounds = window.getBounds();
    workspaceDocument = { ...workspaceDocument, floating: workspaceDocument.floating.map((item) => item.panelId === "agent" ? { ...item, bounds } : item) };
  };
  window.on("move", updateFloatingBounds);
  window.on("resize", updateFloatingBounds);
  window.on("close", () => {
    updateFloatingBounds();
    writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
  });
  window.on("closed", () => {
    if (agentPanelWindow === window) agentPanelWindow = null;
    const wasRedocking = closingAgentPanelForRedock;
    closingAgentPanelForRedock = false;
    if (!wasRedocking && !isQuitting) {
      workspaceDocument = redockFloatingPanel(workspaceDocument, "agent");
      writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
      workspaceLayout = { ...workspaceLayout, agentPanelVisible: true };
      writeJsonAtomic(WORKSPACE_LAYOUT_PATH, workspaceLayout);
      publishWorkspaceLayout();
      updateActiveBounds();
    }
    closingAgentPanelForRedock = false;
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const loading = devServerUrl
    ? window.loadURL(devServerUrl + (devServerUrl.includes("?") ? "&" : "?") + "agent-panel=1")
    : window.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "agent-panel": "1" } });
  void loading.catch((error: unknown) => {
    console.error("Unable to open floating Agent panel", error);
    if (!window.isDestroyed()) window.close();
  });
  workspaceLayout = { ...workspaceLayout, agentPanelVisible: false };
  writeJsonAtomic(WORKSPACE_LAYOUT_PATH, workspaceLayout);
  publishWorkspaceLayout();
  updateActiveBounds();
}

function openSessionExplorerWindow(): void {
  if (sessionExplorerWindow && !sessionExplorerWindow.isDestroyed()) {
    if (sessionExplorerWindow.isMinimized()) sessionExplorerWindow.restore();
    sessionExplorerWindow.show();
    sessionExplorerWindow.focus();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // WebContentsView is a native child view and paints above the main renderer DOM.
  // Keep Session Explorer in its own window rather than a Drawer that the browser view can cover.
  const explorerWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    show: false,
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    resizable: true,
    maximizable: true,
    title: "Session Explorer",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  sessionExplorerWindow = explorerWindow;
  attachWindowDiagnostics(explorerWindow, "session-explorer");
  explorerWindow.once("ready-to-show", () => {
    if (!explorerWindow.isDestroyed()) {
      explorerWindow.center();
      explorerWindow.show();
      explorerWindow.focus();
    }
  });
  explorerWindow.on("closed", () => {
    if (sessionExplorerWindow === explorerWindow) sessionExplorerWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const loading = devServerUrl
    ? explorerWindow.loadURL(devServerUrl + (devServerUrl.includes("?") ? "&" : "?") + "session-explorer=1")
    : explorerWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "session-explorer": "1" } });
  void loading.catch((error: unknown) => {
    console.error("Unable to open Session Explorer", error);
    if (!explorerWindow.isDestroyed()) explorerWindow.close();
  });
}

function openAgentSettingsWindow(): void {
  if (agentSettingsWindow && !agentSettingsWindow.isDestroyed()) {
    agentSettingsWindow.show();
    agentSettingsWindow.focus();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // WebContentsView is a native child view and is always composited above the
  // main renderer's DOM. Keep settings in a real native child window instead
  // of trying to place a React/Ant Design modal over the embedded browser.
  const settingsWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    show: false,
    width: 960,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    resizable: true,
    maximizable: false,
    minimizable: false,
    title: "Agent 配置",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  agentSettingsWindow = settingsWindow;
  attachWindowDiagnostics(settingsWindow, "agent-settings");
  settingsWindow.once("ready-to-show", () => {
    if (!settingsWindow.isDestroyed()) {
      settingsWindow.center();
      settingsWindow.show();
      settingsWindow.focus();
    }
  });
  settingsWindow.on("closed", () => {
    if (agentSettingsWindow === settingsWindow) agentSettingsWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const loading = devServerUrl
    ? settingsWindow.loadURL(devServerUrl + (devServerUrl.includes("?") ? "&" : "?") + "agent-settings=1")
    : settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "agent-settings": "1" } });
  void loading.catch((error: unknown) => {
    console.error("Unable to open Agent settings window", error);
    if (!settingsWindow.isDestroyed()) settingsWindow.close();
  });
}

function assertAgentExtensionsIdle(): void {
  if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
    throw new Error("Agent 正在运行或切换 Task，请等待当前请求结束后再修改 MCP 和 Agent Skills。");
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (
    !isTrustedAppSender(event.sender)
    || !frame
    || frame !== event.sender.mainFrame
    || !isTrustedAppUrl(frame.url, path.join(__dirname, "../renderer/index.html"), process.env.VITE_DEV_SERVER_URL)
  ) {
    throw new Error("Untrusted IPC sender or frame");
  }
}

let scheduleRunnerActive = false;
let schedulerTimer: NodeJS.Timeout | null = null;

function notifyScheduleRun(title: string, succeeded: boolean): void {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: succeeded ? "定时任务已完成" : "定时任务执行失败",
      body: title + (succeeded ? " · 结果已保存，可在运行记录中查看。" : " · 请在运行记录中查看失败原因。"),
    });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  } catch (error) {
    recordOperation("schedule", "notification failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

function memoryDreamTaskEligible(task: AgentTask): boolean {
  const rank: Record<AgentToolPermission, number> = { none: 0, "browser-only": 1, assisted: 2, "allow-all": 3 };
  if (task.workspacePath) {
    try {
      const resolved = realpathSync(task.workspacePath);
      if (resolved !== task.workspacePath || !statSync(resolved).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  if (rank[agentSettings.toolPermission] < rank.assisted) return false;
  if (!task.expertId) return true;
  const expert = agentExperts.find(item => item.id === task.expertId);
  if (!expert || rank[expert.toolPermission] < rank.assisted) return false;
  if (expert.allowAllTools) return true;
  const required = [
    "memory_search", "memory_search_history", "memory_read_source",
    "memory_list_notes", "memory_list_knowledge", "memory_list_relationships",
    "memory_dreaming_prepare", "memory_dreaming_commit", "memory_dreaming_list_runs",
    "memory_dreaming_get_run", "memory_dreaming_get_operations",
    "memory_quality_review_prepare", "memory_quality_review_list",
    "memory_dreaming_abandon", "memory_prune_expired",
  ];
  return required.every(name => expert.tools.includes(name));
}

async function processDueMemoryDreamingSchedules(): Promise<void> {
  const due = copilotAgent.listDueMemoryDreamSchedules(Date.now(), 10);
  if (!due.length) return;
  for (const schedule of due) {
    if (!copilotAgent.claimMemoryDreamSchedule(schedule.scope, Date.now())) continue;
    const eligibleTask = agentTasks
      .filter(task => task.workspacePath === schedule.scope && memoryDreamTaskEligible(task))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!eligibleTask) {
      const reason = "没有可执行 Memory Dreaming 的 Task。请为当前 Memory scope（Personal 或 Workspace）选择开放长期记忆工具的 Expert，并将全局与 Expert 工具权限至少设置为 assisted。";
      copilotAgent.finishMemoryDreamSchedule(schedule.scope, "error", reason);
      recordOperation("memory-dreaming", reason + " Workspace=" + (schedule.scope ?? "Personal"));
      continue;
    }

    const previousTaskId = activeAgentTaskId;
    const startedAt = Date.now();
    const runId = randomUUID();
    let failure = "";
    let skipped = false;
    try {
      await activateAgentTask(eligibleTask.id, false, true);
      activeAgentTraceId = runId;
      copilotAgent.setMemoryContext(eligibleTask.sessionId, runId);
      scheduledCapture = { taskId: eligibleTask.id, answer: "" };
      const maintenance = copilotAgent.getMemoryMaintenanceStatus(schedule.scope);
      recordTaskTrace(eligibleTask, "memory.dreaming.schedule.started", {
        runId, workspacePath: schedule.scope, intervalMinutes: schedule.intervalMinutes, maintenance,
      });
      if (!maintenance.hasWork) {
        skipped = true;
        scheduledCapture.answer = "本次本地预检未发现新的 Transcript、到期质量复查、过期 Note 或待恢复 Run；未启动模型调用。";
        recordTaskTrace(eligibleTask, "memory.dreaming.schedule.skipped", { runId, maintenance });
      } else {
        const prompt = [
          "执行当前 Memory scope（Personal 或 Workspace）的自动 Memory Dreaming 维护。这是后台维护任务，不要把本次维护对话或工具执行日志沉淀为长期知识。",
          "第一步调用 memory_dreaming_list_runs，检查是否存在 prepared Run。如果存在，先用 memory_dreaming_get_run 读取 Run 的 purpose 和固定 evidence，再按类型继续；不要创建第二个 Run。purpose=quality_review 时，直接调用 memory_quality_review_list({runId})，只提交带当前 Run qualityReviewSourceRefs 的 review_note；purpose=transcript 时按下一步处理。没有待处理 Run 时才调用 memory_dreaming_prepare。",
          "对于 transcript Run：读取固定 evidence，检查 Notes、知识页与关系；对重要旧 Note 使用 memory_read_source 追溯历史 sourceRefs，必要时用 memory_search_history 搜索完整历史。所有 [TRUNCATED] 内容都只是预览，必须回查原始 Transcript。识别新事实、业务定义、用户明确偏好、成功流程、反复失败、已解决问题与冲突。更新必须带 baseVersion，每项操作引用当前 Run 的 sourceId 和 reason。无须变化时提交 operations=[]。成功后读取审计结果。",
          "完成 transcript Run 后，再调用 memory_quality_review_prepare。若有到期候选，调用 memory_quality_review_list({runId})，只处理该 Run 返回的候选 Note；使用每条记录的 qualityReviewSourceRefs 作为 review_note.sourceRefs，不能使用旧 Run 的 sourceRefs。若没有任何候选映射，调用 memory_dreaming_abandon 放弃该质量复查 Run。提交当前 baseVersion、confidence 和 qualityScore（0–1）。质量评分考虑来源可靠性、直接性、清晰程度、时效性和交叉印证；不得因为旧 Note 标记为 validated 就自动信任，也不得在证据不足时提升为 validated。证据不再适用时标 disputed，无法重新确认时保留 unverified。每个复查 Run 成功提交并读取审计结果。",
          "最后调用 memory_prune_expired 清理已过期且未置顶的 Note。不得归档置顶或唯一知识，不得删除原始 Transcript。任何版本冲突都应停止该项更新并报告，不允许覆盖新版本。"
        ].join("\\n\\n");
        await copilotAgent.send(prompt, []);
        const toolResults = agentTraceStore.query({ traceId: runId, type: "tool.result", limit: 1000 });
        const completedTools = new Set(toolResults.flatMap(event => {
          const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
          return typeof data.name === "string" ? [data.name] : [];
        }));
        const hasTranscriptAssessment = completedTools.has("memory_dreaming_prepare") || completedTools.has("memory_dreaming_get_run");
        const hasQualityAssessment = completedTools.has("memory_quality_review_prepare");
        const hasExpiryCleanup = completedTools.has("memory_prune_expired");
        if (!hasTranscriptAssessment || !hasQualityAssessment || !hasExpiryCleanup) {
          failure = "自动 Dreaming 未完成全部维护步骤。请检查本次 Trace 中的 memory_dreaming_prepare/get_run、memory_quality_review_prepare 和 memory_prune_expired 工具结果。";
        }
        if (completedTools.has("memory_dreaming_abandon") || completedTools.has("memory_dreaming_rollback")) {
          failure = "自动 Dreaming 中有 Run 被主动放弃或回滚；请检查冲突原因和 Run 审计记录。";
        }
        const afterRun = copilotAgent.getMemorySnapshot(schedule.scope);
        const pendingRun = afterRun.dreamRuns.find(run => String(run.status) === "prepared");
        if (pendingRun) failure = "自动 Dreaming 留下了未提交 Run：" + String(pendingRun.id) + "。该 Run 已保留，可在 Memory 管理界面继续处理。";
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      const captured = scheduledCapture;
      scheduledCapture = null;
      const errorText = captured?.error || failure || (!captured?.answer.trim() ? "Memory Dreaming Agent 没有返回可确认的完成结果。" : "");
      const succeeded = !errorText;
      const finishedAt = Date.now();
      copilotAgent.finishMemoryDreamSchedule(schedule.scope, succeeded ? "success" : "error", errorText || null, finishedAt);
      recordTaskTrace(eligibleTask, "memory.dreaming.schedule.completed", {
        runId, status: succeeded ? "success" : "error",
        durationMs: Math.max(0, finishedAt - startedAt),
        skipped,
        resultPreview: captured?.answer.trim().slice(0, 1200) || undefined,
        error: errorText || undefined,
      });
      activeAgentTraceId = null;
      if (agentTasks.some(task => task.id === previousTaskId)) {
        try { await activateAgentTask(previousTaskId, false, true); }
        catch (error) { recordOperation("memory-dreaming", "failed to restore Task: " + (error instanceof Error ? error.message : String(error))); }
      }
      publishAgentWorkspaceSnapshot();
      if (!succeeded) recordOperation("memory-dreaming", "scheduled Dreaming failed: " + errorText);
      if (!skipped || !succeeded) notifyScheduleRun("Memory Dreaming · " + (schedule.scope ?? "Personal Workspace"), succeeded);
    }
    break;
  }
}

async function processDueAgentSchedules(manualScheduleId?: string): Promise<void> {
  const manual = Boolean(manualScheduleId);
  if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
    if (manual) throw new Error("Agent 正在运行，请完成当前请求后再立即运行定时任务。");
    return;
  }
  if (manual && !agentSchedules.some(item => item.id === manualScheduleId)) throw new Error("定时任务不存在。");

  scheduleRunnerActive = true;
  try {
    const due = manual
      ? agentSchedules.filter(item => item.id === manualScheduleId)
      : agentSchedules.filter(item => item.enabled && Date.parse(item.runAt) <= Date.now()).sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));

    for (const candidate of due) {
      const currentDefinition = agentSchedules.find(item => item.id === candidate.id);
      if (!currentDefinition) continue;
      if (!manual && (!currentDefinition.enabled || Date.parse(currentDefinition.runAt) > Date.now()
        || currentDefinition.updatedAt !== candidate.updatedAt || currentDefinition.runAt !== candidate.runAt)) continue;
      if (copilotAgent.isBusy()) break;

      const schedule: AgentSchedule = {
        ...currentDefinition,
        weekdays: currentDefinition.weekdays ? [...currentDefinition.weekdays] : undefined,
        monthDays: currentDefinition.monthDays ? [...currentDefinition.monthDays] : undefined,
      };
      const previousTaskId = activeAgentTaskId;
      const runStartedAt = Date.now();
      const runId = randomUUID();
      const runRecord: AgentScheduleRun = {
        id: runId,
        scheduleId: schedule.id,
        scheduleTitle: schedule.title,
        trigger: manual ? "manual" : "scheduled",
        scheduledAt: manual ? new Date(runStartedAt).toISOString() : schedule.runAt,
        taskId: null,
        previousTaskId,
        startedAt: runStartedAt,
        status: "running",
      };
      agentScheduleRuns = [runRecord, ...agentScheduleRuns].slice(0, 500);
      persistAgentScheduleRuns();
      publishAgentWorkspaceSnapshot();

      let runTask: AgentTask | null = null;
      let failure = "";
      try {
        runTask = createAgentTaskRecord({
          title: ("定时任务 · " + schedule.title + " · " + new Date(runStartedAt).toLocaleString()).slice(0, 120),
          workspacePath: schedule.workspacePath,
          expertId: schedule.expertId,
        });
        runRecord.taskId = runTask.id;
        persistAgentScheduleRuns();
        await activateAgentTask(runTask.id, false, true);
        activeAgentTraceId = runId;
        scheduledCapture = { taskId: runTask.id, answer: "" };
        recordAgentTrace("schedule.started", {
          scheduleId: schedule.id, scheduleRunId: runId, trigger: runRecord.trigger,
          title: schedule.title, prompt: schedule.prompt,
        }, "running");
        await copilotAgent.send(schedule.prompt, []);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        recordAgentTrace("schedule.failed", { scheduleId: schedule.id, scheduleRunId: runId, error: failure }, "failed");
      } finally {
        const captured = scheduledCapture;
        scheduledCapture = null;
        const errorText = captured?.error || failure;
        if (runTask) {
          const messages: AgentSessionItem[] = [
            { id: randomUUID(), kind: "user", content: schedule.prompt, createdAt: runStartedAt },
          ];
          if (captured?.answer.trim()) messages.push({ id: randomUUID(), kind: "assistant", content: captured.answer.trim(), createdAt: Date.now() });
          if (errorText) messages.push({ id: randomUUID(), kind: "error", content: errorText, createdAt: Date.now() });
          agentTraceStore.saveSessionItems(runTask.sessionId, runTask.workspacePath, messages);
          writeJsonAtomic(currentAgentSessionPath(runTask.sessionId), { version: 1, updatedAt: Date.now(), items: messages });
          runTask.lastRunAt = Date.now();
          runTask.updatedAt = Date.now();
          persistAgentTasks();
        }

        const finishedAt = Date.now();
        const succeeded = !errorText;
        const savedRun = agentScheduleRuns.find(item => item.id === runId);
        if (savedRun) {
          savedRun.taskId = runTask?.id ?? null;
          savedRun.status = succeeded ? "success" : "error";
          savedRun.finishedAt = finishedAt;
          savedRun.durationMs = Math.max(0, finishedAt - runStartedAt);
          savedRun.resultPreview = captured?.answer.trim().slice(0, 1200) || undefined;
          savedRun.error = errorText ? errorText.slice(0, 2000) : undefined;
          persistAgentScheduleRuns();
        }

        const current = agentSchedules.find(item => item.id === schedule.id);
        if (current) {
          current.lastRunAt = finishedAt;
          current.lastRunStatus = succeeded ? "success" : "error";
          current.lastRunId = runId;
          current.lastError = errorText ? errorText.slice(0, 2000) : undefined;

          // A pause or edit made while a run is active affects the next trigger,
          // but never cancels or overwrites the configuration used by this run.
          const definitionUnchanged = current.updatedAt === schedule.updatedAt;
          if (!manual && definitionUnchanged) {
            if (current.repeat === "none") current.enabled = false;
            else {
              const next = nextScheduleRunAt(current.runAt, current.repeat, finishedAt, {
                intervalMinutes: current.intervalMinutes,
                weekdays: current.weekdays,
                monthDays: current.monthDays,
                endsAt: current.endsAt,
              });
              if (next) current.runAt = next;
              else current.enabled = false;
            }
          }
          current.updatedAt = finishedAt;
          persistAgentSchedules();
        }

        recordAgentTrace("schedule.completed", {
          scheduleId: schedule.id, scheduleRunId: runId, trigger: runRecord.trigger,
          status: succeeded ? "success" : "error", durationMs: finishedAt - runStartedAt,
        }, succeeded ? "completed" : "failed");
        activeAgentTraceId = null;
        if (agentTasks.some(item => item.id === previousTaskId)) {
          try { await activateAgentTask(previousTaskId, false, true); }
          catch (error) { recordOperation("schedule", "failed to restore Task: " + (error instanceof Error ? error.message : String(error))); }
        }
        publishAgentWorkspaceSnapshot();
        notifyScheduleRun(schedule.title, succeeded);
      }
      if (manual) break;
    }
    if (!manual) await processDueMemoryDreamingSchedules();
  } finally {
    scheduleRunnerActive = false;
    publishAgentWorkspaceSnapshot();
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("agent-workspace:get-snapshot", (event) => {
    assertTrustedSender(event);
    return buildAgentWorkspaceSnapshot();
  });
  ipcMain.handle("agent-workspace:save-preferences", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({
      mode: z.enum(["sidepanel", "pure"]),
      leftWidth: z.number().finite(),
      rightWidth: z.number().finite(),
      rightPanelVisible: z.boolean(),
      rightPanelTab: z.enum(["browser", "files", "results"]),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Agent workspace preferences.");
    agentWorkspacePreferences = parseAgentWorkspacePreferences(parsed.data);
    writeJsonAtomic(AGENT_WORKSPACE_PREFERENCES_PATH, agentWorkspacePreferences);
    updateActiveBounds();
    publishAgentWorkspaceSnapshot();
    return { ...agentWorkspacePreferences };
  });
  ipcMain.handle("agent-task:create", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后新建 Task。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请完成或取消当前任务后再新建 Task。");
    const parsed = z.object({
      title: z.string().trim().max(120).optional(),
      workspacePath: z.string().max(4096).nullable().optional(),
      expertId: z.string().max(100).nullable().optional(),
    }).safeParse(input ?? {});
    if (!parsed.success) throw new Error("Invalid Agent Task.");
    const workspacePath = parsed.data.workspacePath === undefined ? workspaceProject.path : parsed.data.workspacePath;
    if (workspacePath && !agentTasks.some(task => task.workspacePath === workspacePath) && workspacePath !== workspaceProject.path) {
      throw new Error("必须先将 Workspace 添加到工作区列表。");
    }
    const task = createAgentTaskRecord({
      title: parsed.data.title,
      workspacePath,
      expertId: parsed.data.expertId === undefined ? taskForId().expertId : parsed.data.expertId,
    });
    await activateAgentTask(task.id);
    return task;
  });
  ipcMain.handle("agent-task:activate", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
      throw new Error("Agent 正在运行或切换 Task，请稍后重试。");
    }
    const parsed = z.string().min(1).max(100).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Task ID.");
    return activateAgentTask(parsed.data);
  });
  ipcMain.handle("agent-task:set-expert", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后切换 Expert。");
    const parsed = z.object({ taskId: z.string().min(1).max(100), expertId: z.string().max(100).nullable() }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Task Expert assignment.");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请完成或取消当前任务后再切换 Expert。");
    if (parsed.data.expertId && !agentExperts.some(item => item.id === parsed.data.expertId)) throw new Error("所选 Expert 不存在。");
    const task = taskForId(parsed.data.taskId);
    task.expertId = parsed.data.expertId;
    task.updatedAt = Date.now();
    persistAgentTasks();
    if (activeAgentTaskId === task.id) await activateAgentTask(task.id);
    else publishAgentWorkspaceSnapshot();
    return task;
  });
  ipcMain.handle("agent-workspace:add", async (event) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后添加 Workspace。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请完成或取消当前任务后再添加 Workspace。");
    taskActivationPending = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({ title: "添加 Workspace 文件夹", properties: ["openDirectory"] });
      if (canceled || !filePaths[0]) return null;
      const selected = safeWorkspaceProject(realpathSync(filePaths[0]));
      const existing = agentTasks.filter(task => task.workspacePath === selected.path).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const task = existing ?? createAgentTaskRecord({ workspacePath: selected.path, title: selected.name + " · New task" });
      taskActivationPending = false;
      await activateAgentTask(task.id);
      return task;
    } finally {
      taskActivationPending = false;
    }
  });
    ipcMain.handle("agent-expert:save", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后修改 Expert。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请完成或取消当前任务后再修改 Expert。");
    const parsed = z.object({
      id: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(80),
      description: z.string().max(500),
      systemPrompt: z.string().max(12000),
      toolPermission: z.enum(["none", "browser-only", "assisted", "allow-all"]),
      allowAllTools: z.boolean().default(false),
      skills: z.array(z.string().min(1).max(200)).max(100),
      tools: z.array(z.string().min(1).max(100)).max(100),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Expert definition.");
    if (new Set(parsed.data.skills).size !== parsed.data.skills.length || new Set(parsed.data.tools).size !== parsed.data.tools.length) throw new Error("Expert Skills 和 Tools 不能重复。");
    const pluginSkills = listPlugins(PLUGIN_ROOT, PLUGIN_REGISTRY_PATH).flatMap(plugin => plugin.skills.map(skill => plugin.id + ":" + skill));
    if (parsed.data.skills.some(skill => !pluginSkills.includes(skill))) throw new Error("Expert 引用了不存在或未安装的 Plugin Skill。");
    if (parsed.data.tools.some(tool => !AGENT_TOOL_IDS.has(tool))) throw new Error("Expert 包含不存在或当前应用不支持的 Tool ID。");
    const previous = agentExperts.find(item => item.id === parsed.data.id);
    const timestamp = Date.now();
    const expert: AgentExpert = { ...parsed.data, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp };
    agentExperts = [...agentExperts.filter(item => item.id !== expert.id), expert].sort((a, b) => a.name.localeCompare(b.name));
    persistAgentExperts();
    const activeTask = taskForId();
    if (activeTask.expertId === expert.id) await activateAgentTask(activeTask.id);
    publishAgentWorkspaceSnapshot();
    return agentExperts;
  });
  ipcMain.handle("agent-expert:delete", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后删除 Expert。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请完成或取消当前任务后再删除 Expert。");
    const parsed = z.string().min(1).max(100).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Expert ID.");
    const activeTaskUsesExpert = taskForId().expertId === parsed.data;
    agentExperts = agentExperts.filter(item => item.id !== parsed.data);
    for (const task of agentTasks) if (task.expertId === parsed.data) task.expertId = null;
    for (const schedule of agentSchedules) if (schedule.expertId === parsed.data) schedule.expertId = null;
    persistAgentExperts();
    persistAgentTasks();
    persistAgentSchedules();
    if (activeTaskUsesExpert) await activateAgentTask(activeAgentTaskId);
    publishAgentWorkspaceSnapshot();
    return agentExperts;
  });
  ipcMain.handle("agent-schedule:save", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({
      id: z.string().min(1).max(100),
      title: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(30000),
      workspacePath: z.string().max(4096).nullable(),
      expertId: z.string().max(100).nullable(),
      runAt: z.string().datetime({ offset: true }),
      repeat: z.enum(["none", "interval", "daily", "weekly", "biweekly", "monthly", "yearly"]),
      intervalMinutes: z.number().int().min(1).max(525600).optional(),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      monthDays: z.array(z.number().int().min(1).max(31)).max(31).optional(),
      endsAt: z.string().datetime({ offset: true }).nullable().optional(),
      enabled: z.boolean(),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Schedule definition.");
    if (parsed.data.workspacePath && !agentTasks.some(task => task.workspacePath === parsed.data.workspacePath)) throw new Error("Schedule 必须关联已登记的 Workspace。");
    if (parsed.data.expertId && !agentExperts.some(expert => expert.id === parsed.data.expertId)) throw new Error("Schedule 引用了不存在的 Expert。");
    if (parsed.data.endsAt && Date.parse(parsed.data.endsAt) < Date.parse(parsed.data.runAt)) throw new Error("任务有效期不能早于首次执行时间。");
    const previous = agentSchedules.find(item => item.id === parsed.data.id);
    let runAt = parsed.data.runAt;
    if (previous && !previous.enabled && parsed.data.enabled && Date.parse(runAt) <= Date.now() && parsed.data.repeat !== "none") {
      const next = nextScheduleRunAt(runAt, parsed.data.repeat, Date.now(), {
        intervalMinutes: parsed.data.intervalMinutes,
        weekdays: parsed.data.weekdays,
        monthDays: parsed.data.monthDays,
        endsAt: parsed.data.endsAt,
      });
      if (next) runAt = next;
      else throw new Error("这个任务已超过有效期，请修改执行时间或有效期后再启用。");
    }
    const timestamp = Date.now();
    const schedule: AgentSchedule = {
      ...parsed.data,
      runAt,
      weekdays: parsed.data.weekdays ? [...new Set(parsed.data.weekdays)].sort((a, b) => a - b) : undefined,
      monthDays: parsed.data.monthDays ? [...new Set(parsed.data.monthDays)].sort((a, b) => a - b) : undefined,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastRunAt: previous?.lastRunAt,
      lastRunStatus: previous?.lastRunStatus,
      lastRunId: previous?.lastRunId,
      lastError: previous?.lastError,
    };
    agentSchedules = [...agentSchedules.filter(item => item.id !== schedule.id), schedule].sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
    persistAgentSchedules();
    publishAgentWorkspaceSnapshot();
    return agentSchedules;
  });
  ipcMain.handle("agent-schedule:delete", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(1).max(100).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Schedule ID.");
    agentSchedules = agentSchedules.filter(item => item.id !== parsed.data);
    persistAgentSchedules();
    publishAgentWorkspaceSnapshot();
    return agentSchedules;
  });
  ipcMain.handle("agent-schedule:run-now", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(1).max(100).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Schedule ID.");
    await processDueAgentSchedules(parsed.data);
  });
  ipcMain.handle("agent-workspace:list-files", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(1).max(4096).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Workspace path.");
    const workspace = safeWorkspaceProject(parsed.data);
    if (!agentTasks.some(task => task.workspacePath === workspace.path)) throw new Error("Workspace 尚未登记。");
    return listWorkspaceFiles(workspace.path as string).split("\n").filter(Boolean);
  });
  ipcMain.handle("agent-workspace:read-file", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ workspacePath: z.string().min(1).max(4096), relativePath: z.string().min(1).max(1000) }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Workspace file request.");
    const workspace = safeWorkspaceProject(parsed.data.workspacePath);
    if (!agentTasks.some(task => task.workspacePath === workspace.path)) throw new Error("Workspace 尚未登记。");
    return readWorkspaceFile(workspace.path as string, parsed.data.relativePath);
  });
  ipcMain.handle("workspace:get-project", (event) => { assertTrustedSender(event); return { ...workspaceProject }; });
  ipcMain.handle("workspace:select-project", async (event) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后切换 Workspace。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在处理请求，请完成或取消当前任务后再切换工作区。");
    taskActivationPending = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({ title: "选择本地工作区", properties: ["openDirectory"] });
      if (canceled || !filePaths[0]) return null;
      const selected = realpathSync(filePaths[0]);
      if (!statSync(selected).isDirectory()) throw new Error("所选路径不是目录。");
      const task = taskForId();
      task.workspacePath = selected;
      task.updatedAt = Date.now();
      persistAgentTasks();
      taskActivationPending = false;
      await activateAgentTask(task.id);
      recordOperation("workspace", "select " + selected);
      return { ...workspaceProject };
    } finally {
      taskActivationPending = false;
    }
  });
    ipcMain.handle("workspace:clear-project", async (event) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后切换 Workspace。");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在处理请求，请完成或取消当前任务后再清除工作区。");
    const task = taskForId();
    task.workspacePath = null;
    task.updatedAt = Date.now();
    persistAgentTasks();
    await activateAgentTask(task.id);
    recordOperation("workspace", "clear");
    return { ...workspaceProject };
  });
  ipcMain.handle("workspace:get-layout", (event) => { assertTrustedSender(event); return { ...workspaceLayout }; });
  ipcMain.handle("workspace:float-agent", (event) => { assertTrustedSender(event); floatAgentPanel(); });
  ipcMain.handle("workspace:redock-agent", (event, position?: unknown) => { assertTrustedSender(event); if (position !== undefined && position !== "left" && position !== "right" && position !== "top" && position !== "bottom") throw new Error("Invalid dock position."); redockAgentPanel(position as "left" | "right" | "top" | "bottom" | undefined); });
  ipcMain.handle("workspace:get-document", (event) => { assertTrustedSender(event); return workspaceDocument; });
  ipcMain.handle("workspace:save-document", (event, input: unknown) => {
    assertTrustedSender(event);
    try { workspaceDocument = parseWorkspaceDocument(input); }
    catch (error) { throw new Error(error instanceof Error ? error.message : "Invalid workspace document."); }
    const panelGroup = workspaceDocument.tabGroups.find((group) => group.panelIds.includes("browser") && group.panelIds.includes("agent"));
    if (panelGroup) {
      workspaceDocument = {
        ...workspaceDocument,
        root: setPanelVisibility(setPanelVisibility(workspaceDocument.root, "browser", workspaceDocument.activePanelId === "browser"), "agent", workspaceDocument.activePanelId === "agent"),
      };
    }
    const agentPanel = findPanel(workspaceDocument.root, "agent");
    workspaceLayout = { ...workspaceLayout, agentPanelVisible: Boolean(agentPanel && agentPanel.visible !== false) };
    writeJsonAtomic(WORKSPACE_LAYOUT_PATH, workspaceLayout);
    writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
    publishWorkspaceLayout();
    updateActiveBounds();
    return workspaceDocument;
  });
  ipcMain.handle("workspace:save-layout", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ version: z.literal(1), agentPanelWidth: z.number().finite().min(280).max(720), agentPanelVisible: z.boolean(), agentPanelPosition: z.enum(["left", "right", "top", "bottom"]).default("right") }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid workspace layout.");
    workspaceLayout = parseWorkspaceLayout(parsed.data);
    writeJsonAtomic(WORKSPACE_LAYOUT_PATH, workspaceLayout);
    let root = setPanelVisibility(workspaceDocument.root, "agent", workspaceLayout.agentPanelVisible);
    if (root.type === "split" && root.first.type === "panel" && root.second.type === "panel" && new Set([root.first.id, root.second.id]).size === 2 && [root.first.id, root.second.id].includes("browser") && [root.first.id, root.second.id].includes("agent")) {
      const isHorizontal = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "right";
      const [windowWidth, windowHeight] = mainWindow?.getContentSize() ?? [1200, 800];
      const available = Math.max(1, (isHorizontal ? (contentWidth ?? windowWidth) : windowHeight) - (workspaceLayout.agentPanelVisible ? 6 : 0));
      const agentFirst = workspaceLayout.agentPanelPosition === "left" || workspaceLayout.agentPanelPosition === "top";
      const agentSize = workspaceLayout.agentPanelVisible ? workspaceLayout.agentPanelWidth : 0;
      const browserSize = Math.max(0, available - agentSize);
      const browserNode = root.first.id === "browser" ? root.first : root.second;
      const agentNode = root.first.id === "agent" ? root.first : root.second;
      root.axis = isHorizontal ? "horizontal" : "vertical";
      root.ratio = workspaceLayout.agentPanelVisible ? Math.max(0.05, Math.min(0.95, (agentFirst ? agentSize : browserSize) / available)) : 0.5;
      root.first = agentFirst ? { ...agentNode, visible: workspaceLayout.agentPanelVisible } : browserNode;
      root.second = agentFirst ? browserNode : { ...agentNode, visible: workspaceLayout.agentPanelVisible };
    }
    workspaceDocument = { ...workspaceDocument, root };
    writeJsonAtomic(WORKSPACE_DOCUMENT_PATH, workspaceDocument);
    return { ...workspaceLayout };
  });
  ipcMain.handle("plugin:list", (event) => {
    assertTrustedSender(event);
    return listPlugins(PLUGIN_ROOT, PLUGIN_REGISTRY_PATH);
  });
  ipcMain.handle("plugin:import", async (event) => {
    assertTrustedSender(event);
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "导入插件目录",
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths[0]) return null;
    const plugin = importPlugin(filePaths[0], PLUGIN_ROOT, PLUGIN_REGISTRY_PATH);
    recordOperation("plugin", "import " + plugin.id);
    return plugin;
  });
  ipcMain.handle("plugin:set-enabled", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ id: z.string().min(3).max(100), enabled: z.boolean() }).safeParse(input);
    if (!parsed.success) throw new Error("无效的插件状态请求。");
    const plugins = setPluginEnabled(parsed.data.id, parsed.data.enabled, PLUGIN_ROOT, PLUGIN_REGISTRY_PATH);
    recordOperation("plugin", (parsed.data.enabled ? "enable " : "disable ") + parsed.data.id);
    return plugins;
  });
  ipcMain.handle("plugin:remove", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(3).max(100).safeParse(input);
    if (!parsed.success) throw new Error("无效的插件 ID。");
    const plugins = removePlugin(parsed.data, PLUGIN_ROOT, PLUGIN_REGISTRY_PATH);
    recordOperation("plugin", "remove " + parsed.data);
    return plugins;
  });
  ipcMain.handle("plugin:export", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(3).max(100).safeParse(input);
    if (!parsed.success) throw new Error("无效的插件 ID。");
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "选择插件导出目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths[0]) return null;
    const destination = exportPlugin(parsed.data, PLUGIN_ROOT, filePaths[0], PLUGIN_REGISTRY_PATH);
    recordOperation("plugin", "export " + parsed.data);
    return destination;
  });
  ipcMain.handle("agent-mcp:list", (event) => {
    assertTrustedSender(event);
    return listMcpServers(MCP_CONFIG_PATH);
  });
  ipcMain.handle("agent-mcp:save", async (event, input: unknown) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    await copilotAgent.resetConversation();
    const servers = saveMcpServer(input, MCP_CONFIG_PATH);
    const server = (input as Partial<McpServerConfig> | null)?.id;
    recordOperation("agent-mcp", "save " + String(server ?? "server"));
    return servers;
  });
  ipcMain.handle("agent-mcp:set-enabled", async (event, input: unknown) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const parsed = z.object({ id: z.string().min(2).max(64), enabled: z.boolean() }).safeParse(input);
    if (!parsed.success) throw new Error("无效的 MCP Server 状态请求。");
    await copilotAgent.resetConversation();
    const servers = setMcpServerEnabled(parsed.data.id, parsed.data.enabled, MCP_CONFIG_PATH);
    recordOperation("agent-mcp", (parsed.data.enabled ? "enable " : "disable ") + parsed.data.id);
    return servers;
  });
  ipcMain.handle("agent-mcp:remove", async (event, input: unknown) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const parsed = z.string().min(2).max(64).safeParse(input);
    if (!parsed.success) throw new Error("无效的 MCP Server ID。");
    await copilotAgent.resetConversation();
    const servers = removeMcpServer(parsed.data, MCP_CONFIG_PATH);
    recordOperation("agent-mcp", "remove " + parsed.data);
    return servers;
  });
  ipcMain.handle("agent-skill:list", (event) => {
    assertTrustedSender(event);
    return listAgentSkills(AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
  });
  ipcMain.handle("agent-skill:import", async (event) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "导入 Agent Skill 目录（包含 SKILL.md）",
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths[0]) return null;
    await copilotAgent.resetConversation();
    const skill = importAgentSkill(filePaths[0], AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
    recordOperation("agent-skill", "import " + skill.id);
    return skill;
  });
  ipcMain.handle("agent-skill:import-zip", async (event) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "上传 Agent Skill ZIP（Claude Desktop 格式）",
      properties: ["openFile"],
      filters: [{ name: "Agent Skill ZIP", extensions: ["zip"] }],
    });
    if (canceled || !filePaths[0]) return null;
    await copilotAgent.resetConversation();
    const skill = importAgentSkillArchive(filePaths[0], AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
    recordOperation("agent-skill", "import ZIP " + skill.id);
    return skill;
  });
  ipcMain.handle("agent-skill:install-sample", async (event) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    await copilotAgent.resetConversation();
    const existing = listAgentSkills(AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH).find(item => item.id === "web-research");
    if (existing) {
      const skills = setAgentSkillEnabled(existing.id, true, AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
      return skills.find(item => item.id === existing.id) ?? existing;
    }
    const samplePath = path.join(app.getAppPath(), "examples", "skills", "web-research");
    const skill = importAgentSkill(samplePath, AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
    recordOperation("agent-skill", "install sample " + skill.id);
    return skill;
  });
  ipcMain.handle("agent-skill:set-enabled", async (event, input: unknown) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const parsed = z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }).safeParse(input);
    if (!parsed.success) throw new Error("无效的 Agent Skill 状态请求。");
    await copilotAgent.resetConversation();
    const skills = setAgentSkillEnabled(parsed.data.id, parsed.data.enabled, AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
    recordOperation("agent-skill", (parsed.data.enabled ? "enable " : "disable ") + parsed.data.id);
    return skills;
  });
  ipcMain.handle("agent-skill:remove", async (event, input: unknown) => {
    assertTrustedSender(event);
    assertAgentExtensionsIdle();
    const parsed = z.string().min(1).max(64).safeParse(input);
    if (!parsed.success) throw new Error("无效的 Agent Skill ID。");
    await copilotAgent.resetConversation();
    const skills = removeAgentSkill(parsed.data, AGENT_SKILL_ROOT, AGENT_SKILL_REGISTRY_PATH);
    recordOperation("agent-skill", "remove " + parsed.data);
    return skills;
  });
  ipcMain.handle("agent:open-settings", (event) => { assertTrustedSender(event); openAgentSettingsWindow(); });
  ipcMain.handle("agent:open-session-explorer", (event) => { assertTrustedSender(event); openSessionExplorerWindow(); });
  ipcMain.handle("agent:pick-files", async (event) => {
    assertTrustedSender(event);
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "选择 Agent 附件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "可分析文件", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "xlsm", "csv", "tsv", "json", "txt", "md", "log"] }],
    });
    if (canceled) return [];
    const taskId = activeAgentTaskId;
    if (!taskId) throw new Error("当前没有活动 Task。");
    const selected = [...new Set(filePaths.slice(0, 20).map(file => realpathSync(file)))].slice(0, 20);
    const prior = [...(approvedAgentFiles.get(taskId) ?? new Set<string>())].filter(file => !selected.includes(file));
    const approved = new Set([...prior, ...selected].slice(-20));
    approvedAgentFiles.set(taskId, approved);
    copilotAgent.setApprovedFiles([...approved]);
    return selected.map(file => file.slice(0, 1000));
  });
  ipcMain.handle("agent-data:get-directory", (event) => { assertTrustedSender(event); return agentTraceStore.getDirectory(); });
  ipcMain.handle("agent-trace:list-sessions", (event) => {
    assertTrustedSender(event);
    return agentTraceStore.listSessions().map(session => {
      const sessionId = String(session.id ?? "");
      const task = agentTasks.find(item => item.sessionId === sessionId);
      const expert = task?.expertId ? agentExperts.find(item => item.id === task.expertId) : undefined;
      return {
        ...session,
        ...(task ? { taskId: task.id, taskTitle: task.title } : {}),
        ...(expert ? { expertName: expert.name } : {}),
      };
    });
  });
  ipcMain.handle("agent-trace:list-session-items", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().min(1).max(100).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Agent session id.");
    return parseAgentSessionItems(agentTraceStore.listSessionItems(parsed.data));
  });
  ipcMain.handle("agent-trace:query", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ sessionId: z.string().max(100).optional(), traceId: z.string().max(100).optional(), type: z.string().max(160).optional(), limit: z.number().int().min(1).max(1000).optional() }).safeParse(input ?? {});
    if (!parsed.success) throw new Error("Invalid Agent trace query.");
    return agentTraceStore.query(parsed.data);
  });
  ipcMain.handle("agent-data:select-directory", async (event) => {
    assertTrustedSender(event);
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行，请等待当前请求结束后再切换 Agent Data 目录。");
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: "选择 Agent Data 目录", properties: ["openDirectory", "createDirectory"] });
    if (canceled || !filePaths[0]) return agentTraceStore.getDirectory();
    const directory = path.resolve(filePaths[0]);
    agentTraceStore.setDirectory(directory);
    writeJsonAtomic(AGENT_DATA_SETTINGS_PATH, { directory });
    recordAgentTrace("agent-data.directory-changed", { directory }, "completed");
    return directory;
  });
  ipcMain.handle("browser:toggle-snapshot", async (event) => { assertTrustedSender(event); return await toggleSnapshot(); });
  ipcMain.handle("app:open-external", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.string().url().max(2048).safeParse(input);
    if (!parsed.success) throw new Error("Invalid URL.");
    const protocol = new URL(parsed.data).protocol;
    if (!["http:", "https:", "mailto:"].includes(protocol)) throw new Error("Unsupported URL scheme.");
    await shell.openExternal(parsed.data);
  });
  ipcMain.handle("browser:get-state", (event) => {
    assertTrustedSender(event);
    return currentState();
  });

  ipcMain.handle("browser:create-tab", (event, url?: string) => {
    assertTrustedSender(event);
    return createTab(typeof url === "string" ? url : HOME_URL);
  });

  ipcMain.handle("browser:activate-tab", (event, id: string) => {
    assertTrustedSender(event);
    activateTab(id);
  });

  ipcMain.handle("browser:close-tab", (event, id: string) => {
    assertTrustedSender(event);
    closeTab(id);
  });

  ipcMain.handle("browser:navigate", (event, id: string, url: string) => {
    assertTrustedSender(event);
    const tab = tabs.get(id);
    if (!tab || typeof url !== "string") return;
    const target = resolveAddress(url);
    tab.url = target;
    tab.title = "Loading…";
    tab.isLoading = true;
    sendState();
    void tab.view.webContents.loadURL(target).catch((error: unknown) => {
      tab.isLoading = false;
      sendState();
      console.error("Navigation failed", target, error);
    });
  });

  ipcMain.handle("browser:go-back", (event, id: string) => {
    assertTrustedSender(event);
    const webContents = tabs.get(id)?.view.webContents;
    if (webContents?.navigationHistory.canGoBack()) webContents.navigationHistory.goBack();
  });

  ipcMain.handle("browser:go-forward", (event, id: string) => {
    assertTrustedSender(event);
    const webContents = tabs.get(id)?.view.webContents;
    if (webContents?.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
  });

  ipcMain.handle("browser:reload", (event, id: string) => {
    assertTrustedSender(event);
    tabs.get(id)?.view.webContents.reload();
  });

  ipcMain.handle("browser:stop", (event, id: string) => {
    assertTrustedSender(event);
    tabs.get(id)?.view.webContents.stop();
  });

  ipcMain.handle("browser:find-in-page", (event, id: string, text: string) => {
    assertTrustedSender(event);
    if (typeof text === "string" && text.length > 0) {
      tabs.get(id)?.view.webContents.findInPage(text);
    }
  });

  ipcMain.handle("browser:stop-find-in-page", (event, id: string) => {
    assertTrustedSender(event);
    tabs.get(id)?.view.webContents.stopFindInPage("clearSelection");
  });

  ipcMain.on("browser:set-content-bounds", (event, bounds: unknown) => {
    if (!isTrustedAppSender(event.sender) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedAppUrl(event.senderFrame.url, path.join(__dirname, "../renderer/index.html"), process.env.VITE_DEV_SERVER_URL)) return;
    const parsed = z.object({ top: z.number().finite().min(0).max(300), left: z.number().finite().min(0).max(10000), width: z.number().finite().min(0).max(10000) }).safeParse(bounds);
    if (!parsed.success) return;
    contentTop = Math.round(parsed.data.top);
    contentLeft = Math.round(parsed.data.left);
    contentWidth = Math.round(parsed.data.width);
    updateActiveBounds();
  });

  ipcMain.handle("copilot:status", async (event) => {
    assertTrustedSender(event);
    return await copilotAgent.status();
  });
  ipcMain.handle("agent:inspect-models", async (event, provider: unknown) => {
    assertTrustedSender(event);
    if (provider !== "copilot" && provider !== "codebuddy") throw new Error("Unsupported Agent provider.");
    return await copilotAgent.inspectModels(provider as AgentProvider);
  });
  ipcMain.handle("agent:get-settings", (event) => {
    assertTrustedSender(event);
    return copilotAgent.getSettings();
  });
  ipcMain.handle("agent:save-settings", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) throw new Error("Agent 正在运行或切换 Task，请稍后修改 Agent 配置。");
    const parsed = z.object({
      provider: z.enum(["copilot", "codebuddy"]),
      copilotModel: z.string().max(200),
      codebuddyModel: z.string().max(200),
      thinkingLevel: z.enum(["low", "medium", "high", "xhigh"]),
      toolPermission: z.enum(["none", "browser-only", "assisted", "allow-all"]),
      contextWindow: z.number().int().positive().optional(),
      systemPrompt: z.string().max(12000),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Agent settings.");
    await copilotAgent.configure(parsed.data);
    agentSettings = parsed.data;
    writeJsonAtomic(SETTINGS_PATH, { ...agentSettings, toolPermissionModelVersion: 2 });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:settings-updated", agentSettings);
    if (agentPanelWindow && !agentPanelWindow.isDestroyed()) agentPanelWindow.webContents.send("agent:settings-updated", agentSettings);
    return copilotAgent.getSettings();
  });
  ipcMain.handle("copilot:send", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后提交新的 Agent 请求。");
    const parsed = z.object({
      prompt: z.string().trim().min(1).max(30000),
      taskId: z.string().min(1).max(100).optional(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) })).max(20).optional(),
      attachments: z.array(z.string().min(1).max(1000)).max(20).optional(),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Message must contain 1–30,000 characters.");
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
      throw new Error("Agent 正在处理其他请求或切换 Task，请稍后重试。");
    }
    agentRequestPending = true;
    try {
    const task = taskForId(parsed.data.taskId);
    if (activeAgentTaskId !== task.id) await activateAgentTask(task.id);
    const allowedAttachments = approvedAgentFiles.get(task.id) ?? new Set<string>();
    const attachments = parsed.data.attachments ?? [];
    if (attachments.some(file => !allowedAttachments.has(file))) throw new Error("附件列表包含未经系统文件选择器授权的文件，请重新选择。");
    copilotAgent.setApprovedFiles([...allowedAttachments]);
    if (task.title === "New task" || task.title.endsWith(" · New task")) {
      const cleanTitle = parsed.data.prompt.replace(/\s+/g, " ").trim();
      task.title = cleanTitle.slice(0, 64) + (cleanTitle.length > 64 ? "…" : "");
    }
    const traceId = randomUUID();
    activeAgentTraceId = traceId;
    copilotAgent.setMemoryContext(task.sessionId, traceId);
    task.lastRunAt = Date.now();
    task.updatedAt = Date.now();
    persistAgentTasks();
    publishAgentWorkspaceSnapshot();
    recordAgentTrace("turn.started", { prompt: parsed.data.prompt, history: parsed.data.history ?? [], settings: agentSettings, workspacePath: workspaceProject.path, taskId: task.id }, "running");
    try {
      await copilotAgent.send(parsed.data.prompt, parsed.data.history as AgentChatMessage[] | undefined, attachments);
      recordAgentTrace("turn.completed", { outcome: "completed" }, "completed");
    } catch (error) {
      recordAgentTrace("turn.failed", { error: error instanceof Error ? error.message : String(error) }, "failed");
      throw error;
    } finally {
      task.updatedAt = Date.now();
      persistAgentTasks();
      activeAgentTraceId = null;
      publishAgentWorkspaceSnapshot();
    }
    } finally {
      agentRequestPending = false;
    }
  });
  ipcMain.handle("copilot:cancel", async (event) => {
    assertTrustedSender(event);
    recordAgentTrace("turn.cancel.requested", { workspacePath: workspaceProject.path }, "requested");
    return copilotAgent.cancel();
  });
  ipcMain.handle("agent:a2ui-register-surfaces", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      surfaceIds: z.array(z.string().min(1).max(120)).max(100),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid A2UI Surface registration.");
    const task = taskForId(parsed.data.taskId);
    await copilotAgent.registerA2UISurfaces(task.sessionId, parsed.data.surfaceIds);
  });
  ipcMain.handle("agent:a2ui-message", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive) throw new Error("本地 Schedule 正在执行，请稍后提交新的 Agent 请求。");
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      message: z.unknown(),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid A2UI renderer message.");
    if (Buffer.byteLength(JSON.stringify(parsed.data.message), "utf8") > 32 * 1024) {
      throw new Error("A2UI renderer message exceeds the 32 KiB limit.");
    }
    if (agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
      throw new Error("Agent 正在处理其他请求或切换 Task，请稍后重试。");
    }
    agentRequestPending = true;
    try {
      const task = taskForId(parsed.data.taskId);
      if (activeAgentTaskId !== task.id) await activateAgentTask(task.id);
      const previousTranscript = loadAgentSession(task.id);
      const actionContent = JSON.stringify(parsed.data.message);
      const interactionItem = {
        id: randomUUID(),
        kind: "interaction" as const,
        content: actionContent,
        createdAt: Date.now(),
      };
      // Keep renderer actions in the authoritative SQLite transcript. The renderer
      // receives the same ID so its debounced full-session save cannot erase it.
      saveAgentSession([...previousTranscript, interactionItem], task.id);
      copilotAgent.publishInteraction(interactionItem.id, interactionItem.content, interactionItem.createdAt);
      const history = previousTranscript
        .filter(item => (item.kind === "user" || item.kind === "assistant") && item.content.trim())
        .slice(-20)
        .map(item => ({ role: item.kind as "user" | "assistant", content: item.content.slice(0, 12_000) }));
      const traceId = randomUUID();
      activeAgentTraceId = traceId;
      copilotAgent.setMemoryContext(task.sessionId, traceId);
      recordTaskTrace(task, "a2ui.renderer.action", { message: parsed.data.message });
      await copilotAgent.handleA2UIRendererMessage(parsed.data.message, history);
      task.updatedAt = Date.now();
      persistAgentTasks();
      publishAgentWorkspaceSnapshot();
    } finally {
      activeAgentTraceId = null;
      agentRequestPending = false;
    }
  });

  const parseMemoryTaskInput = (input: unknown, withRun = false) => z.object({
    taskId: z.string().min(1).max(100),
    ...(withRun ? { runId: z.string().min(1).max(100) } : {}),
  }).safeParse(input);
  ipcMain.handle("agent:memory-set-pinned", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (copilotAgent.isBusy()) throw new Error("Agent 正在运行，请等当前任务完成后再修改 Memory。");
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      noteId: z.string().min(1).max(100),
      pinned: z.boolean(),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Memory pin request.");
    const task = taskForId(parsed.data.taskId);
    const note = copilotAgent.setMemoryPinned(task.workspacePath, parsed.data.noteId, parsed.data.pinned);
    recordTaskTrace(task, "memory.note.pinned", { noteId: parsed.data.noteId, pinned: parsed.data.pinned, version: note.version });
    return note;
  });
  ipcMain.handle("agent:memory-archive-note", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (copilotAgent.isBusy()) throw new Error("Agent 正在运行，请等当前任务完成后再归档 Memory。");
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      noteId: z.string().min(1).max(100),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Memory archive request.");
    const task = taskForId(parsed.data.taskId);
    copilotAgent.archiveMemoryNote(task.workspacePath, parsed.data.noteId);
    recordTaskTrace(task, "memory.note.archived", { noteId: parsed.data.noteId });
  });
  ipcMain.handle("agent:memory-get-snapshot", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = parseMemoryTaskInput(input);
    if (!parsed.success) throw new Error("Invalid Memory snapshot request.");
    const task = taskForId(parsed.data.taskId);
    return {
      taskId: task.id,
      workspacePath: task.workspacePath,
      ...copilotAgent.getMemorySnapshot(task.workspacePath),
    };
  });
  ipcMain.handle("agent:memory-get-run", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = parseMemoryTaskInput(input, true);
    if (!parsed.success) throw new Error("Invalid Memory Dreaming request.");
    const task = taskForId(parsed.data.taskId);
    return copilotAgent.getMemoryDreamRunDetail(task.workspacePath, String(parsed.data.runId));
  });
  ipcMain.handle("agent:memory-abandon", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (copilotAgent.isBusy()) throw new Error("Agent 正在运行，请等待当前任务结束后再放弃 Dreaming。");
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      runId: z.string().min(1).max(100),
      reason: z.string().min(1).max(1000),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Memory abandon request.");
    const task = taskForId(parsed.data.taskId);
    copilotAgent.abandonMemoryDreaming(task.workspacePath, parsed.data.runId, parsed.data.reason);
    recordTaskTrace(task, "memory.dreaming.abandoned", { runId: parsed.data.runId, reason: parsed.data.reason });
  });
  ipcMain.handle("agent:memory-rollback", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (copilotAgent.isBusy()) throw new Error("Agent 正在运行，请等待当前任务结束后再回滚 Memory。");
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      runId: z.string().min(1).max(100),
      reason: z.string().min(1).max(500),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Memory rollback request.");
    const task = taskForId(parsed.data.taskId);
    const result = copilotAgent.rollbackMemoryDreaming(task.workspacePath, parsed.data.runId, parsed.data.reason);
    recordTaskTrace(task, "memory.dreaming.rolled_back", { ...result, reason: parsed.data.reason });
    return result;
  });

  ipcMain.handle("agent:memory-save-dream-schedule", (event, input: unknown) => {
    assertTrustedSender(event);
    if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
      throw new Error("Agent 正在运行，请在当前任务结束后修改 Dreaming 自动整理设置。");
    }
    const parsed = z.object({
      taskId: z.string().min(1).max(100),
      enabled: z.boolean(),
      intervalMinutes: z.number().int().min(60).max(10080),
    }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Memory Dreaming schedule.");
    const task = taskForId(parsed.data.taskId);
    const result = copilotAgent.saveMemoryDreamSchedule(task.workspacePath, {
      enabled: parsed.data.enabled,
      intervalMinutes: parsed.data.intervalMinutes,
    });
    recordTaskTrace(task, "memory.dreaming.schedule.updated", result);
    return result;
  });

  ipcMain.handle("agent:load-session", (event, input?: unknown) => {
    assertTrustedSender(event);
    const taskId = input === undefined ? activeAgentTaskId : z.string().min(1).max(100).parse(input);
    const items = loadAgentSession(taskId);
    const task = taskForId(taskId);
    recordTaskTrace(task, "session.loaded", { itemCount: items.length, storage: "sqlite-session-messages" });
    return items;
  });
  ipcMain.handle("agent:save-session", (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ items: z.array(z.unknown()).max(2000), taskId: z.string().min(1).max(100).optional() }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid Agent session: at most 2,000 messages are allowed.");
    const serialized = JSON.stringify(parsed.data.items);
    if (Buffer.byteLength(serialized, "utf8") > 5 * 1024 * 1024) throw new Error("Agent session exceeds the 5 MiB limit.");
    const targetTaskId = parsed.data.taskId ?? activeAgentTaskId;
    if (targetTaskId !== activeAgentTaskId) throw new Error("Cannot save a transcript for a Task that is no longer active.");
    if (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy()) {
      // Renderer autosave is debounced and can land while a turn or Task switch is in flight.
      // Skipping is safe: the transcript is resaved on "done"/"error" or after the switch.
      recordOperation("session", "save skipped while agent busy: " + targetTaskId);
      return;
    }
    const items = parseAgentSessionItems(parsed.data.items);
    saveAgentSession(items, targetTaskId);
    const task = taskForId(targetTaskId);
    recordAgentTrace("session.saved", { itemCount: items.length, storage: "sqlite-session-messages", taskId: task.id }, "completed");
  });
  ipcMain.handle("agent:clear-session", (event, input?: unknown) => {
    assertTrustedSender(event);
    const taskId = input === undefined ? activeAgentTaskId : z.string().min(1).max(100).parse(input);
    const task = taskForId(taskId);
    if (taskId === activeAgentTaskId && (scheduleRunnerActive || agentRequestPending || taskActivationPending || copilotAgent.isBusy())) throw new Error("Agent 正在运行，不能清理当前 Task 的会话。");
    const previousItemCount = loadAgentSession(taskId).length;
    agentTraceStore.clearSessionItems(task.sessionId);
    copilotAgent.resetA2UIForTask(task.sessionId);
    rmSync(currentAgentSessionPath(task.sessionId), { force: true });
    if (task.sessionId === initialSessionId && !task.workspacePath) rmSync(LEGACY_AGENT_SESSION_PATH, { force: true });
    recordTaskTrace(task, "session.cleared", { previousItemCount });
  });

  ipcMain.on("browser:set-content-top", (event, height: number) => {
    if (!isTrustedAppSender(event.sender) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedAppUrl(event.senderFrame.url, path.join(__dirname, "../renderer/index.html"), process.env.VITE_DEV_SERVER_URL)) return;
    if (!Number.isFinite(height)) return;
    contentTop = Math.max(0, Math.min(240, Math.round(height)));
    updateActiveBounds();
  });
}

app.setAppUserModelId(APP_ID);
installCrashHandlers();
recordOperation("app", `start ${app.getVersion()} ${process.platform}/${process.arch}`);
void primeLoginShellEnvironment();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!app.isReady()) return;
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    browserSession = session.fromPartition(BROWSER_PARTITION);
    // Explicitly use the OS proxy configuration for the embedded browser.
    await browserSession.setProxy({ mode: "system" });
    installPermissionHandlers();
    registerIpcHandlers();
    installApplicationMenu();
    createMainWindow();
    schedulerTimer = setInterval(() => { void processDueAgentSchedules(); }, 15_000);
    schedulerTimer.unref();
    void processDueAgentSchedules();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

let quitState: "idle" | "confirming" | "stopping" | "ready" = "idle";

async function confirmQuitWhileBusy(): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: "question",
    title: "Agent 仍在运行",
    message: "Agent 正在处理请求。",
    detail: "现在退出会停止当前请求并终止 Agent 进程。",
    buttons: ["取消", "停止并退出"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return response === 1;
}

/** Stop the agent, but never let a stuck SDK hold the application open. */
function stopAgentForQuit(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      recordOperation("app", "agent stop timed out after 5000ms");
      resolve();
    }, 5000);
    copilotAgent.stop().then(
      () => { clearTimeout(timer); resolve(); },
      (error: unknown) => {
        recordOperation("app", "agent stop failed: " + (error instanceof Error ? error.message : String(error)));
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

async function shutdown(): Promise<void> {
  if (quitState !== "idle") return;
  quitState = "confirming";

  if (copilotAgent.isBusy()) {
    let proceed = true;
    try { proceed = await confirmQuitWhileBusy(); }
    catch { /* a failed dialog must not trap the user in the app */ }
    if (!proceed) { quitState = "idle"; return; }
  }

  quitState = "stopping";
  isQuitting = true;
  saveWindowState();
  recordOperation("app", "quit");
  await stopAgentForQuit();

  quitState = "ready";
  app.quit();
}

app.on("before-quit", (event) => {
  // A second quit request during shutdown reuses the same flow.
  if (quitState === "ready") {
    isQuitting = true;
    saveWindowState();
    return;
  }
  event.preventDefault();
  void shutdown();
});

app.on("will-quit", () => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  agentTraceStore.close();
  disposeLoginShellEnvironment();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});