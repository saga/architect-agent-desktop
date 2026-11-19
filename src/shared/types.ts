export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

export interface BrowserDownloadEvent {
  id: number;
  fileName: string;
  status: "started" | "progress" | "completed" | "cancelled";
  receivedBytes: number;
  totalBytes: number;
  savePath?: string;
}

export type AgentProvider = "copilot" | "codebuddy";
export interface AgentModelInfo {
  provider: AgentProvider;
  id: string;
  name: string;
  description?: string;
  effortOptions?: string[];
  contextWindowOptions?: Array<{ value: number; label: string }>;
  maxInputTokens?: number;
  /** 产品目录里的 credits 费率，如 "x0.03 credits" → 0.03；0 表示免费。 */
  credits?: number;
}
export type AgentThinkingLevel = "low" | "medium" | "high" | "xhigh";
export type AgentToolPermission = "browser-only" | "assisted" | "allow-all";
export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface AgentSettings {
  provider: AgentProvider;
  copilotModel: string;
  codebuddyModel: string;
  thinkingLevel: AgentThinkingLevel;
  toolPermission: AgentToolPermission;
  contextWindow?: number;
  systemPrompt: string;
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "copilot",
  copilotModel: "",
  codebuddyModel: "",
  thinkingLevel: "medium",
  toolPermission: "browser-only",
  systemPrompt: "You are a helpful desktop browser agent. Use browser tools to inspect the current page before answering, explain what you did, and keep responses concise. The application safety rules take priority over this prompt.",
};

export interface CopilotEvent { type: "status" | "delta" | "message" | "error" | "done" | "tool"; status?: string; text?: string; toolName?: string; toolDetail?: string; toolState?: "done" | "error"; }

export interface AgentSessionItem {
  id: string;
  kind: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolState?: "done" | "error";
  createdAt: number;
}

export interface WorkspaceProject { path: string | null; name: string | null; }
export interface WorkspaceLayoutState { version: 1; agentPanelWidth: number; agentPanelVisible: boolean; agentPanelPosition: "left" | "right" | "top" | "bottom"; }
export interface WorkspaceDocument { version: 2; root: import("./workspace-document").WorkspaceDocument["root"]; tabGroups: import("./workspace-document").WorkspaceTabGroup[]; floating: import("./workspace-document").FloatingPanelRoot[]; activePanelId: string; }

export interface PluginSummary { manifestVersion: 1; id: string; name: string; version: string; description?: string; skills: string[]; tools: string[]; workflows: string[]; views: string[]; enabled: boolean; }

export interface AgentTraceQuery { sessionId?: string; traceId?: string; type?: string; limit?: number; }\n\nexport interface BrowserApi {
  getWorkspaceProject(): Promise<WorkspaceProject>;
  selectWorkspace(): Promise<WorkspaceProject | null>;
  clearWorkspace(): Promise<WorkspaceProject>;
  onWorkspaceProjectUpdated(listener: (workspace: WorkspaceProject) => void): () => void;
  getWorkspaceLayout(): Promise<WorkspaceLayoutState>;
  saveWorkspaceLayout(layout: WorkspaceLayoutState): Promise<WorkspaceLayoutState>;
  getWorkspaceDocument(): Promise<WorkspaceDocument>;
  saveWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument>;
  floatAgentPanel(): Promise<void>;
  redockAgentPanel(position?: "left" | "right" | "top" | "bottom"): Promise<void>;
  toggleSnapshot(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  onSnapshotState(listener: (active: boolean) => void): () => void;
  onWorkspaceLayoutUpdated(listener: (layout: WorkspaceLayoutState) => void): () => void;
  getState(): Promise<BrowserState>;
  createTab(url?: string): Promise<string>;
  activateTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  setContentBounds(bounds: { top: number; left: number; width: number }): void;
  onToggleAgent(listener: () => void): () => void;
  copilotStatus(): Promise<{ status: string; message?: string; provider: AgentProvider }>;
  openAgentSettings(): Promise<void>;
  agentDataGetDirectory(): Promise<string>;
  agentDataSelectDirectory(): Promise<string>;\n  agentTraceListSessions(): Promise<Array<Record<string, unknown>>>;\n  agentTraceQuery(query?: AgentTraceQuery): Promise<Array<Record<string, unknown>>>;
  pluginList(): Promise<PluginSummary[]>;
  pluginImport(): Promise<PluginSummary | null>;
  pluginSetEnabled(id: string, enabled: boolean): Promise<PluginSummary[]>;
  pluginRemove(id: string): Promise<PluginSummary[]>;
  pluginExport(id: string): Promise<string | null>;
  agentGetSettings(): Promise<AgentSettings>;
  agentInspectModels(provider: AgentProvider): Promise<AgentModelInfo[]>;
  onAgentSettingsUpdated(listener: (settings: AgentSettings) => void): () => void;
  agentSaveSettings(settings: AgentSettings): Promise<AgentSettings>;
  copilotSend(prompt: string, history?: AgentChatMessage[]): Promise<void>;
  copilotCancel(): Promise<void>;
  agentLoadSession(): Promise<AgentSessionItem[]>;
  agentSaveSession(items: AgentSessionItem[]): Promise<void>;
  agentClearSession(): Promise<void>;
  onCopilotEvent(listener: (event: CopilotEvent) => void): () => void;
  findInPage(id: string, text: string): Promise<void>;
  stopFindInPage(id: string): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
  onDownload(listener: (event: BrowserDownloadEvent) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
  onFindRequested(listener: () => void): () => void;
}