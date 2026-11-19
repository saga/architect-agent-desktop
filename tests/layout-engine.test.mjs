import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateLayout, validateLayout } = require("../dist/main/layout/layout-engine.js");
const { dockPanel, removePanel, collectPanelIds, normalizeLayout } = require("../dist/main/layout/layout-tree.js");

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
  assert.deepEqual(result.bounds.browser, { x: 0, y: 0, width: 835.8, height: 800 });
  assert.deepEqual(result.bounds.agent, { x: 841.8, y: 0, width: 358.2, height: 800 });
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
