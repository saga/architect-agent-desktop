import { useMemo } from "react";
import { Alert, Typography } from "antd";
import {
  Area, Bar, Column, DualAxes, Line, Pie, Radar, Rose, Sankey, Scatter, Treemap, Waterfall,
} from "@ant-design/charts";

export interface FinanceChartProps {
  chartType: string;
  data: unknown;
  title?: string;
  xField?: string;
  yField?: string;
  seriesField?: string;
  height?: number;
  options?: unknown;
}

const chartComponents: Record<string, React.ComponentType<Record<string, unknown>>> = {
  line: Line as React.ComponentType<Record<string, unknown>>,
  area: Area as React.ComponentType<Record<string, unknown>>,
  column: Column as React.ComponentType<Record<string, unknown>>,
  bar: Bar as React.ComponentType<Record<string, unknown>>,
  pie: Pie as React.ComponentType<Record<string, unknown>>,
  dualAxes: DualAxes as React.ComponentType<Record<string, unknown>>,
  scatter: Scatter as React.ComponentType<Record<string, unknown>>,
  radar: Radar as React.ComponentType<Record<string, unknown>>,
  rose: Rose as React.ComponentType<Record<string, unknown>>,
  treemap: Treemap as React.ComponentType<Record<string, unknown>>,
  waterfall: Waterfall as React.ComponentType<Record<string, unknown>>,
  sankey: Sankey as React.ComponentType<Record<string, unknown>>,
};

const HEIGHT_MIN = 180;
const HEIGHT_MAX = 720;
const MAX_DATA_POINTS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function FinanceChart(props: FinanceChartProps) {
  const config = useMemo(() => {
    if (!Array.isArray(props.data) || props.data.length > MAX_DATA_POINTS) {
      return { error: "图表数据必须是数组，最多 20,000 个数据点。" };
    }
    try {
      if (JSON.stringify(props.data).length > 1_000_000) return { error: "图表数据超过 1 MB，请先聚合或分页。" };
    } catch {
      return { error: "图表数据无法序列化。" };
    }
    const Component = chartComponents[props.chartType];
    if (!Component) return { error: "不支持的图表类型：" + props.chartType };
    const rawOptions = isRecord(props.options) ? props.options : {};
    if (JSON.stringify(rawOptions).length > 32_000) return { error: "图表配置超过 32 KB。" };
    const options = Object.fromEntries(Object.entries(rawOptions).filter(([key]) =>
      !/^(on|data$|height$|width$|container$|autoFit$|animation$|renderer$)/i.test(key)
    ));
    const height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Number(props.height) || 340));
    const base: Record<string, unknown> = {
      ...options,
      data: props.data,
      height,
      autoFit: true,
      animation: false,
    };
    if (props.xField) base.xField = props.xField;
    if (props.yField) base.yField = props.yField;
    if (props.seriesField) base.colorField = props.seriesField;
    return { Component, base };
  }, [props]);

  if ("error" in config) return <Alert type="warning" showIcon message={config.error} />;
  const Component = config.Component;
  return <section className="agent-finance-chart" style={{ minWidth: 0, width: "100%" }}>
    {props.title && <Typography.Title level={5} style={{ margin: "0 0 8px" }}>{props.title}</Typography.Title>}
    <Component {...config.base} />
  </section>;
}
