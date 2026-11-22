import { describe, expect, it } from "vitest";
import { resolveAgentBrowserTabId, shouldBlockAgentTabOperation } from "../src/main/agent-run-context";

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
  it("blocks UI mutations only for the active Run target", () => {
    expect(shouldBlockAgentTabOperation("tab-run", "tab-run", true)).toBe(true);
    expect(shouldBlockAgentTabOperation("tab-visible", "tab-run", true)).toBe(false);
    expect(shouldBlockAgentTabOperation("tab-run", "tab-run", false)).toBe(false);
  });
});
