import { describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedAppUrl } from "../src/main/app-url-policy";

describe("trusted application URL policy", () => {
  const renderer = path.resolve("/opt/app/dist/renderer/index.html");
  it("accepts only the configured development origin", () => {
    expect(isTrustedAppUrl("http://127.0.0.1:5173/?agent-panel=1", renderer, "http://127.0.0.1:5173")).toBe(true);
    expect(isTrustedAppUrl("http://127.0.0.1:5174/", renderer, "http://127.0.0.1:5173")).toBe(false);
    expect(isTrustedAppUrl("https://evil.example/", renderer, "http://127.0.0.1:5173")).toBe(false);
  });
  it("accepts only the packaged renderer entry file", () => {
    expect(isTrustedAppUrl(pathToFileURL(renderer).href + "?agent-settings=1", renderer)).toBe(true);
    expect(isTrustedAppUrl("https://evil.example/", renderer)).toBe(false);
    expect(isTrustedAppUrl(pathToFileURL(path.join(path.dirname(renderer), "other.html")).href, renderer)).toBe(false);
  });
});
