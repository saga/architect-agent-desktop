import type { LayoutNode } from "../main/layout/layout-engine";

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
    const legacy = input as { agentPanelWidth?: unknown; agentPanelVisible?: unknown };
    const width = Math.round(Math.max(280, Math.min(720, finite(legacy.agentPanelWidth, 390))));
    const visible = legacy.agentPanelVisible !== false;
    const root = structuredClone(DEFAULT_WORKSPACE_DOCUMENT.root) as Extract<LayoutNode, { type: "split" }>;
    root.ratio = visible ? Math.max(0.05, Math.min(0.95, 1 - width / 1200)) : 0.5;
    const agentNode = root.second as Extract<LayoutNode, { type: "panel" }>;
    root.second = { ...agentNode, visible };
    return { ...structuredClone(DEFAULT_WORKSPACE_DOCUMENT), root };
  }
  const root = input.root as LayoutNode;
  const collect = (node: LayoutNode, ids = new Set<string>()): Set<string> => {
    if (!node || typeof node !== "object" || typeof node.id !== "string" || !node.id.trim() || ids.has(node.id)) throw new Error("Invalid workspace layout tree.");
    ids.add(node.id);
    if (node.type === "split") {
      if (node.axis !== "horizontal" && node.axis !== "vertical") throw new Error("Invalid split axis.");
      if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) throw new Error("Invalid split ratio.");
      collect(node.first, ids); collect(node.second, ids);
    } else if (node.type !== "panel") throw new Error("Unknown layout node.");
    return ids;
  };
  const collectPanels = (node: LayoutNode): string[] => node.type === "panel" ? [node.id] : [...collectPanels(node.first), ...collectPanels(node.second)];
  const panelIds = collectPanels(root);
  const allNodeIds = collect(root);
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
    if (!groupId || groupIds.has(groupId) || members.length === 0 || new Set(members).size !== members.length || members.some((id) => !panelIds.includes(id) || groupedPanels.has(id))) throw new Error("Invalid workspace tab group.");
    groupIds.add(groupId); members.forEach((id) => groupedPanels.add(id));
    return { id: groupId, panelIds: members, activePanelId: active };
  });
  if (floating.some((item) => allNodeIds.has(item.id))) throw new Error("Floating root ID conflicts with layout tree.");
  const activePanelId = typeof input.activePanelId === "string" ? input.activePanelId : "browser";
  if (!panelIds.includes(activePanelId) && !floating.some((item) => item.panelId === activePanelId)) throw new Error("Active panel is not part of the workspace.");
  return { version: 2, root, tabGroups, floating, activePanelId };
}

function setPanelVisible(root: LayoutNode, panelId: string, visible: boolean): LayoutNode {
  if (root.type === "panel") return root.id === panelId ? { ...root, visible } : root;
  return { ...root, first: setPanelVisible(root.first, panelId, visible), second: setPanelVisible(root.second, panelId, visible) };
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
    activePanelId: document.activePanelId === panelId ? "browser" : document.activePanelId,
    floating: [...document.floating, { id: "floating-" + panelId, panelId, bounds }],
  };
}

export function redockFloatingPanel(document: WorkspaceDocument, panelId: string): WorkspaceDocument {
  return { ...document, root: setPanelVisible(document.root, panelId, true), floating: document.floating.filter((item) => item.panelId !== panelId), activePanelId: panelId };
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
  if (!groupId.trim() || document.tabGroups.some((group) => group.id === groupId)
    || panelIds.length < 2 || new Set(panelIds).size !== panelIds.length
    || panelIds.some((id) => !validPanels.has(id)) || !panelIds.includes(activePanelId)) return document;
  const remaining = document.tabGroups.map((group) => ({
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
