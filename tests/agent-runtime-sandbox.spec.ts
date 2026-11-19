import { describe, expect, it } from "vitest";
import { createWorkspaceCapabilityHandlers } from "../src/main/runtime/runtime-capabilities";

describe("workspace runtime capabilities", () => {
  it("exposes only explicitly granted capabilities", async () => {
    const handlers = createWorkspaceCapabilityHandlers();
    const context = { workspaceRoot: "/tmp/workspace", capabilities: new Set(["workspace.read" as const]) };
    await expect(handlers["workspace.write"]?.(context, { path: "a.txt", content: "x" }))
      .rejects.toThrow("Capability not granted: workspace.write");
  });
});
