import { describe, expect, it } from "vitest";
import { isAgentOperationBusy } from "../src/main/agent-operation-policy";

describe("Agent operation conflict policy", () => {
  const idle = {
    scheduleRunnerActive: false,
    maintenanceOperationPending: false,
    agentRequestPending: false,
    taskActivationPending: false,
    providerBusy: false,
  };
  it("allows operations only when every shared owner is idle", () => {
    expect(isAgentOperationBusy(idle)).toBe(false);
  });
  it.each([
    "scheduleRunnerActive",
    "maintenanceOperationPending",
    "agentRequestPending",
    "taskActivationPending",
    "providerBusy",
  ] as const)("blocks conflicting writes while %s is active", (flag) => {
    expect(isAgentOperationBusy({ ...idle, [flag]: true })).toBe(true);
  });
});
