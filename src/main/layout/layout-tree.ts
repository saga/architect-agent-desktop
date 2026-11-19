import type { LayoutNode } from "./layout-engine";

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
