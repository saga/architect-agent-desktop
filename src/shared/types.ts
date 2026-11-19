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

export interface CopilotEvent { type: "status" | "delta" | "message" | "error" | "done"; status?: string; text?: string; }

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
  setContentBounds(bounds: { top: number; left: number }): void;
  copilotStatus(): Promise<{ status: string; message?: string }>;
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