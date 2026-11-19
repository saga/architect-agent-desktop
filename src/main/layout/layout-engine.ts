/**
 * Renderer-agnostic workspace layout engine.
 *
 * The engine owns geometry only. Electron Views, React panels and native
 * windows are adapters that consume the resulting rectangles.
 */
import type { LayoutAxis, LayoutNode, LayoutOptions, LayoutRect, LayoutResult } from "../../shared/layout-types";
export type { LayoutAxis, LayoutNode, LayoutOptions, LayoutRect, LayoutResult } from "../../shared/layout-types";

const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const nonNegative = (n: number) => Math.max(0, n);

function panelVisible(node: LayoutNode): boolean {
  if (node.type === "panel") return node.visible !== false;
  return panelVisible(node.first) || panelVisible(node.second);
}

function collectMin(node: LayoutNode, axis: LayoutAxis, splitter: number): number {
  if (node.type === "panel") {
    if (node.visible === false) return 0;
    return axis === "horizontal"
      ? nonNegative(finite(node.minWidth ?? 0, 0))
      : nonNegative(finite(node.minHeight ?? 0, 0));
  }
  const a = collectMin(node.first, axis, splitter);
  const b = collectMin(node.second, axis, splitter);
  if (!panelVisible(node.first)) return b;
  if (!panelVisible(node.second)) return a;
  if (node.axis === axis) return a + b + nonNegative(node.splitterSize ?? splitter);
  return Math.max(a, b);
}

function roundRect(rect: LayoutRect, pixelRatio: number): LayoutRect {
  const scale = Math.max(0.25, finite(pixelRatio, 1));
  const snap = (v: number) => Math.round(v * scale) / scale;
  return {
    x: snap(rect.x), y: snap(rect.y),
    width: snap(nonNegative(rect.width)), height: snap(nonNegative(rect.height)),
  };
}

/**
 * Computes panel rectangles in logical pixels. Ratios are clamped and
 * impossible minimum constraints degrade proportionally rather than yielding
 * negative/NaN bounds.
 */
export function calculateLayout(
  root: LayoutNode,
  viewport: LayoutRect,
  options: LayoutOptions = {},
): LayoutResult {
  const bounds: Record<string, LayoutRect> = {};
  const hidden: string[] = [];
  const overflow: string[] = [];
  const splitter = nonNegative(options.splitterSize ?? 5);
  const pixelRatio = options.pixelRatio ?? 1;
  const rootRect: LayoutRect = {
    x: finite(viewport.x, 0), y: finite(viewport.y, 0),
    width: nonNegative(finite(viewport.width, 0)),
    height: nonNegative(finite(viewport.height, 0)),
  };

  const markHidden = (node: LayoutNode): void => {
    if (node.type === "panel") hidden.push(node.id);
    else { markHidden(node.first); markHidden(node.second); }
  };

  const visit = (node: LayoutNode, rect: LayoutRect): void => {
    if (node.type === "panel") {
      if (node.visible === false) { hidden.push(node.id); return; }
      const minW = nonNegative(node.minWidth ?? 0);
      const minH = nonNegative(node.minHeight ?? 0);
      const maxW = Math.max(minW, finite(node.maxWidth ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
      const maxH = Math.max(minH, finite(node.maxHeight ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
      const width = clamp(rect.width, Math.min(minW, rect.width), Math.min(maxW, rect.width));
      const height = clamp(rect.height, Math.min(minH, rect.height), Math.min(maxH, rect.height));
      if (rect.width < minW || rect.height < minH) overflow.push(node.id);
      bounds[node.id] = roundRect({ ...rect, width, height }, pixelRatio);
      return;
    }

    const firstVisible = panelVisible(node.first);
    const secondVisible = panelVisible(node.second);
    if (!firstVisible) { markHidden(node.first); visit(node.second, rect); return; }
    if (!secondVisible) { markHidden(node.second); visit(node.first, rect); return; }

    const axisSize = node.axis === "horizontal" ? rect.width : rect.height;
    const gap = Math.min(nonNegative(node.splitterSize ?? splitter), axisSize);
    const available = Math.max(0, axisSize - gap);
    const minFirst = collectMin(node.first, node.axis, splitter);
    const minSecond = collectMin(node.second, node.axis, splitter);
    let firstSize = available * clamp(finite(node.ratio, 0.5), 0.05, 0.95);

    if (minFirst + minSecond <= available) {
      firstSize = clamp(firstSize, minFirst, available - minSecond);
    } else {
      // Not enough room for all minima: preserve the ratio and report affected
      // leaves, rather than producing invalid geometry.
      firstSize = available * (minFirst + minSecond > 0 ? minFirst / (minFirst + minSecond) : 0.5);
    }
    const secondSize = Math.max(0, available - firstSize);
    if (node.axis === "horizontal") {
      visit(node.first, { ...rect, width: firstSize });
      visit(node.second, { x: rect.x + firstSize + gap, width: secondSize, y: rect.y, height: rect.height });
    } else {
      visit(node.first, { ...rect, height: firstSize });
      visit(node.second, { x: rect.x, y: rect.y + firstSize + gap, width: rect.width, height: secondSize });
    }
  };

  visit(root, rootRect);
  return { bounds, hidden, overflow: [...new Set(overflow)], version: 1 };
}

export { validateLayout } from "../../shared/layout-validation";
export function cloneLayout(node: LayoutNode): LayoutNode {
  return node.type === "panel"
    ? { ...node }
    : { ...node, first: cloneLayout(node.first), second: cloneLayout(node.second) };
}
