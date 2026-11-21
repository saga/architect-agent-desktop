import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { Graph } from "@antv/x6";
import { validateWorkflowGraphJson } from "../graph-validation";

export interface WorkflowDiagramProps {
  graphData: unknown;
  title?: string;
  height?: number;
  editable?: boolean;
  onSave?: (json: Record<string, unknown>) => void;
}


export default function WorkflowDiagram({ graphData, title, height = 440, editable = false, onSave }: WorkflowDiagramProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const serialized = useMemo(() => validateWorkflowGraphJson(graphData), [graphData]);
  const safeHeight = Math.max(220, Math.min(760, Number(height) || 440));

  useEffect(() => {
    const container = host.current;
    if (!container || !serialized) return;
    let instance: Graph | null = null;
    let resize: ResizeObserver | null = null;
    setRenderError(null);
    try {
      instance = new Graph({
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
      resize = new ResizeObserver(() => {
        const width = container.clientWidth;
        if (width > 0) instance?.resize(width, safeHeight);
      });
      resize.observe(container);
    } catch (error) {
      resize?.disconnect();
      instance?.dispose();
      if (graph.current === instance) graph.current = null;
      setRenderError(error instanceof Error ? error.message : String(error));
      return;
    }
    return () => {
      resize?.disconnect();
      instance?.dispose();
      if (graph.current === instance) graph.current = null;
    };
  }, [serialized, safeHeight, editable]);


  if (!serialized) return <Alert type="warning" showIcon message="X6 图数据无效、包含不安全内容，或超过节点/大小限制。" />;
  if (renderError) return <Alert type="error" showIcon message="X6 画布初始化失败" description={renderError} />;
  return <section className="agent-workflow-diagram" style={{ width: "100%", minWidth: 0 }}>
    <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
      {title ? <Typography.Title level={5} style={{ margin: 0 }}>{title}</Typography.Title> : <span />}
      {editable && <Button size="small" onClick={() => {
        const current = graph.current?.toJSON() as unknown;
        const safe = validateWorkflowGraphJson(current);
        if (safe) onSave?.(safe);
        else setRenderError("编辑后的图数据未通过安全校验，未提交给 Agent。");
      }}>保存图</Button>}
    </Space>
    <div ref={host} role="img" aria-label={title || "流程图"} style={{ height: safeHeight, width: "100%", minWidth: 0, border: "1px solid var(--ant-color-border-secondary)", borderRadius: 8, overflow: "hidden" }} />
  </section>;
}
