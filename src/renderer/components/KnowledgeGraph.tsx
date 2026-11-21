import { useEffect, useRef } from "react";
import { Alert, Typography } from "antd";
import { Graph, NodeEvent } from "@antv/g6";

export interface KnowledgeGraphProps {
  nodes: unknown;
  edges?: unknown;
  layout?: string;
  title?: string;
  height?: number;
  interactive?: boolean;
  selectedNodeId?: string;
  setSelectedNodeId?: (nodeId: string) => void;
  onNodeSelect?: () => void;
}

interface GraphData {
  nodes: Array<{ id: string; [key: string]: unknown }>;
  edges: Array<{ id: string; source: string; target: string; [key: string]: unknown }>;
}

function normaliseGraphData(nodes: unknown, edges: unknown): GraphData | null {
  const nodeList = Array.isArray(nodes) ? nodes : isRecord(nodes) && Array.isArray(nodes.nodes) ? nodes.nodes : null;
  const edgeList = Array.isArray(edges) ? edges : isRecord(nodes) && Array.isArray(nodes.edges) ? nodes.edges : [];
  if (!nodeList || nodeList.length > 5_000 || edgeList.length > 15_000) return null;
  let serialized = "";
  try { serialized = JSON.stringify({ nodeList, edgeList }); } catch { return null; }
  if (serialized.length > 1_000_000) return null;

  const normalizedNodes: GraphData["nodes"] = nodeList.filter(isRecord).map((node, index) => {
    const data = isRecord(node.data) ? node.data : {};
    const rawLabel = typeof node.label === "string" ? node.label : data.label;
    const label = typeof rawLabel === "string" ? rawLabel.slice(0, 160) : String(node.id ?? "Node " + (index + 1)).slice(0, 160);
    return {
      id: String(node.id ?? "node-" + index).slice(0, 120),
      label,
      data: { label },
    };
  });

  const nodeIds = new Set(normalizedNodes.map(node => node.id));
  if (nodeIds.size !== normalizedNodes.length) return null;

  const normalizedEdges: GraphData["edges"] = edgeList.filter(isRecord).map((edge, index) => ({
    id: String(edge.id ?? "edge-" + index).slice(0, 120),
    source: String(edge.source ?? "").slice(0, 120),
    target: String(edge.target ?? "").slice(0, 120),
    ...(typeof edge.label === "string" ? { label: edge.label.slice(0, 120) } : {}),
  })).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return { nodes: normalizedNodes, edges: normalizedEdges };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function KnowledgeGraph({
  nodes, edges, layout = "force", title, height = 420, interactive = true,
  selectedNodeId, setSelectedNodeId, onNodeSelect,
}: KnowledgeGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const previousSelectedNode = useRef<string | null>(null);
  const callbacks = useRef({ setSelectedNodeId, onNodeSelect });
  callbacks.current = { setSelectedNodeId, onNodeSelect };
  const data = normaliseGraphData(nodes, edges);

  useEffect(() => {
    const container = host.current;
    if (!container || !data) return;
    const instance = new Graph({
      container,
      width: container.clientWidth || 640,
      height: Math.max(220, Math.min(760, Number(height) || 420)),
      autoFit: "view",
      data: data as never,
      layout: {
        type: layout === "dagre" ? "dagre" : layout === "radial" ? "radial" : layout === "circular" ? "circular" : layout === "concentric" ? "concentric" : "force",
      },
      node: {
        style: {
          size: 36,
          labelText: (datum: Record<string, unknown>) => String(datum.label ?? datum.id ?? ""),
          labelPlacement: "bottom",
          labelMaxWidth: 140,
        },
      },
      edge: {
        style: {
          endArrow: true,
          labelText: (datum: Record<string, unknown>) => typeof datum.label === "string" ? datum.label : "",
        },
      },
      behaviors: interactive ? ["drag-canvas", "zoom-canvas", "drag-element", "click-select"] : [],
    });
    const handleNodeClick = (event: unknown) => {
      const target = (event as { target?: unknown }).target;
      const nodeId = target && typeof target === "object" && "id" in target ? String((target as { id?: unknown }).id ?? "") : "";
      if (!nodeId) return;
      callbacks.current.setSelectedNodeId?.(String(nodeId));
      callbacks.current.onNodeSelect?.();
    };
    if (interactive) instance.on(NodeEvent.CLICK, handleNodeClick);
    graph.current = instance;
    void instance.render();
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width > 0) instance.setSize(width, Math.max(220, Math.min(760, Number(height) || 420)));
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      instance.off(NodeEvent.CLICK, handleNodeClick);
      instance.destroy();
      if (graph.current === instance) graph.current = null;
    };
  }, [data, height, layout, interactive]);

  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    if (previousSelectedNode.current && previousSelectedNode.current !== selectedNodeId) {
      instance.setElementState(previousSelectedNode.current, []);
    }
    if (selectedNodeId) instance.setElementState(selectedNodeId, "selected");
    previousSelectedNode.current = selectedNodeId ?? null;
  }, [selectedNodeId]);

  if (!data) return <Alert type="warning" showIcon message="关系图数据格式无效，或节点/边数量超过限制。" />;
  return <section className="agent-knowledge-graph" style={{ width: "100%", minWidth: 0 }}>
    {title && <Typography.Title level={5} style={{ margin: "0 0 8px" }}>{title}</Typography.Title>}
    <div ref={host} role="img" aria-label={title || "知识关系图"} style={{ height: Math.max(220, Math.min(760, Number(height) || 420)), minWidth: 0, width: "100%" }} />
  </section>;
}
