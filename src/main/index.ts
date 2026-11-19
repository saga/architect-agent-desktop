import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  desktopCapturer,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CopilotDesktopAgent } from "./copilot";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { AgentSettings, BrowserDownloadEvent, BrowserState, BrowserTabState } from "../shared/types";

const APP_ID = "com.saga.architectagentdesktop";
const HOME_URL = "https://www.google.com/";
const BROWSER_PARTITION = "persist:architect-agent-browser";
const DEFAULT_CONTENT_TOP = 91;
const ASKABLE_PERMISSIONS = new Set(["media", "display-capture", "geolocation", "notifications", "clipboard-read"]);

interface BrowserTab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
}

const tabs = new Map<string, BrowserTab>();
const tabOrder: string[] = [];
const permissionGrants = new Map<string, Set<string>>();

let mainWindow: BrowserWindow | null = null;
let browserSession: Session;
let activeTabId: string | null = null;
let attachedView: WebContentsView | null = null;
let contentTop = DEFAULT_CONTENT_TOP;
let contentLeft = 0;
let contentRight = 0;
const SETTINGS_PATH = path.join(app.getPath("userData"), "agent-settings.json");
const DEFAULT_SETTINGS: AgentSettings = { provider: "copilot", copilotModel: "", codebuddyModel: "", thinkingLevel: "medium", systemPrompt: "" };
function loadAgentSettings(): AgentSettings {
  try { const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<AgentSettings>; return { ...DEFAULT_SETTINGS, ...raw, provider: raw.provider === "codebuddy" ? "codebuddy" : "copilot", thinkingLevel: raw.thinkingLevel === "low" || raw.thinkingLevel === "high" ? raw.thinkingLevel : "medium", copilotModel: typeof raw.copilotModel === "string" ? raw.copilotModel.slice(0, 200) : "", codebuddyModel: typeof raw.codebuddyModel === "string" ? raw.codebuddyModel.slice(0, 200) : "", systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt.slice(0, 12000) : "" }; } catch { return { ...DEFAULT_SETTINGS }; }
}
let agentSettings = loadAgentSettings();
const copilotAgent = new CopilotDesktopAgent((payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("copilot:event", payload);
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
      const controls = [...document.querySelectorAll("button,input,textarea,select,[role=button]")].filter(visible).slice(0, 60).map((e,i) => ({ tag:e.tagName.toLowerCase(), type:e.type || "", text:clean(e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder")), name:e.getAttribute("name"), id:e.id, selector:e.id ? "#" + CSS.escape(e.id) : e.getAttribute("name") ? e.tagName.toLowerCase() + "[name=" + JSON.stringify(e.getAttribute("name")) + "]" : e.tagName.toLowerCase() + ":nth-of-type(" + (Array.from(e.parentElement?.children || []).filter(x => x.tagName === e.tagName).indexOf(e)+1) + ")" }));
      return JSON.stringify({ title:document.title, url:location.href, headings, text:bodyText, links, controls });
    })()`);
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
  async click(selector) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    return await tab.view.webContents.executeJavaScript(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      const r=el.getBoundingClientRect(); if (r.width<=0 || r.height<=0) throw new Error("Element is not visible.");
      const text=(el.innerText || el.getAttribute("aria-label") || "").trim();
      const type=(el.getAttribute("type") || "").toLowerCase();
      if (type==="submit" || el.tagName==="FORM" || (el.closest("form") && el.tagName==="BUTTON" && type!=="button") || /pay|purchase|buy now|add to cart|checkout|place order|delete|remove account|send message|transfer|confirm payment|unsubscribe|publish|post now/i.test(text)) throw new Error("Potentially consequential action blocked. Ask the user to perform it.");
      el.click(); return "Clicked " + (text || el.tagName) + ".";
    })()`);
  },
  async fill(selector, value) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    return await tab.view.webContents.executeJavaScript(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Field not found.");
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error("Only input and textarea fields can be filled.");
      if (el instanceof HTMLInputElement && ["password","hidden","submit","button","file"].includes(el.type)) throw new Error("This field type cannot be filled by the agent.");
      const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles:true })); el.dispatchEvent(new Event("change", { bubbles:true }));
      return "Filled field " + (el.getAttribute("aria-label") || el.name || el.id || el.tagName) + ". Form was not submitted.";
    })()`);
  },
  async scroll(direction, amount) {
    const tab=activeTabId ? tabs.get(activeTabId) : null; if (!tab) throw new Error("No active tab.");
    await tab.view.webContents.executeJavaScript("window.scrollBy({top:" + (direction==="down" ? amount : -amount) + ",behavior:'smooth'})");
    return "Scrolled " + direction + " by " + amount + " pixels.";
  },
});
let downloadSequence = 0;

function safeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.href === "about:blank";
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
  const top = Math.max(0, Math.min(contentTop, height));
  attachedView.setBounds({
    x: Math.max(0, Math.min(contentLeft, width)),
    y: top,
    width: Math.max(0, width - Math.max(0, Math.min(contentLeft, width)) - Math.max(0, Math.min(contentRight, width))),
    height: Math.max(0, height - top),
  });
}

function activateTab(id: string): void {
  const nextTab = tabs.get(id);
  if (!nextTab || !mainWindow || mainWindow.isDestroyed()) return;

  if (attachedView) {
    mainWindow.contentView.removeChildView(attachedView);
  }

  activeTabId = id;
  attachedView = nextTab.view;
  mainWindow.contentView.addChildView(nextTab.view);
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
    sendState();
  });

  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = url;
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

  webContents.on("render-process-gone", () => {
    tab.isLoading = false;
    tab.title = "This page crashed";
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

  const tab: BrowserTab = {
    id,
    view,
    title: "New tab",
    url: "about:blank",
    favicon: null,
    isLoading: false,
  };

  tabs.set(id, tab);
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

  if (attachedView === tab.view && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(tab.view);
    attachedView = null;
  }

  tabs.delete(id);
  tabOrder.splice(index, 1);
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
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => { void createTab(); } },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => { if (activeTabId) closeTab(activeTabId); } },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
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
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => {
          const tab = activeTabId ? tabs.get(activeTabId) : undefined;
          tab?.view.webContents.reload();
        } },
        { label: "Find in Page", accelerator: "CmdOrCtrl+F", click: () => mainWindow?.webContents.send("browser:find-requested") },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "About Architect Agent Desktop", click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            void dialog.showMessageBox(mainWindow, {
              title: "About Architect Agent Desktop",
              message: "Architect Agent Desktop",
              detail: "A cross-platform desktop workspace with a built-in browser.",
              buttons: ["OK"],
            });
          }
        } },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    title: "Architect Agent Desktop",
    backgroundColor: "#f5f6f8",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("resize", updateActiveBounds);
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
}

function isTrustedAppSender(webContents: WebContents): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents);
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrustedAppSender(event.sender)) {
    throw new Error("Untrusted IPC sender");
  }
}

function registerIpcHandlers(): void {
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
    if (!isTrustedAppSender(event.sender)) return;
    const parsed = z.object({ top: z.number().finite().min(0).max(300), left: z.number().finite().min(0).max(900), right: z.number().finite().min(0).max(900) }).safeParse(bounds);
    if (!parsed.success) return;
    contentTop = Math.round(parsed.data.top);
    contentLeft = Math.round(parsed.data.left);
    contentRight = Math.round(parsed.data.right);
    updateActiveBounds();
  });

  ipcMain.handle("copilot:status", async (event) => {
    assertTrustedSender(event);
    return await copilotAgent.status();
  });
  ipcMain.handle("agent:set-provider", async (event, provider: unknown) => {
    assertTrustedSender(event);
    if (provider !== "copilot" && provider !== "codebuddy") throw new Error("Unsupported Agent provider.");
    await copilotAgent.setProvider(provider as AgentProvider);
  });
  ipcMain.handle("copilot:send", async (event, input: unknown) => {
    assertTrustedSender(event);
    const parsed = z.object({ prompt: z.string().trim().min(1).max(30000) }).safeParse(input);
    if (!parsed.success) throw new Error("Message must contain 1–30,000 characters.");
    return copilotAgent.send(parsed.data.prompt);
  });
  ipcMain.handle("copilot:cancel", async (event) => {
    assertTrustedSender(event);
    return copilotAgent.cancel();
  });

  ipcMain.on("browser:set-content-top", (event, height: number) => {
    if (!isTrustedAppSender(event.sender)) return;
    if (!Number.isFinite(height)) return;
    contentTop = Math.max(0, Math.min(240, Math.round(height)));
    updateActiveBounds();
  });
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  browserSession = session.fromPartition(BROWSER_PARTITION);
  installPermissionHandlers();
  registerIpcHandlers();
  installApplicationMenu();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  void copilotAgent.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});