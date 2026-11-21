import { useMemo } from "react";
import { Alert, Button, Card, Divider, Space, Statistic, Table, Typography } from "antd";
import { XCard, registerCatalog } from "@ant-design/x-card";
import type { ActionPayload, Catalog } from "@ant-design/x-card";
import FinancialChart from "./FinancialChart";
import { AGENT_A2UI_CATALOG_ID } from "../../shared/a2ui";

type DynamicProps = Record<string, any>;

const catalog = {
  catalogId: AGENT_A2UI_CATALOG_ID,
  components: {
    Column: { type: "object", properties: { gap: { type: "number" } } },
    Row: { type: "object", properties: { gap: { type: "number" } } },
    Card: { type: "object", properties: { title: { type: "string" } } },
    Text: { type: "object", properties: { text: { type: "string" }, variant: { enum: ["title", "heading", "body", "secondary"] } }, required: ["text"] },
    Metric: { type: "object", properties: { title: { type: "string" }, value: { type: ["string", "number"] }, suffix: { type: "string" }, precision: { type: "number" }, status: { enum: ["normal", "positive", "negative"] } }, required: ["title", "value"] },
    FinancialChart: { type: "object", properties: { label: { type: "string" }, height: { type: "number" }, option: { type: "object" } }, required: ["option"] },
    DataTable: { type: "object", properties: { columns: { type: "array" }, data: { type: "array" }, pageSize: { type: "number" } }, required: ["columns", "data"] },
    Divider: { type: "object", properties: { orientation: { enum: ["horizontal", "vertical"] } } },
  },
} as unknown as Catalog;

registerCatalog(catalog);

function Column({ children, gap = 12 }: DynamicProps) {
  return <div style={{ display: "flex", flexDirection: "column", gap: Math.max(4, Math.min(32, Number(gap) || 12)), minWidth: 0 }}>{children}</div>;
}

function Row({ children, gap = 12 }: DynamicProps) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: Math.max(4, Math.min(32, Number(gap) || 12)), minWidth: 0 }}>{children}</div>;
}

function Text({ text, variant = "body" }: DynamicProps) {
  if (variant === "title") return <Typography.Title level={3} style={{ margin: 0 }}>{String(text ?? "")}</Typography.Title>;
  if (variant === "heading") return <Typography.Title level={5} style={{ margin: 0 }}>{String(text ?? "")}</Typography.Title>;
  if (variant === "secondary") return <Typography.Text type="secondary">{String(text ?? "")}</Typography.Text>;
  return <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{String(text ?? "")}</Typography.Paragraph>;
}

function Metric({ title, value, suffix, precision, status = "normal" }: DynamicProps) {
  return <Card size="small" style={{ minWidth: 140, flex: "1 1 160px" }}>
    <Statistic title={String(title ?? "")} value={value ?? "—"} suffix={suffix}
      precision={typeof precision === "number" ? Math.max(0, Math.min(6, precision)) : undefined}
      valueStyle={status === "positive" ? { color: "#cf1322" } : status === "negative" ? { color: "#389e0d" } : undefined} />
  </Card>;
}

function DynamicCard({ children, title }: DynamicProps) {
  return <Card size="small" title={title ? String(title) : undefined}>{children}</Card>;
}

function DynamicChart(props: DynamicProps) {
  if (!props.option || typeof props.option !== "object" || Array.isArray(props.option)) {
    return <Alert type="warning" message="图表配置无效" />;
  }
  return <FinancialChart option={props.option} height={Number(props.height) || 360} label={props.label ? String(props.label) : undefined} />;
}

function DynamicTable({ columns, data, pageSize = 8 }: DynamicProps) {
  if (!Array.isArray(columns) || !Array.isArray(data)) return <Alert type="warning" message="表格数据无效" />;
  const safeColumns = columns.slice(0, 30).filter(column => column && typeof column === "object").map((column, index) => ({
    title: String(column.title ?? column.dataIndex ?? "Column " + (index + 1)).slice(0, 120),
    dataIndex: String(column.dataIndex ?? column.key ?? "column_" + index),
    key: String(column.key ?? column.dataIndex ?? index),
    ellipsis: true,
  }));
  const safeData = data.slice(0, 500).filter(row => row && typeof row === "object");
  return <Table size="small" pagination={{ pageSize: Math.max(1, Math.min(50, Number(pageSize) || 8)) }}
    columns={safeColumns} dataSource={safeData} rowKey={(row: Record<string, unknown>, index) => String(row.id ?? index)} />;
}

const components = {
  Column, Row, Card: DynamicCard, Text, Metric, FinancialChart: DynamicChart,
  DataTable: DynamicTable, Divider: () => <Divider style={{ margin: "6px 0" }} />,
} as Record<string, (props: DynamicProps) => React.ReactNode>;

interface AgentA2UICardProps {
  content: string;
  onAction?: (payload: ActionPayload) => void;
}

export default function AgentA2UICard({ content, onAction }: AgentA2UICardProps) {
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(content) as unknown;
      if (!Array.isArray(value)) throw new Error("A2UI commands 必须是数组。");
      const surfaceCommand = value.find(item => item && typeof item === "object" && "createSurface" in item) as { createSurface?: { surfaceId?: string } } | undefined;
      const surfaceId = surfaceCommand?.createSurface?.surfaceId;
      if (typeof surfaceId !== "string" || !surfaceId) throw new Error("A2UI Surface 缺失。");
      return { commands: value, surfaceId, error: "" };
    } catch (error) {
      return { commands: [], surfaceId: "", error: error instanceof Error ? error.message : String(error) };
    }
  }, [content]);

  if (parsed.error) return <Alert type="warning" showIcon message="无法渲染 Agent 卡片" description={parsed.error} />;
  return <div className="agent-a2ui-card">
    <XCard.Box
      commands={parsed.commands as never}
      onAction={(payload: ActionPayload) => onAction?.(payload)}
      components={components as never}
    >
      <XCard.Card id={parsed.surfaceId} />
    </XCard.Box>
  </div>;
}
