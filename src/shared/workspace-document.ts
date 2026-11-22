import type { LayoutNode } from "./layout-types";
import { validateLayout } from "./layout-validation";

export interface WorkspaceTabGroup {
  id: string;
  panelIds: string[];
  activePanelId: string;
}

export interface FloatingPanelRoot {
  id: string;
  panelId: string;
  bounds: { x: number; y: number; width: number; height: number };
  alwaysOnTop?: boolean;
}

export interface WorkspaceDocument {
  version: 2;
  root: LayoutNode;
  tabGroups: WorkspaceTabGroup[];
  floating: FloatingPanelRoot[];
  activePanelId: string;
}

export const DEFAULT_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  version: 2,
  root: {
    type: "split", id: "workspace-root", axis: "horizontal", ratio: 0.68, splitterSize: 6,
    first: { type: "panel", id: "browser", minWidth: 320, minHeight: 240 },
    second: { type: "panel", id: "agent", minWidth: 280, minHeight: 240 },
  },
  tabGroups: [{ id: "browser-tabs", panelIds: ["browser"], activePanelId: "browser" }],
  floating: [],
  activePanelId: "browser",
};

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function parseWorkspaceDocument(value: unknown): WorkspaceDocument {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_WORKSPACE_DOCUMENT);
  const input = value as Record<string, unknown>;
  if (input.version !== 2 || !input.root || typeof input.root !== "object") {
    // Version 1 only stored Agent width/visibility. Migrate it into the v2 tree.
    const legacy = input as { agentPanelWidth?: unknown; agentPanelVisible?: unknown; agentPanelPosition?: unknown };
    const width = Math.round(Math.max(280, Math.min(720, finite(legacy.agentPanelWidth, 390))));
    const visible = legacy.agentPanelVisible !== false;
    const position = legacy.agentPanelPosition === "left" || legacy.agentPanelPosition === "top" || legacy.agentPanelPosition === "bottom" ? legacy.agentPanelPosition : "right";
    const horizontal = position === "left" || position === "right";
    const agentFirst = position === "left" || position === "top";
    const root = structuredClone(DEFAULT_WORKSPACE_DOCUMENT.root) as Extract<LayoutNode, { type: "split" }>;
    root.axis = horizontal ? "horizontal" : "vertical";
    // Preserve the legacy preferred width even when the Agent panel was hidden.
    root.ratio = Math.max(0.05, Math.min(0.95, agentFirst ? width / 1200 : 1 - width / 1200));
    const browserNode = root.first;
    const agentNode = root.second as Extract<LayoutNode, { type: "panel" }>;
    root.first = agentFirst ? { ...agentNode, visible } : browserNode;
    root.second = agentFirst ? browserNode : { ...agentNode, visible };
    return { ...structuredClone(DEFAULT_WORKSPACE_DOCUMENT), root };
  }
  const root = input.root as LayoutNode;
  let nodeCount = 0;
  const collect = (node: LayoutNode, ids = new Set<string>(), depth = 0): Set<string> => {
    nodeCount += 1;
    // Bound recursion and validate untrusted structure here. Shared layout
    // semantics (IDs, axes, ratios and dimensions) belong to validateLayout.
    if (nodeCount > 128 || depth > 32 || !node || typeof node !== "object" || typeof node.id !== "string") {
      throw new Error("Invalid workspace layout tree.");
    }
    ids.add(node.id);
    if (node.type === "split") {
      collect(node.first, ids, depth + 1);
      collect(node.second, ids, depth + 1);
    } else if (node.type !== "panel") {
      throw new Error("Unknown layout node.");
    }
    return ids;
  };
  const allNodeIds = collect(root);
  const layoutErrors = validateLayout(root);
  if (layoutErrors.length > 0) throw new Error("Invalid workspace layout tree: " + layoutErrors.join(" "));
  const collectPanels = (node: LayoutNode): string[] => node.type === "panel" ? [node.id] : [...collectPanels(node.first), ...collectPanels(node.second)];
  const panelIds = collectPanels(root);
  const floatingInput = Array.isArray(input.floating) ? input.floating : [];
  const floating = floatingInput.slice(0, 12).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid floating panel.");
    const row = item as Record<string, unknown>;
    const bounds = row.bounds as Record<string, unknown>;
    if (!bounds) throw new Error("Invalid floating bounds.");
    return {
      id: String(row.id || ""),
      panelId: String(row.panelId || ""),
      bounds: {
        x: finite(bounds.x, 80), y: finite(bounds.y, 80),
        width: Math.max(320, Math.min(1600, finite(bounds.width, 640))),
        height: Math.max(240, Math.min(1200, finite(bounds.height, 480))),
      },
      alwaysOnTop: row.alwaysOnTop === true,
    };
  });
  if (floating.some((item) => !item.id || !panelIds.includes(item.panelId)) || new Set(floating.map((item) => item.id)).size !== floating.length || new Set(floating.map((item) => item.panelId)).size !== floating.length) throw new Error("Duplicate or empty floating panel identity.");
  const groupsInput = Array.isArray(input.tabGroups) ? input.tabGroups : [];
  const groupIds = new Set<string>();
  const groupedPanels = new Set<string>();
  const tabGroups = groupsInput.slice(0, 32).map((item) => {
    const row = item as Record<string, unknown>;
    const members = Array.isArray(row.panelIds) ? row.panelIds.filter((id): id is string => typeof id === "string").slice(0, 64) : [];
    const active = typeof row.activePanelId === "string" && members.includes(row.activePanelId) ? row.activePanelId : members[0] || "";
    const groupId = String(row.id || "");
    if (!groupId || groupIds.has(groupId) || members.length === 0 || new Set(members).size !== members.length || members.some((id) => !panelIds.includes(id) || groupedPanels.has(id) || floating.some((item) => item.panelId === id))) throw new Error("Invalid workspace tab group.");
    groupIds.add(groupId); members.forEach((id) => groupedPanels.add(id));
    return { id: groupId, panelIds: members, activePanelId: active };
  });
  if (floating.some((item) => allNodeIds.has(item.id))) throw new Error("Floating root ID conflicts with layout tree.");
  const requestedActivePanelId = typeof input.activePanelId === "string" ? input.activePanelId : "";
  const validActivePanel = panelIds.includes(requestedActivePanelId) || floating.some((item) => item.panelId === requestedActivePanelId);
  const activePanelId = validActivePanel ? requestedActivePanelId : panelIds.find(id => !floating.some(item => item.panelId === id)) ?? floating[0]?.panelId ?? panelIds[0]!;
  return { version: 2, root, tabGroups, floating, activePanelId };
}

