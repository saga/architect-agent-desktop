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
export type AgentToolPermission = "none" | "browser-only" | "assisted" | "allow-all";
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
  memoryEmbeddingProvider: "disabled" | "ollama";
  memoryEmbeddingBaseUrl: string;
  memoryEmbeddingModel: string;
  contextWindow?: number;
  systemPrompt: string;
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "copilot",
  copilotModel: "",
  codebuddyModel: "",
  thinkingLevel: "medium",
  toolPermission: "none",
  memoryEmbeddingProvider: "disabled",
  memoryEmbeddingBaseUrl: "http://127.0.0.1:11434",
  memoryEmbeddingModel: "nomic-embed-text",
  systemPrompt: "You are a helpful desktop browser agent. Use browser tools to inspect the current page before answering, explain what you did, and keep responses concise. The application safety rules take priority over this prompt.",
};

export interface CopilotEvent { type: "status" | "delta" | "thinking" | "message" | "error" | "done" | "tool" | "a2ui" | "a2ui-v1" | "interaction"; taskId?: string; status?: string; text?: string; streaming?: boolean; interactionId?: string; timestamp?: number; toolId?: string; toolName?: string; toolDetail?: string; toolState?: "running" | "done" | "error"; }

export interface AgentMemoryNoteView {
  id: string;
  title: string;
  content: string;
  tags: string[];
  validation: "unverified" | "validated" | "disputed";
  claimType: "user_preference" | "user_intent" | "decision" | "project_fact" | "workflow_pattern" | "external_fact" | "unknown";
  validationEvidence: { claimType: string; sourceCount: number; independentSessions: number; directUserSources: number; toolObservations: number; eligible: boolean; policy: string; reason: string } | null;
  externalVerification: { status: "single_domain_sources_recorded" | "multi_domain_sources_recorded"; sources: Array<{ sourceRef: string; url: string; domain: string; publisher: string; publishedAt: string | null }>; recordedAt: number; note: string } | null;
  confidence: number;
  pinned: boolean;
  importance: number;
  status: "active" | "archived" | "superseded";
  sourceRefs: string[];
  version: number;
  updatedAt: number;
  expiresAt: number | null;
  qualityScore: number | null;
  lastQualityReviewedAt: number | null;
}
export interface AgentMemoryDreamSchedule {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: "success" | "error" | "running" | null;
  lastError: string | null;
  consecutiveFailures: number;
  updatedAt: number;
}
export interface AgentMemorySnapshot {
  taskId: string;
  workspacePath: string | null;
  cursor: { createdAt: number; sessionId: string; messageId: string; transcriptRevision: number };
  dreamSchedule: AgentMemoryDreamSchedule;
  embeddingIndex: { enabled: boolean; provider: "disabled" | "ollama"; baseUrl: string; model: string; indexed: number; missing: number; total: number };
  notes: AgentMemoryNoteView[];
  relationships: Array<Record<string, unknown>>;
  knowledge: Array<Record<string, unknown>>;
  dreamRuns: Array<Record<string, unknown>>;
}
export interface AgentMemoryDreamRunDetail {
  run: {
    id: string;
    status: string;
    purpose: "transcript" | "quality_review";
    summary: string;
    sourceCount: number;
    createdAt: number;
    startedAt: number;
    completedAt: number | null;
    maxSourceCreatedAt: number;
    evidence: Array<{ sourceId: string; sessionId: string; messageId: string; kind: string; content: string; createdAt: number; contentHash: string; revision?: number }>;
  };
  operations: Array<Record<string, unknown>>;
}

export interface AgentSessionItem {
  id: string;
  kind: "user" | "assistant" | "thinking" | "tool" | "error" | "a2ui" | "a2ui-v1" | "interaction";
  content: string;
  toolName?: string;
  toolState?: "running" | "done" | "error";
  createdAt: number;
}

