import { describe, expect, it, vi } from "vitest";
import { canOpenScheduleBrowserPopup, clearScheduleBrowserProfileData, initializeScheduleBrowserContext, scheduleBrowserPartition } from "../src/main/schedule-browser-profile";

describe("Schedule Browser Context initialization", () => {
  it("disposes partially-created resources when initialization fails", async () => {
    const context = { window: "hidden-window", tabs: ["first-tab"] };
    const initialize = vi.fn(async () => { throw new Error("initial navigation setup failed"); });
    const dispose = vi.fn();

    await expect(initializeScheduleBrowserContext(context, initialize, dispose))
      .rejects.toThrow("initial navigation setup failed");
    expect(initialize).toHaveBeenCalledWith(context);
    expect(dispose).toHaveBeenCalledWith(context);
  });

  it("preserves the initialization error when best-effort disposal also fails", async () => {
    const originalError = new Error("addChildView failed");
    const initialize = async () => { throw originalError; };
    const dispose = vi.fn(() => { throw new Error("destroy failed"); });

    await expect(initializeScheduleBrowserContext({ id: "partial" }, initialize, dispose))
      .rejects.toBe(originalError);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Schedule Browser Profile reset", () => {
  it("clears site storage, HTTP cache and HTTP authentication cache before flushing", async () => {
    const calls: string[] = [];
    await clearScheduleBrowserProfileData({
      clearStorageData: async () => { calls.push("storage"); },
      clearCache: async () => { calls.push("cache"); },
      clearAuthCache: async () => { calls.push("auth"); },
      flushStorageData: () => { calls.push("flush"); },
    });
    expect(calls).toEqual(["storage", "cache", "auth", "flush"]);
  });
});

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
