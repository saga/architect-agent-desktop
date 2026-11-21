import { contextBridge, ipcRenderer } from "electron";
import type { AgentModelInfo, AgentProvider, AgentSessionItem, AgentSettings, AgentTask, AgentExpert, AgentSchedule, AgentWorkspacePreferences, AgentWorkspaceSnapshot, BrowserApi, BrowserDownloadEvent, PluginSummary, McpServerConfig, AgentSkillSummary, BrowserState, CopilotEvent, WorkspaceDocument, WorkspaceLayoutState, WorkspaceProject } from "../shared/types";

const api: BrowserApi = {
  getWorkspaceProject: () => ipcRenderer.invoke("workspace:get-project"),
  selectWorkspace: () => ipcRenderer.invoke("workspace:select-project"),
  clearWorkspace: () => ipcRenderer.invoke("workspace:clear-project"),
  getAgentWorkspaceSnapshot: (): Promise<AgentWorkspaceSnapshot> => ipcRenderer.invoke("agent-workspace:get-snapshot"),
  onAgentWorkspaceUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AgentWorkspaceSnapshot) => listener(snapshot);
    ipcRenderer.on("agent-workspace:updated", handler);
    return () => ipcRenderer.removeListener("agent-workspace:updated", handler);
  },
  createAgentTask: (input) => ipcRenderer.invoke("agent-task:create", input),
  activateAgentTask: (taskId: string): Promise<AgentTask> => ipcRenderer.invoke("agent-task:activate", taskId),
  setAgentTaskExpert: (taskId: string, expertId: string | null): Promise<AgentTask> => ipcRenderer.invoke("agent-task:set-expert", { taskId, expertId }),
  agentAddWorkspace: (): Promise<AgentTask | null> => ipcRenderer.invoke("agent-workspace:add"),
  saveAgentExpert: (expert): Promise<AgentExpert[]> => ipcRenderer.invoke("agent-expert:save", expert),
  deleteAgentExpert: (id: string): Promise<AgentExpert[]> => ipcRenderer.invoke("agent-expert:delete", id),
  saveAgentSchedule: (schedule): Promise<AgentSchedule[]> => ipcRenderer.invoke("agent-schedule:save", schedule),
  deleteAgentSchedule: (id: string): Promise<AgentSchedule[]> => ipcRenderer.invoke("agent-schedule:delete", id),
  saveAgentWorkspacePreferences: (preferences: AgentWorkspacePreferences): Promise<AgentWorkspacePreferences> => ipcRenderer.invoke("agent-workspace:save-preferences", preferences),
  onWorkspaceProjectUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, workspace: WorkspaceProject) => listener(workspace);
    ipcRenderer.on("workspace:project-updated", handler);
    return () => ipcRenderer.removeListener("workspace:project-updated", handler);
  },
  getWorkspaceLayout: () => ipcRenderer.invoke("workspace:get-layout"),
  saveWorkspaceLayout: (layout: WorkspaceLayoutState) => ipcRenderer.invoke("workspace:save-layout", layout),
  getWorkspaceDocument: () => ipcRenderer.invoke("workspace:get-document"),
  saveWorkspaceDocument: (document: WorkspaceDocument) => ipcRenderer.invoke("workspace:save-document", document),
  floatAgentPanel: () => ipcRenderer.invoke("workspace:float-agent"),
  redockAgentPanel: (position) => ipcRenderer.invoke("workspace:redock-agent", position),
  toggleSnapshot: () => ipcRenderer.invoke("browser:toggle-snapshot"),
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  onSnapshotState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, active: boolean) => listener(active);
    ipcRenderer.on("browser:snapshot-state", handler);
    return () => ipcRenderer.removeListener("browser:snapshot-state", handler);
  },
  onWorkspaceLayoutUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, layout: WorkspaceLayoutState) => listener(layout);
    ipcRenderer.on("workspace:layout-updated", handler);
    return () => ipcRenderer.removeListener("workspace:layout-updated", handler);
  },
  getState: () => ipcRenderer.invoke("browser:get-state"),
  createTab: (url) => ipcRenderer.invoke("browser:create-tab", url),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (id, url) => ipcRenderer.invoke("browser:navigate", id, url),
  goBack: (id) => ipcRenderer.invoke("browser:go-back", id),
  goForward: (id) => ipcRenderer.invoke("browser:go-forward", id),
  reload: (id) => ipcRenderer.invoke("browser:reload", id),
  stop: (id) => ipcRenderer.invoke("browser:stop", id),
  setContentBounds: (bounds) => ipcRenderer.send("browser:set-content-bounds", bounds),
  onToggleAgent: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("agent:toggle-panel", handler);
    return () => ipcRenderer.removeListener("agent:toggle-panel", handler);
  },
  copilotStatus: () => ipcRenderer.invoke("copilot:status"),
  openAgentSettings: () => ipcRenderer.invoke("agent:open-settings"),
  agentDataGetDirectory: () => ipcRenderer.invoke("agent-data:get-directory"),
  agentDataSelectDirectory: () => ipcRenderer.invoke("agent-data:select-directory"),
  agentTraceListSessions: () => ipcRenderer.invoke("agent-trace:list-sessions"),
  agentTraceListSessionItems: (sessionId: string) => ipcRenderer.invoke("agent-trace:list-session-items", sessionId),
  agentTraceQuery: (query) => ipcRenderer.invoke("agent-trace:query", query),
  pluginList: (): Promise<PluginSummary[]> => ipcRenderer.invoke("plugin:list"),
  pluginImport: (): Promise<PluginSummary | null> => ipcRenderer.invoke("plugin:import"),
  pluginSetEnabled: (id: string, enabled: boolean): Promise<PluginSummary[]> => ipcRenderer.invoke("plugin:set-enabled", { id, enabled }),
  pluginRemove: (id: string): Promise<PluginSummary[]> => ipcRenderer.invoke("plugin:remove", id),
  pluginExport: (id: string): Promise<string | null> => ipcRenderer.invoke("plugin:export", id),
  agentMcpList: (): Promise<McpServerConfig[]> => ipcRenderer.invoke("agent-mcp:list"),
  agentMcpSave: (server: McpServerConfig): Promise<McpServerConfig[]> => ipcRenderer.invoke("agent-mcp:save", server),
  agentMcpSetEnabled: (id: string, enabled: boolean): Promise<McpServerConfig[]> => ipcRenderer.invoke("agent-mcp:set-enabled", { id, enabled }),
  agentMcpRemove: (id: string): Promise<McpServerConfig[]> => ipcRenderer.invoke("agent-mcp:remove", id),
  agentSkillList: (): Promise<AgentSkillSummary[]> => ipcRenderer.invoke("agent-skill:list"),
  agentSkillImport: (): Promise<AgentSkillSummary | null> => ipcRenderer.invoke("agent-skill:import"),
  agentSkillImportZip: (): Promise<AgentSkillSummary | null> => ipcRenderer.invoke("agent-skill:import-zip"),
  agentSkillInstallSample: (): Promise<AgentSkillSummary> => ipcRenderer.invoke("agent-skill:install-sample"),
  agentSkillSetEnabled: (id: string, enabled: boolean): Promise<AgentSkillSummary[]> => ipcRenderer.invoke("agent-skill:set-enabled", { id, enabled }),
  agentSkillRemove: (id: string): Promise<AgentSkillSummary[]> => ipcRenderer.invoke("agent-skill:remove", id),
  agentGetSettings: () => ipcRenderer.invoke("agent:get-settings"),
  agentInspectModels: (provider: AgentProvider): Promise<AgentModelInfo[]> => ipcRenderer.invoke("agent:inspect-models", provider),
  onAgentSettingsUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AgentSettings) => listener(settings);
    ipcRenderer.on("agent:settings-updated", handler);
    return () => ipcRenderer.removeListener("agent:settings-updated", handler);
  },
  agentSaveSettings: (settings: AgentSettings) => ipcRenderer.invoke("agent:save-settings", settings),
  agentPickFiles: () => ipcRenderer.invoke("agent:pick-files"),
  copilotSend: (prompt, history, taskId) => ipcRenderer.invoke("copilot:send", { prompt, history, taskId }),
  copilotCancel: () => ipcRenderer.invoke("copilot:cancel"),
  agentLoadSession: (taskId?: string) => ipcRenderer.invoke("agent:load-session", taskId),
  agentSaveSession: (items: AgentSessionItem[], taskId?: string) => ipcRenderer.invoke("agent:save-session", { items, taskId }),
  agentClearSession: (taskId?: string) => ipcRenderer.invoke("agent:clear-session", taskId),
  agentWorkspaceListFiles: (workspacePath: string): Promise<string[]> => ipcRenderer.invoke("agent-workspace:list-files", workspacePath),
  agentWorkspaceReadFile: (workspacePath: string, relativePath: string): Promise<string> => ipcRenderer.invoke("agent-workspace:read-file", { workspacePath, relativePath }),
  onCopilotEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CopilotEvent) => listener(payload);
    ipcRenderer.on("copilot:event", handler);
    return () => ipcRenderer.removeListener("copilot:event", handler);
  },
  findInPage: (id, text) => ipcRenderer.invoke("browser:find-in-page", id, text),
  stopFindInPage: (id) => ipcRenderer.invoke("browser:stop-find-in-page", id),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserState) => listener(state);
    ipcRenderer.on("browser:state", handler);
    return () => ipcRenderer.removeListener("browser:state", handler);
  },
  onDownload: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, download: BrowserDownloadEvent) => listener(download);
    ipcRenderer.on("browser:download", handler);
    return () => ipcRenderer.removeListener("browser:download", handler);
  },
  onFocusAddress: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("browser:focus-address", handler);
    return () => ipcRenderer.removeListener("browser:focus-address", handler);
  },
  onFindRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("browser:find-requested", handler);
    return () => ipcRenderer.removeListener("browser:find-requested", handler);
  },
};

contextBridge.exposeInMainWorld("browser", api);