import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateLayout, validateLayout } = require("../dist/main/layout/layout-engine.js");
const { dockPanel, removePanel, collectPanelIds, normalizeLayout, validateTree } = require("../dist/main/layout/layout-tree.js");
const { DEFAULT_WORKSPACE_DOCUMENT, parseWorkspaceDocument, createFloatingPanel, redockFloatingPanel, activateWorkspaceTab, createWorkspaceTabGroup, movePanelToTabGroup, removePanelFromTabGroup, ungroupWorkspacePanel, setWorkspacePanelVisibility } = require("../dist/shared/workspace-document.js");
const { NativeViewStackManager } = require("../dist/main/layout/native-view-stack.js");

const base = {
  type: "split",
  id: "root",
  axis: "horizontal",
  ratio: 0.7,
  splitterSize: 6,
  first: { type: "panel", id: "browser", minWidth: 320, minHeight: 200 },
  second: { type: "panel", id: "agent", minWidth: 280, minHeight: 200 },
};

test("layout solver allocates deterministic split bounds", () => {
  const result = calculateLayout(base, { x: 0, y: 0, width: 1200, height: 800 });
  assert.deepEqual(result.bounds.browser, { x: 0, y: 0, width: 836, height: 800 });
  assert.deepEqual(result.bounds.agent, { x: 842, y: 0, width: 358, height: 800 });
  assert.deepEqual(result.overflow, []);
});

test("hidden panel gives the remaining panel the complete viewport", () => {
  const tree = { ...base, second: { ...base.second, visible: false } };
  const result = calculateLayout(tree, { x: 10, y: 20, width: 900, height: 600 });
  assert.deepEqual(result.bounds.browser, { x: 10, y: 20, width: 900, height: 600 });
  assert.deepEqual(result.hidden, ["agent"]);
});

test("docking moves a panel without duplicating ids", () => {
  const next = dockPanel(base, "agent", "browser", "bottom", "split-agent");
  assert.deepEqual(collectPanelIds(next).sort(), ["agent", "browser"]);
  assert.equal(next.type, "split");
  assert.equal(next.axis, "vertical");
  assert.equal(next.first.id, "browser");
  assert.equal(next.second.id, "agent");
  assert.deepEqual(validateLayout(next), []);
});

test("docking rejects self moves and missing targets", () => {
  assert.equal(dockPanel(base, "agent", "agent", "left", "new-split"), base);
  assert.equal(dockPanel(base, "missing", "browser", "left", "new-split"), base);
});

test("removing a panel collapses its parent split", () => {
  assert.deepEqual(removePanel(base, "agent"), base.first);
});

test("normalization removes hidden branches and collapses their split", () => {
  const tree = { ...base, second: { ...base.second, visible: false } };
  assert.deepEqual(normalizeLayout(tree), base.first);
});

test("workspace document migrates legacy layout preferences", () => {
  const migrated = parseWorkspaceDocument({ version: 1, agentPanelWidth: 420, agentPanelVisible: false });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.root.second.visible, false);
  assert.ok(migrated.root.ratio > 0 && migrated.root.ratio < 1);
  const left = parseWorkspaceDocument({ version: 1, agentPanelWidth: 400, agentPanelVisible: true, agentPanelPosition: "left" });
  assert.equal(left.root.axis, "horizontal");
  assert.equal(left.root.first.id, "agent");
});

test("floating a panel hides it in the dock tree and redocking restores it", () => {
  const floating = createFloatingPanel(DEFAULT_WORKSPACE_DOCUMENT, "agent", { x: 10, y: 20, width: 480, height: 720 });
  assert.equal(floating.root.second.visible, false);
  assert.equal(floating.floating[0].panelId, "agent");
  const redocked = redockFloatingPanel(floating, "agent");
  assert.equal(redocked.root.second.visible, true);
  assert.equal(redocked.floating.length, 0);
});

test("workspace tab activation is scoped to its group", () => {
  const document = {
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "split", id: "root", axis: "horizontal", ratio: 0.5,
      first: { type: "panel", id: "browser" },
      second: { type: "panel", id: "agent" } },
    tabGroups: [{ id: "workspace-tabs", panelIds: ["browser", "agent"], activePanelId: "browser" }],
  };
  const next = activateWorkspaceTab(document, "workspace-tabs", "agent");
  assert.equal(next.tabGroups[0].activePanelId, "agent");
  assert.equal(next.activePanelId, "agent");
});

test("workspace parser rejects duplicate IDs and invalid group members", () => {
  const duplicate = {
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "split", id: "root", axis: "horizontal", ratio: 0.5,
      first: { type: "panel", id: "same" }, second: { type: "panel", id: "same" } },
  };
  assert.throws(() => parseWorkspaceDocument(duplicate));
  const invalidGroup = { ...DEFAULT_WORKSPACE_DOCUMENT, tabGroups: [{ id: "g", panelIds: ["missing"], activePanelId: "missing" }] };
  assert.throws(() => parseWorkspaceDocument(invalidGroup));
});

test("workspace tab groups support create, move and detach membership", () => {
  const withAgent = {
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "split", id: "root", axis: "horizontal", ratio: 0.5,
      first: { type: "panel", id: "browser" }, second: { type: "panel", id: "agent" } },
  };
  const grouped = createWorkspaceTabGroup(withAgent, "workspace-tabs", ["browser", "agent"], "browser");
  assert.equal(grouped.tabGroups[0].panelIds.length, 2);
  const moved = movePanelToTabGroup({ ...grouped, tabGroups: [{ id: "browser-only", panelIds: ["browser"], activePanelId: "browser" }] }, "browser-only", "agent");
  assert.deepEqual(moved.tabGroups[0].panelIds, ["browser", "agent"]);
  const detached = removePanelFromTabGroup(grouped, "workspace-tabs", "agent");
  assert.deepEqual(detached.tabGroups[0].panelIds, ["browser"]);
});

