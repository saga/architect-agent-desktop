import { contextBridge, ipcRenderer } from "electron";
import type { BrowserApi, BrowserDownloadEvent, BrowserState } from "../shared/types";

const api: BrowserApi = {
  getState: () => ipcRenderer.invoke("browser:get-state"),
  createTab: (url) => ipcRenderer.invoke("browser:create-tab", url),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (id, url) => ipcRenderer.invoke("browser:navigate", id, url),
  goBack: (id) => ipcRenderer.invoke("browser:go-back", id),
  goForward: (id) => ipcRenderer.invoke("browser:go-forward", id),
  reload: (id) => ipcRenderer.invoke("browser:reload", id),
  stop: (id) => ipcRenderer.invoke("browser:stop", id),
  setContentTop: (height) => ipcRenderer.send("browser:set-content-top", height),
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