import type { LayoutNode } from "../../shared/layout-types";

export type DockPosition = "left" | "right" | "top" | "bottom";

export function updateSplitRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return root;
  if (root.type === "panel") return root;
  if (root.id === splitId) return { ...root, ratio };
  return {
    ...root,
    first: updateSplitRatio(root.first, splitId, ratio),
    second: updateSplitRatio(root.second, splitId, ratio),
  };
}

export function setPanelVisibility(root: LayoutNode, panelId: string, visible: boolean): LayoutNode {
  if (root.type === "panel") return root.id === panelId ? { ...root, visible } : root;
  return {
    ...root,
    first: setPanelVisibility(root.first, panelId, visible),
    second: setPanelVisibility(root.second, panelId, visible),
  };
}

/** Replace a target panel with a split containing the original and new panel. */
export function splitPanel(
  root: LayoutNode,
  targetPanelId: string,
  newPanel: Extract<LayoutNode, { type: "panel" }>,
  splitId: string,
  axis: "horizontal" | "vertical",
  position: "before" | "after" = "after",
  ratio = 0.5,
): LayoutNode {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return root;
  if (root.type === "panel") {
    if (root.id !== targetPanelId) return root;
    const first = position === "before" ? newPanel : root;
    const second = position === "before" ? root : newPanel;
    return { type: "split", id: splitId, axis, ratio, first, second };
  }
  return {
    ...root,
    first: splitPanel(root.first, targetPanelId, newPanel, splitId, axis, position, ratio),
    second: splitPanel(root.second, targetPanelId, newPanel, splitId, axis, position, ratio),
  };
}

/** Remove a panel and collapse its parent split, preserving the sibling subtree. */
export function removePanel(root: LayoutNode, panelId: string): LayoutNode | null {
  if (root.type === "panel") return root.id === panelId ? null : root;
  if (root.first.type === "panel" && root.first.id === panelId) return root.second;
  if (root.second.type === "panel" && root.second.id === panelId) return root.first;
  const first = removePanel(root.first, panelId);
  const second = removePanel(root.second, panelId);
  if (!first) return second;
  if (!second) return first;
  return { ...root, first, second };
}

export function findPanel(root: LayoutNode, panelId: string): Extract<LayoutNode, { type: "panel" }> | null {
  if (root.type === "panel") return root.id === panelId ? root : null;
  return findPanel(root.first, panelId) ?? findPanel(root.second, panelId);
}

export function collectPanelIds(root: LayoutNode): string[] {
  if (root.type === "panel") return [root.id];
  return [...collectPanelIds(root.first), ...collectPanelIds(root.second)];
}

/**
 * Move an existing panel beside a target panel. The source is removed first,
 * so the operation cannot duplicate panel IDs. Invalid/self/descendant moves
 * leave the original tree unchanged.
 */
export function dockPanel(
  root: LayoutNode,
  sourcePanelId: string,
  targetPanelId: string,
  position: DockPosition,
  splitId: string,
  ratio = 0.5,
): LayoutNode {
  if (sourcePanelId === targetPanelId || !findPanel(root, sourcePanelId) || !findPanel(root, targetPanelId)) return root;
  if (!splitId.trim() || collectPanelIds(root).includes(splitId)) return root;
  const source = findPanel(root, sourcePanelId);
  if (!source) return root;

  const withoutSource = removePanel(root, sourcePanelId);
  if (!withoutSource || !findPanel(withoutSource, targetPanelId)) return root;

  const horizontal = position === "left" || position === "right";
  const before = position === "left" || position === "top";
  const next = splitPanel(
    withoutSource,
    targetPanelId,
    { ...source },
    splitId,
    horizontal ? "horizontal" : "vertical",
    before ? "before" : "after",
    ratio,
  );
  return validateTree(next) ? next : root;
}

/** Collapse invisible branches without changing the relative order of visible panels. */
export function normalizeLayout(root: LayoutNode): LayoutNode | null {
  if (root.type === "panel") return root.visible === false ? null : { ...root };
  const first = normalizeLayout(root.first);
  const second = normalizeLayout(root.second);
  if (!first) return second;
  if (!second) return first;
  return { ...root, first, second };
}

export function validateTree(root: LayoutNode): boolean {
  const ids = new Set<string>();
  const visit = (node: LayoutNode): boolean => {
    if (!node.id.trim() || ids.has(node.id)) return false;
    ids.add(node.id);
    return node.type === "panel" || (Number.isFinite(node.ratio) && node.ratio > 0 && node.ratio < 1
      && visit(node.first) && visit(node.second));
  };
  return visit(root);
}