function setPanelVisible(root: LayoutNode, panelId: string, visible: boolean): LayoutNode {
  if (root.type === "panel") return root.id === panelId ? { ...root, visible } : root;
  return { ...root, first: setPanelVisible(root.first, panelId, visible), second: setPanelVisible(root.second, panelId, visible) };
}

function firstPanelId(node: LayoutNode, excludedPanelId: string): string | null {
  if (node.type === "panel") return node.id === excludedPanelId ? null : node.id;
  return firstPanelId(node.first, excludedPanelId) ?? firstPanelId(node.second, excludedPanelId);
}

export function createFloatingPanel(
  document: WorkspaceDocument,
  panelId: string,
  bounds: FloatingPanelRoot["bounds"],
): WorkspaceDocument {
  if (document.floating.some((item) => item.panelId === panelId)) return document;
  return {
    ...document,
    root: setPanelVisible(document.root, panelId, false),
    activePanelId: document.activePanelId === panelId
      ? firstPanelId(document.root, panelId) ?? document.floating.find(item => item.panelId !== panelId)?.panelId ?? panelId
      : document.activePanelId,
    tabGroups: document.tabGroups.map((group) => {
      const panelIds = group.panelIds.filter((id) => id !== panelId);
      return { ...group, panelIds, activePanelId: panelIds.includes(group.activePanelId) ? group.activePanelId : panelIds[0] || "" };
    }).filter((group) => group.panelIds.length > 0),
    floating: [...document.floating, { id: "floating-" + panelId, panelId, bounds }],
  };
}

