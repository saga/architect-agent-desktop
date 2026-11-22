import { describe, expect, it } from "vitest";
import { resolveAgentBrowserTab, resolveAgentBrowserTabId, shouldBlockAgentTabOperation } from "../src/main/agent-run-context";

describe("Agent Run Browser tab context", () => {
  it("keeps the Run target stable when the visible tab changes", () => {
    expect(resolveAgentBrowserTabId("tab-run", "tab-visible")).toBe("tab-run");
  });
  it("uses the visible tab only when no Agent Run is active", () => {
    expect(resolveAgentBrowserTabId(undefined, "tab-visible")).toBe("tab-visible");
    expect(resolveAgentBrowserTabId(undefined, null)).toBeNull();
  });
  it("does not silently attach an active Run to a tab selected later", () => {
    expect(resolveAgentBrowserTabId(null, "tab-opened-after-start")).toBeNull();
  });
  it("routes scheduled Runs to their isolated Browser Context without falling back to the user's tab", () => {
    const userTabs = new Map([["user-tab", "user page"]]);
    const scheduleTabs = new Map([["schedule-tab", "schedule page"]]);
    const context = { activeTabId: "schedule-tab", tabs: scheduleTabs };
    expect(resolveAgentBrowserTab(context, null, "user-tab", userTabs)).toBe("schedule page");
    expect(resolveAgentBrowserTab({ activeTabId: null, tabs: scheduleTabs }, null, "user-tab", userTabs)).toBeNull();
  });
  it("uses the pinned or visible tab only outside a scheduled Browser Context", () => {
    const tabs = new Map([["visible", "visible page"], ["pinned", "pinned page"]]);
    expect(resolveAgentBrowserTab(null, "pinned", "visible", tabs)).toBe("pinned page");
    expect(resolveAgentBrowserTab(null, undefined, "visible", tabs)).toBe("visible page");
    expect(resolveAgentBrowserTab(null, null, "visible", tabs)).toBeNull();
  });
  it("blocks UI mutations only for the active Run target", () => {
    expect(shouldBlockAgentTabOperation("tab-run", "tab-run", true)).toBe(true);
    expect(shouldBlockAgentTabOperation("tab-visible", "tab-run", true)).toBe(false);
    expect(shouldBlockAgentTabOperation("tab-run", "tab-run", false)).toBe(false);
  });
});
