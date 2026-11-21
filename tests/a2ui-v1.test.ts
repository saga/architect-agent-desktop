import { describe, expect, it } from "vitest";
import { AgentA2UIService } from "../src/main/a2ui-service";

describe("A2UI 1.0 Agent message handling", () => {
  it("accepts a schema-valid user action only from a registered Task Surface", async () => {
    const service = new AgentA2UIService();
    service.registerSurfaces("task-session-1", ["portfolio-surface"]);

    const result = await service.validateRendererMessage({
      version: "1.0",
      action: {
        name: "show_holdings",
        surfaceId: "portfolio-surface",
        sourceComponentId: "holdings-button",
        timestamp: "2026-11-21T12:00:00.000Z",
        context: { portfolioId: "portfolio-1" },
      },
    }, "task-session-1");

    expect(result).toEqual({ handled: false, replies: [] });
  });

  it("rejects an action that targets a Surface outside the active Task", async () => {
    const service = new AgentA2UIService();
    service.registerSurfaces("task-session-1", ["portfolio-surface"]);

    await expect(service.validateRendererMessage({
      version: "1.0",
      action: {
        name: "show_holdings",
        surfaceId: "another-tasks-surface",
        sourceComponentId: "holdings-button",
        timestamp: "2026-11-21T12:00:00.000Z",
        context: {},
      },
    }, "task-session-1")).rejects.toThrow(/not created in this Agent Task/);
  });

  it("rejects malformed A2UI 1.0 action envelopes using the official schema", async () => {
    const service = new AgentA2UIService();
    service.registerSurfaces("task-session-1", ["portfolio-surface"]);

    await expect(service.validateRendererMessage({
      version: "1.0",
      action: {
        name: "show_holdings",
        surfaceId: "portfolio-surface",
        context: {},
      },
    }, "task-session-1")).rejects.toThrow(/Invalid A2UI 1.0 Renderer-to-Agent message/);
  });

  it("does not allow an action from another Task session even when the Surface ID matches", async () => {
    const service = new AgentA2UIService();
    service.registerSurfaces("task-session-1", ["portfolio-surface"]);
    service.registerSurfaces("task-session-2", []);

    await expect(service.validateRendererMessage({
      version: "1.0",
      action: {
        name: "show_holdings",
        surfaceId: "portfolio-surface",
        sourceComponentId: "holdings-button",
        timestamp: "2026-11-21T12:00:00.000Z",
        context: {},
      },
    }, "task-session-2")).rejects.toThrow(/not created in this Agent Task/);
  });
});
