import { Catalog } from "@a2ui/web_core";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { CommonSchemas } from "@a2ui/web_core/v1_0";
import { z } from "zod3";

export const FINANCE_A2UI_CATALOG_ID =
  "https://architect-agent-desktop.local/a2ui/catalog/finance/1.0";

export const FinanceChartApi = {
  name: "FinanceChart",
  schema: z.object({
    chartType: z.enum([
      "line", "area", "column", "bar", "pie", "dualAxes",
      "scatter", "radar", "rose", "treemap", "waterfall", "sankey",
    ]),
    data: CommonSchemas.DynamicValue,
    title: CommonSchemas.DynamicString.optional(),
    xField: CommonSchemas.DynamicString.optional(),
    yField: CommonSchemas.DynamicString.optional(),
    seriesField: CommonSchemas.DynamicString.optional(),
    height: CommonSchemas.DynamicNumber.optional(),
    options: CommonSchemas.DynamicValue.optional(),
  }).strict(),
};

export const KnowledgeGraphApi = {
  name: "KnowledgeGraph",
  schema: z.object({
    nodes: CommonSchemas.DynamicValue,
    edges: CommonSchemas.DynamicValue.optional(),
    layout: z.enum(["force", "dagre", "radial", "circular", "concentric"]).optional(),
    title: CommonSchemas.DynamicString.optional(),
    height: CommonSchemas.DynamicNumber.optional(),
    interactive: CommonSchemas.DynamicBoolean.optional(),
    onNodeSelect: CommonSchemas.Action.optional(),
  }).strict(),
};

export const WorkflowDiagramApi = {
  name: "WorkflowDiagram",
  schema: z.object({
    graphData: CommonSchemas.DynamicValue,
    title: CommonSchemas.DynamicString.optional(),
    height: CommonSchemas.DynamicNumber.optional(),
    editable: CommonSchemas.DynamicBoolean.optional(),
    onChange: CommonSchemas.Action.optional(),
    onSave: CommonSchemas.Action.optional(),
  }).strict(),
};

export const FINANCE_A2UI_COMPONENT_APIS = [
  FinanceChartApi,
  KnowledgeGraphApi,
  WorkflowDiagramApi,
] as const;

export type FinanceA2UIComponentName =
  | "FinanceChart"
  | "KnowledgeGraph"
  | "WorkflowDiagram";

export function createAgentFinanceCatalog(): Catalog {
  return basicCatalog.copyWith({
    catalogId: FINANCE_A2UI_CATALOG_ID,
    components: [
      ...basicCatalog.components.values(),
      ...FINANCE_A2UI_COMPONENT_APIS,
    ],
  });
}

export function createFinanceCatalogWithImplementations<T extends { name: string }>(
  implementations: T[],
): Catalog<T> {
  return basicCatalog.copyWith({
    catalogId: FINANCE_A2UI_CATALOG_ID,
    components: [
      ...basicCatalog.components.values(),
      ...implementations,
    ] as T[],
  });
}
