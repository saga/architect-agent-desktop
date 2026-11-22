import { describe, expect, it } from "vitest";
import { scheduleBrowserPartition } from "../src/main/schedule-browser-profile";

describe("Schedule Browser Profile identity", () => {
  it("creates a stable persistent partition for each Schedule", () => {
    expect(scheduleBrowserPartition("schedule-a")).toBe(scheduleBrowserPartition("schedule-a"));
    expect(scheduleBrowserPartition("schedule-a")).not.toBe(scheduleBrowserPartition("schedule-b"));
  });

  it("does not expose Schedule IDs or accept empty identifiers in partition names", () => {
    const partition = scheduleBrowserPartition("customer/research?prod");
    expect(partition).toMatch(/^persist:architect-agent-schedule-[a-f0-9]{32}$/);
    expect(partition).not.toContain("customer");
    expect(() => scheduleBrowserPartition(" ")).toThrow("valid Schedule ID");
  });
});
