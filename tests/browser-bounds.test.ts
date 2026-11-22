import { describe, expect, it } from "vitest";
import { clampBrowserBounds } from "../src/main/layout/browser-bounds";

describe("renderer-owned Browser bounds", () => {
  it("clips the measured rectangle to the native window viewport", () => {
    expect(clampBrowserBounds({ x: 700, y: 40, width: 500, height: 900 }, 1000, 700))
      .toEqual({ x: 700, y: 40, width: 300, height: 660 });
  });
  it("clamps negative geometry and replaces non-finite values", () => {
    expect(clampBrowserBounds({ x: -10, y: Number.NaN, width: -1, height: 300 }, 800, 600))
      .toEqual({ x: 0, y: 0, width: 0, height: 300 });
  });
});
