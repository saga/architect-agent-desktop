import type { Rectangle } from "electron";

export interface BrowserBoundsInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

/** Clip a renderer-measured Browser body rectangle to the BrowserWindow content area. */
export function clampBrowserBounds(
  requested: BrowserBoundsInput,
  viewportWidth: number,
  viewportHeight: number,
): Rectangle {
  const width = Math.max(0, finite(viewportWidth));
  const height = Math.max(0, finite(viewportHeight));
  const x = Math.max(0, Math.min(width, Math.round(finite(requested.x))));
  const y = Math.max(0, Math.min(height, Math.round(finite(requested.y))));
  return {
    x,
    y,
    width: Math.max(0, Math.min(width - x, Math.round(Math.max(0, finite(requested.width))))),
    height: Math.max(0, Math.min(height - y, Math.round(Math.max(0, finite(requested.height))))),
  };
}
