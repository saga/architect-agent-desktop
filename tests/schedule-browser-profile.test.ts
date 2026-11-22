import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canOpenScheduleBrowserPopup, cancelScheduleBrowserDownloads, clearScheduleBrowserProfileData, destroyScheduleBrowserProfileWindows, initializeScheduleBrowserContext, scheduleBrowserDownloadPath, scheduleBrowserDownloadsDirectory, scheduleBrowserPartition } from "../src/main/schedule-browser-profile";

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

  it("attempts every profile clear and flush step even if an earlier step fails", async () => {
    const calls: string[] = [];
    const originalError = new Error("cache clear failed");
    await expect(clearScheduleBrowserProfileData({
      clearStorageData: async () => { calls.push("storage"); },
      clearCache: async () => { calls.push("cache"); throw originalError; },
      clearAuthCache: async () => { calls.push("auth"); },
      flushStorageData: () => { calls.push("flush"); },
    })).rejects.toBe(originalError);
    expect(calls).toEqual(["storage", "cache", "auth", "flush"]);
  });

  it("destroys every Profile and OAuth popup window even if one destroy fails", () => {
    const first = { isDestroyed: () => false, destroy: vi.fn(() => { throw new Error("popup close failed"); }) };
    const second = { isDestroyed: () => false, destroy: vi.fn() };
    const third = { isDestroyed: () => true, destroy: vi.fn() };
    const failures = destroyScheduleBrowserProfileWindows([first, second, third, second]);
    expect(failures).toHaveLength(1);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(third.destroy).not.toHaveBeenCalled();
  });

  it("cancels all pending Profile downloads even if one cancellation fails", () => {
    const first = { cancel: vi.fn(() => { throw new Error("download cancel failed"); }) };
    const second = { cancel: vi.fn() };
    const failures = cancelScheduleBrowserDownloads([first, second, second]);
    expect(failures).toHaveLength(1);
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(second.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Schedule Browser download destinations", () => {
  it("isolates directories by Schedule and sanitizes remote filenames", () => {
    const root = path.resolve("downloads");
    const directoryA = scheduleBrowserDownloadsDirectory(root, "schedule-a");
    const directoryB = scheduleBrowserDownloadsDirectory(root, "schedule-b");
    const first = scheduleBrowserDownloadPath(directoryA, 1, "../../reports\\..\\secret?.pdf", 100);
    const second = scheduleBrowserDownloadPath(directoryB, 1, "../../reports\\..\\secret?.pdf", 100);

    expect(directoryA).not.toBe(directoryB);
    expect(first).not.toBe(second);
    expect(first.startsWith(directoryA + path.sep)).toBe(true);
    expect(first).not.toContain("schedule-a");
    expect(first).not.toContain("..\\");
    expect(first).toContain("100-1-");
    expect(first.endsWith("secret_.pdf")).toBe(true);
  });

  it("uses unique names and rejects invalid roots, identifiers and timestamps", () => {
    const directory = scheduleBrowserDownloadsDirectory(path.resolve("downloads"), "schedule-a");
    const first = scheduleBrowserDownloadPath(directory, 1, "report.pdf", 100);
    const second = scheduleBrowserDownloadPath(directory, 2, "report.pdf", 100);
    const third = scheduleBrowserDownloadPath(directory, 1, "report.pdf", 101);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(() => scheduleBrowserDownloadsDirectory("relative/downloads", "schedule-a")).toThrow("absolute path");
    expect(() => scheduleBrowserDownloadPath("relative/downloads", 1, "report.pdf", 100)).toThrow("absolute path");
    expect(() => scheduleBrowserDownloadPath(directory, -1, "report.pdf", 100)).toThrow("download ID");
    expect(() => scheduleBrowserDownloadPath(directory, 1, "report.pdf", -1)).toThrow("timestamp");
  });

  it("does not use Windows reserved device names", () => {
    const directory = scheduleBrowserDownloadsDirectory(path.resolve("downloads"), "schedule-a");
    const target = scheduleBrowserDownloadPath(directory, 1, "CON", 100);
    expect(target.toLowerCase()).toContain("100-1-_con");
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
