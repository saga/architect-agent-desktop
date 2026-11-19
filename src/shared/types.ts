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
export type AgentThinkingLevel = "low" | "medium" | "high";
export interface AgentSettings {
  provider: AgentProvider;
  copilotModel: string;
  codebuddyModel: string;
  thinkingLevel: AgentThinkingLevel;
  systemPrompt: string;
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "copilot",
  copilotModel: "",
  codebuddyModel: "",
  thinkingLevel: "medium",
  systemPrompt: "",
};

export interface CopilotEvent { type: "status" | "delta" | "message" | "error" | "done" | "tool"; status?: string; text?: string; }

export interface BrowserApi {
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
  agentGetSettings(): Promise<AgentSettings>;
  agentSaveSettings(settings: AgentSettings): Promise<AgentSettings>;
  copilotSend(prompt: string): Promise<void>;
  copilotCancel(): Promise<void>;
  onCopilotEvent(listener: (event: CopilotEvent) => void): () => void;
  findInPage(id: string, text: string): Promise<void>;
  stopFindInPage(id: string): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
  onDownload(listener: (event: BrowserDownloadEvent) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
  onFindRequested(listener: () => void): () => void;
}