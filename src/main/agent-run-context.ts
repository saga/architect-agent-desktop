/** Resolve the Browser tab captured for this Agent Run, falling back to the UI tab. */
export function resolveAgentBrowserTabId(runTabId: string | null | undefined, activeTabId: string | null): string | null {
  return runTabId === undefined ? activeTabId : runTabId;
}

/** UI mutations must not change or destroy a Browser tab currently owned by an Agent Run. */
export function shouldBlockAgentTabOperation(
  targetTabId: string,
  runTabId: string | null | undefined,
  operationBusy: boolean,
): boolean {
  return operationBusy && runTabId !== undefined && runTabId !== null && targetTabId === runTabId;
}
