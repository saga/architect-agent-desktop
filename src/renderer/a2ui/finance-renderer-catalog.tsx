import { createComponentImplementation } from "@a2ui/react";
import type { ReactCatalogComponent } from "@a2ui/react";
import type { FinanceChartProps } from "../components/FinanceChart";
import type { KnowledgeGraphProps } from "../components/KnowledgeGraph";
import type { WorkflowDiagramProps } from "../components/WorkflowDiagram";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { Catalog } from "@a2ui/web_core";
import type { Catalog } from "@a2ui/web_core";
import { FinanceChartApi, KnowledgeGraphApi, WorkflowDiagramApi, FINANCE_A2UI_CATALOG_ID } from "../../shared/a2ui-finance-catalog";
import FinanceChart from "../components/FinanceChart";
import KnowledgeGraph from "../components/KnowledgeGraph";
import WorkflowDiagram from "../components/WorkflowDiagram";

const FinanceChartImplementation = createComponentImplementation(
  FinanceChartApi,
  ({ props }) => <FinanceChart {...(props as unknown as FinanceChartProps)} />,
);

const KnowledgeGraphImplementation = createComponentImplementation(
  KnowledgeGraphApi,
  ({ props }) => <KnowledgeGraph {...(props as unknown as KnowledgeGraphProps)} />,
);

const WorkflowDiagramImplementation = createComponentImplementation(
  WorkflowDiagramApi,
  ({ props }) => <WorkflowDiagram
    {...(props as unknown as WorkflowDiagramProps)}
    onChange={(json) => {
      props.setGraphData?.(json);
      props.onChange?.();
    }}
    onSave={() => props.onSave?.()}
  />,
);

const implementations: ReactCatalogComponent[] = [
  ...basicCatalog.components.values(),
  FinanceChartImplementation,
  KnowledgeGraphImplementation,
  WorkflowDiagramImplementation,
];

export const financeRendererCatalog = new Catalog<ReactCatalogComponent>(
  FINANCE_A2UI_CATALOG_ID,
  "1.0",
  implementations,
  [...basicCatalog.functions.values()],
  {
    themeSchema: basicCatalog.themeSchema,
    instructions: "Use FinanceChart for statistical/financial charts, KnowledgeGraph for relationship networks, and WorkflowDiagram for editable processes and lineage.",
  },
) as unknown as Catalog<ReactCatalogComponent>;