test("dock operation supports all four directions", () => {
  for (const [position, axis, firstId, secondId] of [
    ["left", "horizontal", "agent", "browser"],
    ["right", "horizontal", "browser", "agent"],
    ["top", "vertical", "agent", "browser"],
    ["bottom", "vertical", "browser", "agent"],
  ]) {
    const next = dockPanel(base, "agent", "browser", position, "split-" + position);
    assert.equal(next.axis, axis);
    assert.equal(next.first.id, firstId);
    assert.equal(next.second.id, secondId);
    assert.deepEqual(validateLayout(next), []);
  }
});

test("invalid layout constraints are rejected before geometry", () => {
  const invalid = { ...base, ratio: 1.2 };
  assert.ok(validateLayout(invalid).some((error) => error.includes("ratio")));
  const badPanel = { type: "panel", id: "bad", minWidth: -1 };
  assert.ok(validateLayout(badPanel).some((error) => error.includes("minWidth")));
});


test("shared layout validation rejects invalid axes and splitter sizes", () => {
  const invalidAxis = { ...base, axis: "diagonal" };
  assert.ok(validateLayout(invalidAxis).some((error) => error.includes("axis")));
  assert.equal(validateTree(invalidAxis), false);

  const invalidSplitter = { ...base, splitterSize: -1 };
  assert.ok(validateLayout(invalidSplitter).some((error) => error.includes("splitterSize")));
  assert.equal(validateTree(invalidSplitter), false);
});

test("native view stack manages visibility, layers, bounds and disposal", () => {
  const children = [];
  const fakeWindow = {
    isDestroyed: () => false,
    getContentSize: () => [800, 600],
    contentView: {
      addChildView(view) {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
        children.push(view);
      },
      removeChildView(view) {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      },
    },
  };
  const makeView = () => ({
    bounds: null,
    closed: false,
    webContents: { isDestroyed: () => false, close() { this.closed = true; }, focus() { this.focused = true; } },
    setBounds(bounds) { this.bounds = bounds; },
  });
  const manager = new NativeViewStackManager(() => fakeWindow);
  const browser = makeView();
  const nextBrowser = makeView();
  const overlay = makeView();
  manager.register("browser:1", browser, "browser");
  manager.register("browser:2", nextBrowser, "browser");
  manager.register("snapshot", overlay, "overlay");
  manager.show("browser:1");
  assert.deepEqual(children, [browser]);
  manager.show("browser:2");
  manager.focus("browser:2");
  assert.equal(manager.getFocusedViewId(), "browser:2");
  assert.equal(nextBrowser.webContents.focused, true);
  assert.deepEqual(children, [nextBrowser]);
  manager.show("snapshot");
  assert.deepEqual(children, [nextBrowser, overlay]);
  manager.setBounds("snapshot", { x: 700, y: 500, width: 300, height: 300 });
  assert.deepEqual(overlay.bounds, { x: 700, y: 500, width: 100, height: 100 });
  manager.hide("snapshot");
  assert.deepEqual(children, [nextBrowser]);
  manager.unregister("browser:2", true);
  assert.equal(nextBrowser.webContents.closed, true);
  assert.equal(manager.getFocusedViewId(), null);
  assert.deepEqual(children, []);
});

test("ungrouping restores both panels to the split tree", () => {
  const grouped = createWorkspaceTabGroup({
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "split", id: "root", axis: "horizontal", ratio: 0.5,
      first: { type: "panel", id: "browser" }, second: { type: "panel", id: "agent", visible: false } },
  }, "browser-agent", ["browser", "agent"]);
  const ungrouped = ungroupWorkspacePanel(grouped, "browser-agent", "agent");
  assert.equal(ungrouped.root.second.visible, true);
  assert.equal(ungrouped.tabGroups.some((group) => group.panelIds.includes("agent")), false);
  assert.equal(ungrouped.activePanelId, "browser");
  const regrouped = createWorkspaceTabGroup(ungrouped, "browser-agent", ["browser", "agent"], "agent");
  assert.equal(regrouped.tabGroups.some((group) => group.id === "browser-agent" && group.panelIds.length === 2), true);
});

test("active workspace Tab Group panel receives the full shared slot", () => {
  const document = {
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "split", id: "root", axis: "horizontal", ratio: 0.65, splitterSize: 6,
      first: { type: "panel", id: "browser" }, second: { type: "panel", id: "agent" } },
    tabGroups: [{ id: "browser-agent", panelIds: ["browser", "agent"], activePanelId: "browser" }],
  };
  const browserDocument = setWorkspacePanelVisibility(setWorkspacePanelVisibility(document, "browser", true), "agent", false);
  const browserLayout = calculateLayout(browserDocument.root, { x: 0, y: 0, width: 1000, height: 700 });
  assert.deepEqual(browserLayout.bounds.browser, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(browserLayout.bounds.agent, undefined);
  const agentDocument = setWorkspacePanelVisibility(setWorkspacePanelVisibility(document, "browser", false), "agent", true);
  const agentLayout = calculateLayout(agentDocument.root, { x: 0, y: 0, width: 1000, height: 700 });
  assert.deepEqual(agentLayout.bounds.agent, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(agentLayout.bounds.browser, undefined);
});

test("workspace parser rejects invalid panel size constraints", () => {
  const invalid = {
    ...DEFAULT_WORKSPACE_DOCUMENT,
    root: { type: "panel", id: "browser", minWidth: -1 },
    tabGroups: [{ id: "browser-only", panelIds: ["browser"], activePanelId: "browser" }],
  };
  assert.throws(() => parseWorkspaceDocument(invalid));
});
