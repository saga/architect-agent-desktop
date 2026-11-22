export type RuntimeCapability =
  | "workspace.list"
  | "workspace.read"
  | "workspace.write"
  | "http.fetch"
  | "tools.call";

export interface RuntimeLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxLogEntries: number;
}

export interface CodeModeRequest {
  mode: "generated-code";
  code: string;
  providers: string[];
  workspaceRoot?: string;
  capabilities: RuntimeCapability[];
  limits?: Partial<RuntimeLimits>;
  signal?: AbortSignal;
}

export interface RuntimeExecutionResult {
  id: string;
  status: "completed" | "failed" | "cancelled" | "timed-out";
  result?: unknown;
  error?: string;
  logs: Array<{ level: "info" | "warn" | "error"; message: string; timestamp: number }>;
  durationMs: number;
}

export interface RuntimeCapabilityContext {
  workspaceRoot?: string;
  capabilities: ReadonlySet<RuntimeCapability>;
}

export type RuntimeCapabilityHandler = (
  context: RuntimeCapabilityContext,
  args: unknown
) => Promise<unknown> | unknown;

export interface RuntimeCapabilityHandlers {
  [capability: string]: RuntimeCapabilityHandler | undefined;
}
