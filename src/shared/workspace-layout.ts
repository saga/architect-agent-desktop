export interface WorkspaceLayoutState {
  version: 1;
  agentPanelWidth: number;
  agentPanelVisible: boolean;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutState = {
  version: 1,
  agentPanelWidth: 390,
  agentPanelVisible: true,
};

export function parseWorkspaceLayout(value: unknown): WorkspaceLayoutState {
  if (!value || typeof value !== "object") return { ...DEFAULT_WORKSPACE_LAYOUT };
  const input = value as Partial<WorkspaceLayoutState>;
  const width = typeof input.agentPanelWidth === "number" && Number.isFinite(input.agentPanelWidth)
    ? Math.round(Math.max(280, Math.min(720, input.agentPanelWidth)))
    : DEFAULT_WORKSPACE_LAYOUT.agentPanelWidth;
  return {
    version: 1,
    agentPanelWidth: width,
    agentPanelVisible: typeof input.agentPanelVisible === "boolean"
      ? input.agentPanelVisible
      : DEFAULT_WORKSPACE_LAYOUT.agentPanelVisible,
  };
}