export function redockFloatingPanel(document: WorkspaceDocument, panelId: string): WorkspaceDocument {
  return { ...document, root: setPanelVisible(document.root, panelId, true), floating: document.floating.filter((item) => item.panelId !== panelId), tabGroups: document.tabGroups.map((group) => group.panelIds.includes(panelId) ? { ...group, activePanelId: panelId } : group), activePanelId: panelId };
}

export function activateWorkspaceTab(document: WorkspaceDocument, groupId: string, panelId: string): WorkspaceDocument {
  return {
    ...document,
    tabGroups: document.tabGroups.map((group) =>
      group.id === groupId && group.panelIds.includes(panelId) ? { ...group, activePanelId: panelId } : group),
    activePanelId: panelId,
  };
}

export function createWorkspaceTabGroup(
  document: WorkspaceDocument,
  groupId: string,
  panelIds: string[],
  activePanelId = panelIds[0],
): WorkspaceDocument {
  const validPanels = new Set<string>();
  const collect = (node: LayoutNode) => {
    if (node.type === "panel") validPanels.add(node.id);
    else { collect(node.first); collect(node.second); }
  };
  collect(document.root);
  if (!groupId.trim()
    || panelIds.length < 2 || new Set(panelIds).size !== panelIds.length
    || panelIds.some((id) => !validPanels.has(id)) || !panelIds.includes(activePanelId)) return document;
  const remaining = document.tabGroups.filter((group) => group.id !== groupId).map((group) => ({
    ...group,
    panelIds: group.panelIds.filter((id) => !panelIds.includes(id)),
  })).filter((group) => group.panelIds.length > 0)
    .map((group) => ({ ...group, activePanelId: group.panelIds.includes(group.activePanelId) ? group.activePanelId : group.panelIds[0] }));
  return {
    ...document,
    tabGroups: [...remaining, { id: groupId, panelIds: [...panelIds], activePanelId }],
    activePanelId,
  };
}

export function movePanelToTabGroup(document: WorkspaceDocument, groupId: string, panelId: string): WorkspaceDocument {
  const group = document.tabGroups.find((item) => item.id === groupId);
  if (!group || group.panelIds.includes(panelId)) return document;
  const panelExists = (node: LayoutNode): boolean => node.type === "panel" ? node.id === panelId : panelExists(node.first) || panelExists(node.second);
  if (!panelExists(document.root)) return document;
  return {
    ...document,
    tabGroups: document.tabGroups.map((item) => {
      if (item.panelIds.includes(panelId)) {
        const members = item.panelIds.filter((id) => id !== panelId);
        return { ...item, panelIds: members, activePanelId: members.includes(item.activePanelId) ? item.activePanelId : members[0] || "" };
      }
      return item;
    }).filter((item) => item.panelIds.length > 0).map((item) =>
      item.id === groupId ? { ...item, panelIds: [...item.panelIds, panelId] } : item),
  };
}

export function removePanelFromTabGroup(document: WorkspaceDocument, groupId: string, panelId: string): WorkspaceDocument {
  return {
    ...document,
    tabGroups: document.tabGroups.map((group) => {
      if (group.id !== groupId) return group;
      const panelIds = group.panelIds.filter((id) => id !== panelId);
      return { ...group, panelIds, activePanelId: panelIds.includes(group.activePanelId) ? group.activePanelId : panelIds[0] || "" };
    }).filter((group) => group.panelIds.length > 0),
  };
}

export function setWorkspacePanelVisibility(document: WorkspaceDocument, panelId: string, visible: boolean): WorkspaceDocument {
  return { ...document, root: setPanelVisible(document.root, panelId, visible) };
}

export function ungroupWorkspacePanel(document: WorkspaceDocument, groupId: string, panelId: string): WorkspaceDocument {
  const withoutPanel = removePanelFromTabGroup(document, groupId, panelId);
  return {
    ...withoutPanel,
    root: setPanelVisible(withoutPanel.root, panelId, true),
    activePanelId: "browser",
  };
}


