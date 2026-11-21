import { describe, expect, it } from "vitest";
import { AGENT_A2UI_CATALOG_ID, validateAgentA2UICommands } from "../src/shared/a2ui";

const validCommands = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "portfolio-report", catalogId: AGENT_A2UI_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "portfolio-report",
      components: [
        { id: "root", component: "Column", children: ["headline", "chart", "details"] },
        { id: "headline", component: "Text", text: "Portfolio performance", variant: "title" },
        { id: "chart", component: "FinancialChart", option: { xAxis: { type: "category" }, series: [{ type: "line", data: [1, 2, 3] }] } },
        { id: "details", component: "Button", text: "Show holdings", action: { event: { name: "show_holdings" } } },
      ],
    },
  },
];

describe("Agent A2UI catalog validation", () => {
  it("accepts valid v0.9 financial report cards", () => {
    expect(validateAgentA2UICommands(validCommands)).toEqual(validCommands);
  });

  it("rejects an unknown component instead of rendering arbitrary UI", () => {
    const commands = structuredClone(validCommands);
    const components = (commands[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
    components[1]!.component = "RawHTML";
    expect(() => validateAgentA2UICommands(commands)).toThrow(/白名单 Catalog/);
  });

  it("rejects buttons without a named action", () => {
    const commands = structuredClone(validCommands);
    const components = (commands[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
    components[3]!.action = {};
    expect(() => validateAgentA2UICommands(commands)).toThrow(/action.event.name/);
  });

  it("rejects prototype-polluting data-model paths", () => {
    const commands = [
      ...validCommands,
      { version: "v0.9", updateDataModel: { surfaceId: "portfolio-report", path: "/__proto__/polluted", value: true } },
    ];
    expect(() => validateAgentA2UICommands(commands)).toThrow(/不允许的对象属性/);
  });
});
