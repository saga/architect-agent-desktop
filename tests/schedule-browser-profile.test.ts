import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canOpenScheduleBrowserPopup, clearScheduleBrowserProfileData, initializeScheduleBrowserContext, scheduleBrowserDownloadPath, scheduleBrowserPartition } from "../src/main/schedule-browser-profile";

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

describe("Schedule Browser download destinations", () => {
  it("isolates downloads by Schedule and sanitizes remote filenames", () => {
    const root = path.resolve("downloads");
    const first = scheduleBrowserDownloadPath(root, "schedule-a", "../../reports\\..\\secret?.pdf", "run-1");
    const second = scheduleBrowserDownloadPath(root, "schedule-b", "../../reports\\..\\secret?.pdf", "run-1");

    expect(first).not.toBe(second);
    expect(first.startsWith(path.join(root, "Architect Agent Desktop", "Schedules") + path.sep)).toBe(true);
    expect(first).not.toContain("schedule-a");
    expect(first).not.toContain("..\\");
    expect(first).toContain("run-1-");
    expect(first.endsWith("secret_.pdf")).toBe(true);
  });

  it("uses unique names and rejects invalid roots or download identifiers", () => {
    const root = path.resolve("downloads");
    const first = scheduleBrowserDownloadPath(root, "schedule-a", "report.pdf", "run-1");
    const second = scheduleBrowserDownloadPath(root, "schedule-a", "report.pdf", "run-2");
    expect(first).not.toBe(second);
    expect(() => scheduleBrowserDownloadPath("relative/downloads", "schedule-a", "report.pdf", "run-1")).toThrow("absolute path");
    expect(() => scheduleBrowserDownloadPath(root, "schedule-a", "report.pdf", "../escape")).toThrow("download identifier");
  });

  it("does not use Windows reserved device names", () => {
    const target = scheduleBrowserDownloadPath(path.resolve("downloads"), "schedule-a", "CON", "run-1");
    expect(target.toLowerCase()).toContain("run-1-_con");
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