export type WorkspaceDockPosition = "left" | "right" | "top" | "bottom";

export interface WorkspacePanelLayout {
  visible: boolean;
  position: WorkspaceDockPosition | null;
  share: number | null;
}

function findDockedPanelSplit(
  root: LayoutNode,
  panelId: string,
  otherPanelId: string,
): Extract<LayoutNode, { type: "split" }> | null {
  if (root.type === "panel") return null;
  if (root.first.type === "panel" && root.second.type === "panel"
    && new Set([root.first.id, root.second.id]).size === 2
    && [root.first.id, root.second.id].includes(panelId)
    && [root.first.id, root.second.id].includes(otherPanelId)) return root;
  return findDockedPanelSplit(root.first, panelId, otherPanelId)
    ?? findDockedPanelSplit(root.second, panelId, otherPanelId);
}

function replaceDockedPanelSplit(
  root: LayoutNode,
  splitId: string,
  replacement: Extract<LayoutNode, { type: "split" }>,
): LayoutNode {
  if (root.type === "panel") return root;
  if (root.id === splitId) return replacement;
  return {
    ...root,
    first: replaceDockedPanelSplit(root.first, splitId, replacement),
    second: replaceDockedPanelSplit(root.second, splitId, replacement),
  };
}

/** Read the persistent dock state for a panel from the workspace tree. */
export function getWorkspacePanelLayout(
  document: WorkspaceDocument,
  panelId: string,
  otherPanelId: string,
): WorkspacePanelLayout {
  const panel = findPanel(document.root, panelId);
  const split = findDockedPanelSplit(document.root, panelId, otherPanelId);
  if (!split || !panel) {
    return { visible: Boolean(panel && panel.visible !== false), position: null, share: null };
  }
  const panelFirst = split.first.type === "panel" && split.first.id === panelId;
  const share = panelFirst ? split.ratio : 1 - split.ratio;
  const position: WorkspaceDockPosition = split.axis === "horizontal"
    ? panelFirst ? "left" : "right"
    : panelFirst ? "top" : "bottom";
  return { visible: panel.visible !== false, position, share };
}

/** Set the Agent/Browser split ratio without introducing a second layout store. */
export function setWorkspacePanelShare(
  document: WorkspaceDocument,
  panelId: string,
  otherPanelId: string,
  share: number,
): WorkspaceDocument {
  if (!Number.isFinite(share) || share <= 0 || share >= 1) return document;
  const split = findDockedPanelSplit(document.root, panelId, otherPanelId);
  if (!split) return document;
  const panelFirst = split.first.type === "panel" && split.first.id === panelId;
  const normalizedShare = Math.max(0.05, Math.min(0.95, share));
  const ratio = panelFirst ? normalizedShare : 1 - normalizedShare;
  return {
    ...document,
    root: replaceDockedPanelSplit(document.root, split.id, { ...split, ratio }),
  };
}

/** Change dock direction/order while preserving the panel's current relative share. */
export function setWorkspacePanelDockPosition(
  document: WorkspaceDocument,
  panelId: string,
  otherPanelId: string,
  position: WorkspaceDockPosition,
): WorkspaceDocument {
  const split = findDockedPanelSplit(document.root, panelId, otherPanelId);
  if (!split) return document;
  const panelFirst = split.first.type === "panel" && split.first.id === panelId;
  const share = panelFirst ? split.ratio : 1 - split.ratio;
  const horizontal = position === "left" || position === "right";
  const nextPanelFirst = position === "left" || position === "top";
  const panel = split.first.type === "panel" && split.first.id === panelId ? split.first : split.second;
  const other = split.first.type === "panel" && split.first.id === otherPanelId ? split.first : split.second;
  const ratio = nextPanelFirst ? share : 1 - share;
  const replacement = {
    ...split,
    axis: horizontal ? "horizontal" as const : "vertical" as const,
    ratio,
    first: nextPanelFirst ? panel : other,
    second: nextPanelFirst ? other : panel,
  };
  return {
    ...document,
    root: replaceDockedPanelSplit(document.root, split.id, replacement),
  };
}
