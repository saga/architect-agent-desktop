import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Empty, Space, Tag, Typography } from "antd";
import { A2uiSurface } from "@a2ui/react";
import { injectStyles } from "@a2ui/react/styles";
import { MessageProcessor } from "@a2ui/web_core";
import type { SurfaceModel } from "@a2ui/web_core";
import type { ReactCatalogComponent } from "@a2ui/react";
import type { AgentToRendererMessage } from "@a2ui/agent";
type RendererAction = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  userMessage?: string;
  metadata?: { extensions?: Record<string, unknown> };
};
export type RendererToAgentMessage = { version: "1.0"; action: RendererAction };
import { financeRendererCatalog } from "./finance-renderer-catalog";

export interface A2UIV1CanvasProps {
  taskId?: string;
  messages: string[];
  onRendererMessage?: (message: RendererToAgentMessage) => void;
  title?: string;
}

export default function A2UIV1Canvas({ taskId, messages, onRendererMessage, title = "交互式分析" }: A2UIV1CanvasProps) {
  const [surfaces, setSurfaces] = useState<Array<SurfaceModel<ReactCatalogComponent>>>([]);
  const [generation, setGeneration] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const onRendererMessageRef = useRef(onRendererMessage);
  const processedCount = useRef(0);
  onRendererMessageRef.current = onRendererMessage;
  const processor = useMemo(() => new MessageProcessor<ReactCatalogComponent>(
    [financeRendererCatalog],
    (action) => {
      onRendererMessageRef.current?.({ version: "1.0", action: action as unknown as RendererAction });
    },
    {
      version: "1.0",
      errorHandler: (error) => {
        setErrors(current => [...current.slice(-4), error.error?.message ?? "A2UI 1.0 渲染失败"]);
      },
    },
  ), [generation]);

  const refreshSurfaces = useCallback(() => {
    const nextSurfaces = [...processor.model.surfacesMap.values()];
    setSurfaces(nextSurfaces);
    // A canvas can mount before a Task is selected, and React may deliver a
    // final surface update while the previous Task is being unmounted.
    // Never invent a task ID or register against a different active Task.
    if (!taskId) return;
    void window.browser.agentA2uiRegisterSurfaces(taskId, nextSurfaces.map(surface => surface.id)).catch(() => undefined);
  }, [processor, taskId]);

  useEffect(() => {
    injectStyles();
  }, []);

  useEffect(() => {
    const created = processor.onSurfaceCreated(refreshSurfaces);
    const deleted = processor.onSurfaceDeleted(refreshSurfaces);
    refreshSurfaces();
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
      processor.dispose();
    };
  }, [processor, refreshSurfaces]);

  useEffect(() => {
    if (messages.length < processedCount.current) {
      processedCount.current = 0;
      setSurfaces([]);
      setErrors([]);
      setGeneration(value => value + 1);
      return;
    }
    const pending = messages.slice(processedCount.current);
    for (const payload of pending) {
      try {
        const parsed = JSON.parse(payload) as AgentToRendererMessage[];
        if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("A2UI 1.0 消息必须是最多 100 条消息的数组。");
        const result = processor.processMessagesWithErrors(parsed);
        if (result.length) {
          setErrors(current => [...current, ...result.map(error => error.error?.message ?? "A2UI 消息校验失败")].slice(-5));
        }
      } catch (error) {
        setErrors(current => [...current.slice(-4), error instanceof Error ? error.message : String(error)]);
      }
    }
    processedCount.current = messages.length;
    refreshSurfaces();
  }, [messages, processor, refreshSurfaces]);

  if (!messages.length && !surfaces.length) return null;
  return <section className="agent-a2ui-v1-canvas" style={{ display: "grid", gap: 12, minWidth: 0 }}>
    <Space>
      <Typography.Text strong>{title}</Typography.Text>
      <Tag color="blue">A2UI 1.0</Tag>
      <Tag>{surfaces.length} 个界面</Tag>
    </Space>
    {errors.map((error, index) => <Alert key={index} type="warning" showIcon message={error} />)}
    {surfaces.length
      ? surfaces.map(surface => <div className="agent-a2ui-v1-surface" key={surface.id}>
          <A2uiSurface surface={surface} />
        </div>)
      : <Empty description="尚无可显示的 A2UI Surface" />}
  </section>;
}
