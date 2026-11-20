import { describe, expect, it } from "vitest";
import {
  createFloatingPanel,
  DEFAULT_WORKSPACE_DOCUMENT,
  parseWorkspaceDocument,
} from "../src/shared/workspace-document";

describe("workspace document invariants", () => {
  it("rejects a panel that is both floating and part of a tab group", () => {
    const value = structuredClone(DEFAULT_WORKSPACE_DOCUMENT);
    value.floating = [{
      id: "floating-browser",
      panelId: "browser",
      bounds: { x: 100, y: 100, width: 640, height: 480 },
    }];

    expect(() => parseWorkspaceDocument(value)).toThrow("Invalid workspace tab group.");
  });

  it("falls back to a panel that actually exists instead of hardcoding browser", () => {
    const parsed = parseWorkspaceDocument({
      version: 2,
      root: { type: "panel", id: "editor", minWidth: 320, minHeight: 240 },
      tabGroups: [],
      floating: [],
      activePanelId: "missing-panel",
    });

    expect(parsed.activePanelId).toBe("editor");
  });

  it("activates a remaining panel when the active panel is floated", () => {
    const floated = createFloatingPanel(
      structuredClone(DEFAULT_WORKSPACE_DOCUMENT),
      "browser",
      { x: 100, y: 100, width: 640, height: 480 },
    );

    expect(floated.activePanelId).toBe("agent");
  });
});
