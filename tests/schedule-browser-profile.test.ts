import { describe, expect, it } from "vitest";
import { canOpenScheduleBrowserPopup, scheduleBrowserPartition } from "../src/main/schedule-browser-profile";

describe("Schedule Browser Profile identity", () => {
  it("creates a stable persistent partition for each Schedule", () => {
    expect(scheduleBrowserPartition("schedule-a")).toBe(scheduleBrowserPartition("schedule-a"));
    expect(scheduleBrowserPartition("schedule-a")).not.toBe(scheduleBrowserPartition("schedule-b"));
  });

  it("allows only safe popup URLs with bounded nesting", () => {
    expect(canOpenScheduleBrowserPopup(true, 0)).toBe(true);
    expect(canOpenScheduleBrowserPopup(true, 2)).toBe(true);
    expect(canOpenScheduleBrowserPopup(false, 0)).toBe(false);
    expect(canOpenScheduleBrowserPopup(true, 3)).toBe(false);
    expect(canOpenScheduleBrowserPopup(true, -1)).toBe(false);
  });

  it("does not expose Schedule IDs or accept empty identifiers in partition names", () => {
    const partition = scheduleBrowserPartition("customer/research?prod");
    expect(partition).toMatch(/^persist:architect-agent-schedule-[a-f0-9]{32}$/);
    expect(partition).not.toContain("customer");
    expect(() => scheduleBrowserPartition(" ")).toThrow("valid Schedule ID");
  });
});
