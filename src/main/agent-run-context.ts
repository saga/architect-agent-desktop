/** Resolve the Browser tab captured for this Agent Run, falling back to the UI tab. */
export function resolveAgentBrowserTabId(runTabId: string | null | undefined, activeTabId: string | null): string | null {
  return runTabId === undefined ? activeTabId : runTabId;
}

/** A scheduled run must remain inside its own Browser Context, including when it has no active tab. */
export function resolveAgentBrowserTab<T>(
  scheduleContext: { activeTabId: string | null; tabs: ReadonlyMap<string, T> } | null,
  runTabId: string | null | undefined,
  activeTabId: string | null,
  tabs: ReadonlyMap<string, T>,
): T | null {
  if (scheduleContext) {
    return scheduleContext.activeTabId ? scheduleContext.tabs.get(scheduleContext.activeTabId) ?? null : null;
  }
  const id = resolveAgentBrowserTabId(runTabId, activeTabId);
  return id ? tabs.get(id) ?? null : null;
}

/** UI mutations must not change or destroy a Browser tab currently owned by an Agent Run. */
export function shouldBlockAgentTabOperation(
  targetTabId: string,
  runTabId: string | null | undefined,
  operationBusy: boolean,
): boolean {
  return operationBusy && runTabId !== undefined && runTabId !== null && targetTabId === runTabId;
}
