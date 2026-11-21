import { Catalog } from "@a2ui/web_core";
import type { ComponentApi } from "@a2ui/web_core";
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
    selectedNodeId: CommonSchemas.DynamicString.optional(),
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

export function createAgentFinanceCatalog(): Catalog<ComponentApi> {
  return new Catalog<ComponentApi>(
    FINANCE_A2UI_CATALOG_ID,
    "1.0",
    [...basicCatalog.components.values(), ...FINANCE_A2UI_COMPONENT_APIS] as ComponentApi[],
    [...basicCatalog.functions.values()],
    {
      themeSchema: basicCatalog.themeSchema,
      instructions: "Use FinanceChart for quantitative analysis. KnowledgeGraph is a read-only relationship view; when node selection should notify the Agent, bind selectedNodeId to a data-model @path and define onNodeSelect with an action.event context that references that same @path. WorkflowDiagram is for editable processes and lineage; bind graphData to a data-model @path, set editable=true, and define onSave with an action.event context containing graphData bound to that @path so the edited JSON is synchronized. Keep large datasets in the initial surface dataModel rather than duplicating them in component structure. Do not generate component code.",
    },
  );
}
