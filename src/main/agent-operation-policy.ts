export interface AgentOperationState {
  scheduleRunnerActive: boolean;
  maintenanceOperationPending: boolean;
  agentRequestPending: boolean;
  taskActivationPending: boolean;
  providerBusy: boolean;
}

/** A shared conflict predicate; it is not a workflow/state-machine framework. */
export function isAgentOperationBusy(state: AgentOperationState): boolean {
  return state.scheduleRunnerActive
    || state.maintenanceOperationPending
    || state.agentRequestPending
    || state.taskActivationPending
    || state.providerBusy;
}
