import { useEffect, useMemo, useRef } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { Graph } from "@antv/x6";

export interface WorkflowDiagramProps {
  graphData: unknown;
  title?: string;
  height?: number;
  editable?: boolean;
  onChange?: (json: Record<string, unknown>) => void;
  onSave?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function containsUnsafeValue(value: unknown, depth = 0): boolean {
  if (depth > 10) return true;
  if (typeof value === "string") return /javascript:|data:text\/html|<script\b|<foreignObject\b/i.test(value);
  if (Array.isArray(value)) return value.length > 500 || value.some(item => containsUnsafeValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    /^(on[a-z]+|html|foreignObject|href|xlink:href)$/i.test(key) || containsUnsafeValue(item, depth + 1)
  );
}

function validateGraphJson(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  let encoded = "";
  try { encoded = JSON.stringify(input); } catch { return null; }
  if (encoded.length > 1_000_000 || containsUnsafeValue(input)) return null;
  const cells = Array.isArray(input.cells) ? input.cells : null;
  if (!cells || cells.length > 2_000) return null;
  const allowedShapes = new Set(["edge", "rect", "circle", "ellipse", "polygon"]);
  const ids = new Set<string>();
  for (const cell of cells) {
    if (!isRecord(cell) || typeof cell.id !== "string" || cell.id.length < 1 || cell.id.length > 120 ||
        typeof cell.shape !== "string" || !allowedShapes.has(cell.shape) || ids.has(cell.id)) return null;
    ids.add(cell.id);
  }
  for (const cell of cells) {
    if (!isRecord(cell) || cell.shape !== "edge") continue;
    const source = isRecord(cell.source) ? cell.source.cell : undefined;
    const target = isRecord(cell.target) ? cell.target.cell : undefined;
    if (typeof source === "string" && !ids.has(source)) return null;
    if (typeof target === "string" && !ids.has(target)) return null;
  }
  return input;
}

export default function WorkflowDiagram({ graphData, title, height = 440, editable = false, onChange, onSave }: WorkflowDiagramProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const serialized = useMemo(() => validateGraphJson(graphData), [graphData]);
  const safeHeight = Math.max(220, Math.min(760, Number(height) || 440));

  useEffect(() => {
    const container = host.current;
    if (!container || !serialized) return;
    const instance = new Graph({
      container,
      width: container.clientWidth || 640,
      height: safeHeight,
      grid: { visible: true, size: 10 },
      background: { color: "transparent" },
      interacting: Boolean(editable),
      connecting: { router: "manhattan", connector: "rounded", allowBlank: false },
      panning: { enabled: true },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"] },
    });
    instance.fromJSON(serialized);
    instance.centerContent();
    graph.current = instance;
    const changed = () => {
      if (editable) onChange?.(instance.toJSON() as unknown as Record<string, unknown>);
    };
    instance.on("cell:added", changed);
    instance.on("cell:removed", changed);
    instance.on("cell:changed", changed);
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width > 0) instance.resize(width, safeHeight);
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      instance.off("cell:added", changed);
      instance.off("cell:removed", changed);
      instance.off("cell:changed", changed);
      instance.dispose();
      if (graph.current === instance) graph.current = null;
    };
  }, [serialized, safeHeight, editable, onChange]);

  if (!serialized) return <Alert type="warning" showIcon message="X6 图数据无效，或节点数量超过 2,000。" />;
  return <section className="agent-workflow-diagram" style={{ width: "100%", minWidth: 0 }}>
    <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
      {title ? <Typography.Title level={5} style={{ margin: 0 }}>{title}</Typography.Title> : <span />}
      {editable && <Button size="small" onClick={() => onSave?.()}>保存图</Button>}
    </Space>
    <div ref={host} role="img" aria-label={title || "流程图"} style={{ height: safeHeight, width: "100%", minWidth: 0, border: "1px solid var(--ant-color-border-secondary)", borderRadius: 8, overflow: "hidden" }} />
  </section>;
}
