import { describe, expect, it } from "vitest";
import { findChromeExecutable } from "../src/main/chrome-browser";

describe("installed Google Chrome discovery", () => {
  it("detects the standard macOS application location", () => {
    const target = findChromeExecutable("darwin", { HOME: "/Users/test" }, candidate =>
      candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(target).toEqual({
      command: "/usr/bin/open",
      argsPrefix: ["-a", "/Applications/Google Chrome.app"],
    });
  });

  it("detects a per-user Windows installation", () => {
    const expected = "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const target = findChromeExecutable("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, candidate => candidate === expected);
    expect(target).toEqual({ command: expected, argsPrefix: [] });
  });

  it("detects the standard Linux installation and returns null when absent", () => {
    expect(findChromeExecutable("linux", {}, candidate => candidate === "/usr/bin/google-chrome-stable"))
      .toEqual({ command: "/usr/bin/google-chrome-stable", argsPrefix: [] });
    expect(findChromeExecutable("linux", {}, () => false)).toBeNull();
  });
});
