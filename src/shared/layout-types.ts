export type LayoutAxis = "horizontal" | "vertical";

export type LayoutNode =
  | { type: "panel"; id: string; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; visible?: boolean }
  | { type: "split"; id: string; axis: LayoutAxis; ratio: number; first: LayoutNode; second: LayoutNode; splitterSize?: number };

export interface LayoutRect { x: number; y: number; width: number; height: number }
export interface LayoutResult {
  bounds: Record<string, LayoutRect>;
  hidden: string[];
  overflow: string[];
  version: number;
}
export interface LayoutOptions {
  splitterSize?: number;
  pixelRatio?: number;
}
