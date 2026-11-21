import { useEffect, useRef } from "react";
import { Alert, Typography } from "antd";
import { Graph } from "@antv/g6";

export interface KnowledgeGraphProps {
  nodes: unknown;
  edges?: unknown;
  layout?: string;
  title?: string;
  height?: number;
  interactive?: boolean;
  onNodeSelect?: () => void;
}

interface GraphData {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

function normaliseGraphData(nodes: unknown, edges: unknown): GraphData | null {
  const nodeList = Array.isArray(nodes) ? nodes : isRecord(nodes) && Array.isArray(nodes.nodes) ? nodes.nodes : null;
  const edgeList = Array.isArray(edges) ? edges : isRecord(nodes) && Array.isArray(nodes.edges) ? nodes.edges : [];
  if (!nodeList || nodeList.length > 5_000 || edgeList.length > 15_000) return null;
  const normalizedNodes = nodeList.filter(isRecord).map((node, index) => ({
    ...node,
    id: String(node.id ?? "node-" + index),
    data: isRecord(node.data) ? node.data : {},
  }));
  const normalizedEdges = edgeList.filter(isRecord).map((edge, index) => ({
    ...edge,
    id: String(edge.id ?? "edge-" + index),
    source: String(edge.source ?? ""),
    target: String(edge.target ?? ""),
  })).filter(edge => edge.source && edge.target);
  return { nodes: normalizedNodes, edges: normalizedEdges };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function KnowledgeGraph({ nodes, edges, layout = "force", title, height = 420 }: KnowledgeGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const data = normaliseGraphData(nodes, edges);

  useEffect(() => {
    const container = host.current;
    if (!container || !data) return;
    const instance = new Graph({
      container,
      width: container.clientWidth || 640,
      height: Math.max(220, Math.min(760, Number(height) || 420)),
      autoFit: "view",
      data,
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
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element", "click-select"],
    });
    graph.current = instance;
    void instance.render();
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width > 0) instance.setSize(width, Math.max(220, Math.min(760, Number(height) || 420)));
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      instance.destroy();
      if (graph.current === instance) graph.current = null;
    };
  }, [data, height, layout]);

  if (!data) return <Alert type="warning" showIcon message="关系图数据格式无效，或节点/边数量超过限制。" />;
  return <section className="agent-knowledge-graph" style={{ width: "100%", minWidth: 0 }}>
    {title && <Typography.Title level={5} style={{ margin: "0 0 8px" }}>{title}</Typography.Title>}
    <div ref={host} role="img" aria-label={title || "知识关系图"} style={{ height: Math.max(220, Math.min(760, Number(height) || 420)), minWidth: 0, width: "100%" }} />
  </section>;
}
