export const AGENT_A2UI_CATALOG_ID = "architect-agent-desktop://catalog/finance/v1";
export const AGENT_A2UI_COMPONENTS = [
  "Column", "Row", "Card", "Text", "Metric", "FinancialChart", "DataTable", "Divider", "Button",
] as const;

export type AgentA2UICommand = Record<string, unknown>;

const allowedOperations = new Set(["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]);
const allowedComponentSet = new Set<string>(AGENT_A2UI_COMPONENTS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export function validateAgentA2UICommands(input: unknown): AgentA2UICommand[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("A2UI commands 必须是 1–100 条消息的数组。");
  }
  const serialized = JSON.stringify(input);
  if (serialized.length > 80_000) throw new Error("A2UI payload 超过 80 KB。");
  let createdSurface: string | null = null;
  const result: AgentA2UICommand[] = [];
  for (const raw of input) {
    if (!isRecord(raw) || raw.version !== "v0.9") throw new Error("只接受 A2UI v0.9 命令。");
    const operationKeys = Object.keys(raw).filter(key => allowedOperations.has(key));
    if (operationKeys.length !== 1) throw new Error("每条 A2UI 消息只能包含一个协议操作。");
    const operation = operationKeys[0]!;
    const payload = raw[operation];
    if (!isRecord(payload)) throw new Error("A2UI 操作参数必须是对象。");
    if (operation === "createSurface") {
      if (!boundedString(payload.surfaceId, 80) || payload.catalogId !== AGENT_A2UI_CATALOG_ID) {
        throw new Error("A2UI Surface 必须使用 Architect Agent Finance Catalog。");
      }
      createdSurface = payload.surfaceId;
    } else {
      if (!boundedString(payload.surfaceId, 80) || (createdSurface && payload.surfaceId !== createdSurface)) {
        throw new Error("A2UI 命令引用了无效 Surface。");
      }
      if (operation === "updateComponents") {
        if (!Array.isArray(payload.components) || payload.components.length > 80) throw new Error("A2UI 单个 Surface 最多包含 80 个组件。");
        for (const component of payload.components) {
          if (!isRecord(component) || !boundedString(component.id, 80) || !allowedComponentSet.has(String(component.component))) {
            throw new Error("A2UI 组件未包含在本地白名单 Catalog 中。");
          }
          if (component.children !== undefined && (!Array.isArray(component.children) || component.children.length > 80 || !component.children.every(child => boundedString(child, 80)))) {
            throw new Error("A2UI children 格式无效。");
          }
          if (component.component === "FinancialChart") {
            if (!isRecord(component.option)) throw new Error("FinancialChart 必须包含 JSON ECharts option。");
            if (JSON.stringify(component.option).length > 50_000) throw new Error("FinancialChart option 超过 50 KB。");
          }
          if (component.component === "Button") {
            if (!isRecord(component.action) || !isRecord(component.action.event) || !boundedString(component.action.event.name, 80)) {
              throw new Error("A2UI Button 必须定义有限长度的 action.event.name。");
            }
          }
        }
      }
      if (operation === "updateDataModel") {
        if (!boundedString(payload.path, 500) || !("value" in payload)) {
          throw new Error("A2UI updateDataModel 必须包含 path 和 value。");
        }
        const segments = payload.path.split("/").filter(Boolean);
        if (segments.some(segment => segment === "__proto__" || segment === "prototype" || segment === "constructor")) {
          throw new Error("A2UI data model path 包含不允许的对象属性。");
        }
      }
    }
    result.push(raw);
  }
  const components = result.flatMap(command => {
    if (!isRecord(command.updateComponents) || !Array.isArray(command.updateComponents.components)) return [];
    return command.updateComponents.components.filter(isRecord);
  });
  const ids = new Set(components.map(component => String(component.id)));
  if (!ids.has("root")) throw new Error("A2UI Surface 必须包含 id 为 root 的根组件。");
  for (const component of components) {
    if (Array.isArray(component.children) && component.children.some(child => !ids.has(String(child)))) {
      throw new Error("A2UI 组件引用了不存在的 children id。");
    }
  }
  if (!result.some(command => isRecord(command.createSurface))) throw new Error("A2UI v0.9 必须先创建 Surface。");
  return result;
}
