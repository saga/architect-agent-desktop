import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Typography } from "antd";
import { Graph, NodeEvent } from "@antv/g6";
import { normalizeKnowledgeGraphData } from "../graph-validation";

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


export default function KnowledgeGraph({
  nodes, edges, layout = "force", title, height = 420, interactive = true,
  selectedNodeId, setSelectedNodeId, onNodeSelect,
}: KnowledgeGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const previousSelectedNode = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const callbacks = useRef({ setSelectedNodeId, onNodeSelect });
  callbacks.current = { setSelectedNodeId, onNodeSelect };
  const data = useMemo(() => normalizeKnowledgeGraphData(nodes, edges), [nodes, edges]);

  useEffect(() => {
    const container = host.current;
    if (!container || !data) return;
    let instance: Graph | null = null;
    let resize: ResizeObserver | null = null;
    setRenderError(null);
    try {
      instance = new Graph({
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
        const nodeId = target && typeof target === "object" && "id" in target
          ? String((target as { id?: unknown }).id ?? "")
          : "";
        if (!nodeId) return;
        callbacks.current.setSelectedNodeId?.(nodeId);
        callbacks.current.onNodeSelect?.();
      };
      if (interactive) instance.on(NodeEvent.CLICK, handleNodeClick);
      graph.current = instance;
      void instance.render().catch(error => {
        if (graph.current === instance) {
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      });
      resize = new ResizeObserver(() => {
        const width = container.clientWidth;
        if (width > 0) instance?.setSize(width, Math.max(220, Math.min(760, Number(height) || 420)));
      });
      resize.observe(container);
    } catch (error) {
      resize?.disconnect();
      instance?.destroy();
      if (graph.current === instance) graph.current = null;
      setRenderError(error instanceof Error ? error.message : String(error));
      return;
    }
    return () => {
      resize?.disconnect();
      if (instance) {
        instance.off(NodeEvent.CLICK);
        instance.destroy();
      }
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
  }, [selectedNodeId, data]);

  if (!data) return <Alert type="warning" showIcon message="关系图数据格式无效，或节点/边数量超过限制。" />;
  if (renderError) return <Alert type="error" showIcon message="G6 图初始化失败" description={renderError} />;
  return <section className="agent-knowledge-graph" style={{ width: "100%", minWidth: 0 }}>
    {title && <Typography.Title level={5} style={{ margin: "0 0 8px" }}>{title}</Typography.Title>}
    <div ref={host} role="img" aria-label={title || "知识关系图"} style={{ height: Math.max(220, Math.min(760, Number(height) || 420)), minWidth: 0, width: "100%" }} />
  </section>;
}
