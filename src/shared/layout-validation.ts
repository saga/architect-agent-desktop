import type { LayoutNode } from "./layout-types";

export function validateLayout(node: LayoutNode): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const visit = (current: LayoutNode) => {
    if (!current.id.trim()) errors.push("Layout node id cannot be empty.");
    if (ids.has(current.id)) errors.push("Duplicate layout node id: " + current.id);
    ids.add(current.id);
    if (current.type === "panel") {
      for (const key of ["minWidth", "minHeight", "maxWidth", "maxHeight"] as const) {
        const value = current[key];
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) errors.push(current.id + "." + key + " must be a non-negative finite number.");
      }
      if (current.maxWidth !== undefined && current.minWidth !== undefined && current.maxWidth < current.minWidth) errors.push(current.id + " maxWidth is below minWidth.");
      if (current.maxHeight !== undefined && current.minHeight !== undefined && current.maxHeight < current.minHeight) errors.push(current.id + " maxHeight is below minHeight.");
    } else {
      if (!Number.isFinite(current.ratio) || current.ratio <= 0 || current.ratio >= 1) errors.push(current.id + " ratio must be between 0 and 1.");
      visit(current.first);
      visit(current.second);
    }
  };
  visit(node);
  return errors;
}

