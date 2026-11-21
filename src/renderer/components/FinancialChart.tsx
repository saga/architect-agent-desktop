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
  const parsed = JSON.parse(serialized) as EChartsOption;
  const escapeText = (input: unknown): unknown => {
    if (typeof input === "string") return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (Array.isArray(input)) return input.map(escapeText);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, escapeText(item)]));
    return input;
  };
  return escapeText(parsed) as EChartsOption;
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
