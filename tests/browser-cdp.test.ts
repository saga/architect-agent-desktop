import { describe, expect, it } from "vitest";
import { isAllowedCdpMethod } from "../src/main/browser-cdp";

describe("Browser CDP public diagnostics allowlist", () => {
  it("allows read-only inspection methods", () => {
    for (const method of [
      "Page.captureScreenshot", "Page.getLayoutMetrics", "DOM.getDocument",
      "DOM.getOuterHTML", "Accessibility.getFullAXTree", "Console.enable",
    ]) expect(isAllowedCdpMethod(method)).toBe(true);
  });
  it("does not expose page execution, synthetic input or navigation", () => {
    for (const method of [
      "Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.awaitPromise",
      "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText",
      "Page.reload", "DOM.scrollIntoViewIfNeeded",
    ]) expect(isAllowedCdpMethod(method)).toBe(false);
  });
});
