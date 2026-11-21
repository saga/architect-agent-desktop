import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import {
  BarChart, CandlestickChart, LineChart, PieChart, ScatterChart,
} from "echarts/charts";
import {
  AxisPointerComponent, DataZoomComponent, DatasetComponent, GridComponent,
  LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart, CandlestickChart, LineChart, PieChart, ScatterChart,
  AxisPointerComponent, DataZoomComponent, DatasetComponent, GridComponent,
  LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent, CanvasRenderer,
]);

export interface FinancialChartProps {
  option: EChartsOption | Record<string, unknown>;
  height?: number;
  label?: string;
}

function sanitizeOption(value: EChartsOption | Record<string, unknown>): EChartsOption {
  const serialized = JSON.stringify(value);
  if (serialized.length > 50_000) throw new Error("图表配置超过 50 KB。");
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  const sanitize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sanitize);
    if (!input || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (key === "formatter" || key === "extraCssText") continue;
      output[key] = sanitize(item);
    }
    return output;
  };
  const safe = sanitize(parsed) as Record<string, unknown>;
  if (safe.tooltip && typeof safe.tooltip === "object" && !Array.isArray(safe.tooltip)) {
    safe.tooltip = { ...(safe.tooltip as Record<string, unknown>), renderMode: "richText" };
  }
  return safe as EChartsOption;
}

export default function FinancialChart({ option, height = 360, label }: FinancialChartProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const safeOption = useMemo(() => sanitizeOption(option), [option]);
  const chartHeight = Math.max(220, Math.min(760, Number.isFinite(height) ? height : 360));

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas", useDirtyRect: true });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(safeOption, { notMerge: true, lazyUpdate: true });
  }, [safeOption]);

  return <figure className="agent-financial-chart" style={{ margin: 0, width: "100%" }} aria-label={label || "金融分析图表"}>
    {label && <figcaption style={{ fontWeight: 600, marginBottom: 8 }}>{label}</figcaption>}
    <div ref={elementRef} role="img" aria-label={label || "金融分析图表"} style={{ height: chartHeight, width: "100%", minWidth: 0 }} />
  </figure>;
}