export type AgentWorkspaceMode = "sidepanel" | "pure";
export type AgentScheduleRepeat = "none" | "interval" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export type AgentScheduleRunStatus = "running" | "success" | "error";
export type AgentWorkspaceRightTab = "browser" | "files" | "results";
export interface AgentTask {
  id: string;
  sessionId: string;
  title: string;
  workspacePath: string | null;
  expertId: string | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
}
export interface AgentWorkspaceSummary extends WorkspaceProject {
  taskCount: number;
  updatedAt: number;
}
export interface AgentExpert {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolPermission: AgentToolPermission;
  /** Explicitly bypass the Expert tool allow-list; still constrained by global Agent permission. */
  allowAllTools: boolean;
  skills: string[];
  tools: string[];
  createdAt: number;
  updatedAt: number;
}
export interface AgentSchedule {
  id: string;
  title: string;
  prompt: string;
  workspacePath: string | null;
  expertId: string | null;
  runAt: string;
  repeat: AgentScheduleRepeat;
  intervalMinutes?: number;
  weekdays?: number[];
  monthDays?: number[];
  endsAt?: string | null;
  enabled: boolean;
  lastRunAt?: number;
  lastRunStatus?: "success" | "error";
  lastRunId?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
export interface AgentScheduleRun {
  id: string;
  scheduleId: string;
  scheduleTitle: string;
  trigger: "scheduled" | "manual";
  scheduledAt: string;
  taskId: string | null;
  previousTaskId?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: AgentScheduleRunStatus;
  resultPreview?: string;
  error?: string;
}
export interface AgentWorkspacePreferences {
  mode: AgentWorkspaceMode;
  leftWidth: number;
  rightWidth: number;
  rightPanelVisible: boolean;
  rightPanelTab: AgentWorkspaceRightTab;
}
export interface AgentWorkspaceSnapshot {
  tasks: AgentTask[];
  scheduleRunTasks: AgentTask[];
  activeTaskId: string;
  workspaces: AgentWorkspaceSummary[];
  experts: AgentExpert[];
  schedules: AgentSchedule[];
  scheduleRuns: AgentScheduleRun[];
  preferences: AgentWorkspacePreferences;
}

export interface WorkspaceProject { path: string | null; name: string | null; }
export interface WorkspaceLayoutState { version: 1; agentPanelWidth: number; agentPanelVisible: boolean; agentPanelPosition: "left" | "right" | "top" | "bottom"; }
export interface WorkspaceDocument { version: 2; root: import("./workspace-document").WorkspaceDocument["root"]; tabGroups: import("./workspace-document").WorkspaceTabGroup[]; floating: import("./workspace-document").FloatingPanelRoot[]; activePanelId: string; }

export interface PluginRuntimeCapabilities { hookEvents: string[]; mcpServers: string[]; lspServers: string[]; scriptFiles: number; mods: boolean; }
export interface PluginSummary {
  id: string; name: string; version: string; description?: string;
  skills: string[]; commands: string[]; agents: string[];
  inlineCommands: Array<{ name: string; content: string }>;
  enabled: boolean; runtimeApproved: boolean; runtime: PluginRuntimeCapabilities;
}

export type McpServerConfig =
  | { id: string; transport: "stdio"; enabled: boolean; description?: string; command: string; args: string[]; env: Record<string, string>; cwd?: string; timeout?: number }
  | { id: string; transport: "http"; enabled: boolean; description?: string; url: string; headers: Record<string, string>; timeout?: number };
export interface AgentSkillSummary { id: string; name: string; description: string; enabled: boolean; }

export interface AgentTraceQuery { sessionId?: string; traceId?: string; type?: string; limit?: number; }

export interface BrowserApi {
  getWorkspaceProject(): Promise<WorkspaceProject>;
  selectWorkspace(): Promise<WorkspaceProject | null>;
  clearWorkspace(): Promise<WorkspaceProject>;
  onWorkspaceProjectUpdated(listener: (workspace: WorkspaceProject) => void): () => void;
  getAgentWorkspaceSnapshot(): Promise<AgentWorkspaceSnapshot>;
  onAgentWorkspaceUpdated(listener: (snapshot: AgentWorkspaceSnapshot) => void): () => void;
  createAgentTask(input?: { title?: string; workspacePath?: string | null; expertId?: string | null }): Promise<AgentTask>;
  activateAgentTask(taskId: string): Promise<AgentTask>;
  setAgentTaskExpert(taskId: string, expertId: string | null): Promise<AgentTask>;
  agentAddWorkspace(): Promise<AgentTask | null>;
  saveAgentExpert(expert: Omit<AgentExpert, "createdAt" | "updatedAt"> & Partial<Pick<AgentExpert, "createdAt" | "updatedAt">>): Promise<AgentExpert[]>;
  deleteAgentExpert(id: string): Promise<AgentExpert[]>;
  saveAgentSchedule(schedule: Omit<AgentSchedule, "createdAt" | "updatedAt"> & Partial<Pick<AgentSchedule, "createdAt" | "updatedAt">>): Promise<AgentSchedule[]>;
  deleteAgentSchedule(id: string): Promise<AgentSchedule[]>;
  runAgentScheduleNow(id: string): Promise<void>;
  saveAgentWorkspacePreferences(preferences: AgentWorkspacePreferences): Promise<AgentWorkspacePreferences>;
  getWorkspaceLayout(): Promise<WorkspaceLayoutState>;
  saveWorkspaceLayout(layout: WorkspaceLayoutState): Promise<WorkspaceLayoutState>;
  getWorkspaceDocument(): Promise<WorkspaceDocument>;
  saveWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument>;
  floatAgentPanel(): Promise<void>;
  redockAgentPanel(position?: "left" | "right" | "top" | "bottom"): Promise<void>;
  toggleSnapshot(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  openInChrome(url: string): Promise<"chrome" | "default">;
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
  openSessionExplorer(): Promise<void>;
  agentDataGetDirectory(): Promise<string>;
  agentDataSelectDirectory(): Promise<string>;
  agentTraceListSessions(): Promise<Array<Record<string, unknown>>>;
  agentTraceListSessionItems(sessionId: string): Promise<AgentSessionItem[]>;
  agentTraceQuery(query?: AgentTraceQuery): Promise<Array<Record<string, unknown>>>;
  pluginList(): Promise<PluginSummary[]>;
  pluginImport(): Promise<PluginSummary | null>;
  pluginSetEnabled(id: string, enabled: boolean): Promise<PluginSummary[]>;
  pluginSetRuntimeApproved(id: string, approved: boolean): Promise<PluginSummary[]>;
  pluginRemove(id: string): Promise<PluginSummary[]>;
  pluginExport(id: string): Promise<string | null>;
  agentMcpList(): Promise<McpServerConfig[]>;
  agentMcpSave(server: McpServerConfig): Promise<McpServerConfig[]>;
  agentMcpSetEnabled(id: string, enabled: boolean): Promise<McpServerConfig[]>;
  agentMcpRemove(id: string): Promise<McpServerConfig[]>;
  agentSkillList(): Promise<AgentSkillSummary[]>;
  agentSkillImport(): Promise<AgentSkillSummary | null>;
  agentSkillImportZip(): Promise<AgentSkillSummary | null>;
  agentSkillInstallSample(): Promise<AgentSkillSummary>;
  agentSkillSetEnabled(id: string, enabled: boolean): Promise<AgentSkillSummary[]>;
  agentSkillRemove(id: string): Promise<AgentSkillSummary[]>;
  agentGetSettings(): Promise<AgentSettings>;
  agentInspectModels(provider: AgentProvider): Promise<AgentModelInfo[]>;
  onAgentSettingsUpdated(listener: (settings: AgentSettings) => void): () => void;
  agentSaveSettings(settings: AgentSettings): Promise<AgentSettings>;
  agentPickFiles(): Promise<string[]>;
  copilotSend(prompt: string, history?: AgentChatMessage[], taskId?: string, attachments?: string[]): Promise<void>;
  agentA2uiMessage(message: unknown, taskId: string): Promise<void>;
  agentA2uiRegisterSurfaces(taskId: string, surfaceIds: string[]): Promise<void>;
  agentMemorySetPinned(taskId: string, noteId: string, pinned: boolean): Promise<AgentMemoryNoteView>;
  agentMemoryArchiveNote(taskId: string, noteId: string): Promise<void>;
  agentMemoryGetSnapshot(taskId: string): Promise<AgentMemorySnapshot>;
  agentMemoryGetDreamRun(taskId: string, runId: string): Promise<AgentMemoryDreamRunDetail>;
  agentMemoryAbandonDreaming(taskId: string, runId: string, reason: string): Promise<void>;
  agentMemoryRollbackDreaming(taskId: string, runId: string, reason: string): Promise<void>;
  agentMemorySaveDreamSchedule(taskId: string, schedule: { enabled: boolean; intervalMinutes: number }): Promise<AgentMemoryDreamSchedule>;
  agentMemoryReindexEmbeddings(taskId: string, limit?: number): Promise<{ enabled: boolean; indexed: number; remaining: number; total?: number; model?: string; warning?: string; message?: string }>;
  agentMemoryCheckEmbedding(config: { provider: "ollama"; baseUrl: string; model: string }): Promise<{ available: boolean; model: string; dimensions: number }>;
  agentMemoryRecordExternalSources(taskId: string, input: { noteId: string; baseVersion: number; sources: Array<{ sourceRef: string; url: string; publisher: string; publishedAt?: string | null }>; note: string }): Promise<AgentMemoryNoteView>;
  agentMemoryConfirmExternalVerification(taskId: string, noteId: string, baseVersion: number): Promise<AgentMemoryNoteView>;
  copilotCancel(): Promise<void>;
  agentLoadSession(taskId?: string): Promise<AgentSessionItem[]>;
  agentSaveSession(items: AgentSessionItem[], taskId?: string): Promise<void>;
  agentClearSession(taskId?: string): Promise<void>;
  agentWorkspaceListFiles(workspacePath: string): Promise<string[]>;
  agentWorkspaceReadFile(workspacePath: string, relativePath: string): Promise<string>;
  onCopilotEvent(listener: (event: CopilotEvent) => void): () => void;
  findInPage(id: string, text: string): Promise<void>;
  stopFindInPage(id: string): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
  onDownload(listener: (event: BrowserDownloadEvent) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
  onFindRequested(listener: () => void): () => void;
}