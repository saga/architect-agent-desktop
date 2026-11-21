import { createComponentImplementation } from "@a2ui/react";
import type { ReactCatalogComponent } from "@a2ui/react";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { Catalog } from "@a2ui/web_core";
import { FinanceChartApi, KnowledgeGraphApi, WorkflowDiagramApi, FINANCE_A2UI_CATALOG_ID } from "../../shared/a2ui-finance-catalog";
import FinanceChart from "../components/FinanceChart";
import KnowledgeGraph from "../components/KnowledgeGraph";
import WorkflowDiagram from "../components/WorkflowDiagram";

const FinanceChartImplementation = createComponentImplementation(
  FinanceChartApi,
  ({ props }) => <FinanceChart {...props} />,
);

const KnowledgeGraphImplementation = createComponentImplementation(
  KnowledgeGraphApi,
  ({ props }) => <KnowledgeGraph {...props} />,
);

const WorkflowDiagramImplementation = createComponentImplementation(
  WorkflowDiagramApi,
  ({ props }) => <WorkflowDiagram
    {...props}
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

export const financeRendererCatalog = basicCatalog.copyWith({
  catalogId: FINANCE_A2UI_CATALOG_ID,
  components: implementations,
}) as unknown as Catalog<ReactCatalogComponent>;
