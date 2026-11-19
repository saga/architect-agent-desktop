import { contextBridge, ipcRenderer } from "electron";
import type { AgentSettings, BrowserApi, BrowserDownloadEvent, BrowserState, CopilotEvent, WorkspaceLayoutState } from "../shared/types";

const api: BrowserApi = {
  getWorkspaceLayout: () => ipcRenderer.invoke("workspace:get-layout"),
  saveWorkspaceLayout: (layout: WorkspaceLayoutState) => ipcRenderer.invoke("workspace:save-layout", layout),
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
  agentGetSettings: () => ipcRenderer.invoke("agent:get-settings"),
  onAgentSettingsUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AgentSettings) => listener(settings);
    ipcRenderer.on("agent:settings-updated", handler);
    return () => ipcRenderer.removeListener("agent:settings-updated", handler);
  },
  agentSaveSettings: (settings: AgentSettings) => ipcRenderer.invoke("agent:save-settings", settings),
  copilotSend: (prompt) => ipcRenderer.invoke("copilot:send", { prompt }),
  copilotCancel: () => ipcRenderer.invoke("copilot:cancel"),
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