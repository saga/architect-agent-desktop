import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateLayout, validateLayout } = require("../dist/main/layout/layout-engine.js");
const { dockPanel, removePanel, collectPanelIds, normalizeLayout } = require("../dist/main/layout/layout-tree.js");
const { DEFAULT_WORKSPACE_DOCUMENT, parseWorkspaceDocument, createFloatingPanel, redockFloatingPanel, activateWorkspaceTab, createWorkspaceTabGroup, movePanelToTabGroup, removePanelFromTabGroup } = require("../dist/shared/workspace-document.js");

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
