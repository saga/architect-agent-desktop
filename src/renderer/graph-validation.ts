export interface KnowledgeGraphData {
  nodes: Array<{ id: string; label: string; data: { label: string } }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function graphId(value: unknown, fallback: string): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  if (!id || id.length > 120) return null;
  return id || fallback;
}

export function getKnowledgeGraphClickedNodeId(event: unknown, validNodeIds: ReadonlySet<string>): string | null {
  if (!isRecord(event)) return null;
  const target = event.target;
  if (!isRecord(target)) return null;
  const value = target.id;
  if (typeof value !== "string" || !value.trim() || value.length > 120) return null;
  const id = value.trim();
  return validNodeIds.has(id) ? id : null;
}

export function normalizeKnowledgeGraphData(nodes: unknown, edges?: unknown): KnowledgeGraphData | null {
  const nodeList = Array.isArray(nodes) ? nodes : isRecord(nodes) && Array.isArray(nodes.nodes) ? nodes.nodes : null;
  const edgeList = Array.isArray(edges) ? edges : isRecord(nodes) && Array.isArray(nodes.edges) ? nodes.edges : [];
  if (!nodeList || !Array.isArray(edgeList) || nodeList.length < 1 || nodeList.length > 5_000 || edgeList.length > 15_000) return null;
  let serialized = "";
  try { serialized = JSON.stringify({ nodeList, edgeList }); } catch { return null; }
  if (typeof serialized !== "string" || serialized.length > 1_000_000) return null;

  const normalizedNodes: KnowledgeGraphData["nodes"] = [];
  const nodeIds = new Set<string>();
  for (const [index, raw] of nodeList.entries()) {
    if (!isRecord(raw)) return null;
    const id = graphId(raw.id, "node-" + index);
    if (!id || nodeIds.has(id)) return null;
    nodeIds.add(id);
    const data = isRecord(raw.data) ? raw.data : {};
    const rawLabel = typeof raw.label === "string" ? raw.label : data.label;
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 160) : id.slice(0, 160);
    normalizedNodes.push({ id, label: label || id.slice(0, 160), data: { label: label || id.slice(0, 160) } });
  }

  const normalizedEdges: KnowledgeGraphData["edges"] = [];
  const edgeIds = new Set<string>();
  for (const [index, raw] of edgeList.entries()) {
    if (!isRecord(raw)) return null;
    const id = graphId(raw.id, "edge-" + index);
    const source = typeof raw.source === "string" ? raw.source.trim() : "";
    const target = typeof raw.target === "string" ? raw.target.trim() : "";
    if (!id || edgeIds.has(id) || !source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null;
    edgeIds.add(id);
    normalizedEdges.push({
      id, source, target,
      ...(typeof raw.label === "string" ? { label: raw.label.slice(0, 120) } : {}),
    });
  }
  return { nodes: normalizedNodes, edges: normalizedEdges };
}

function containsUnsafeWorkflowValue(value: unknown, depth = 0): boolean {
  if (depth > 10 || typeof value === "function" || typeof value === "symbol" ||
      typeof value === "bigint" || value === undefined) return true;
  if (typeof value === "string") {
    return /javascript:|data:text\/html|url\s*\(|<script\b|<foreignObject\b/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.length > 500 || value.some(item => containsUnsafeWorkflowValue(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    /^(on[a-z]+|html|foreignObject|href|xlink:href|srcDoc|innerHTML|outerHTML|__proto__|prototype|constructor)$/i.test(key) ||
    containsUnsafeWorkflowValue(item, depth + 1)
  );
}

function validFiniteRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validWorkflowEndpoint(endpoint: unknown, ids: Set<string>): boolean {
  if (!isRecord(endpoint)) return false;
  if (typeof endpoint.cell === "string") {
    return ids.has(endpoint.cell) &&
      (endpoint.port === undefined || typeof endpoint.port === "string") &&
      (endpoint.anchor === undefined || isRecord(endpoint.anchor));
  }
  return validFiniteRange(endpoint.x, -1_000_000, 1_000_000) &&
    validFiniteRange(endpoint.y, -1_000_000, 1_000_000);
}

export function validateWorkflowGraphJson(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  let encoded = "";
  try { encoded = JSON.stringify(input); } catch { return null; }
  if (encoded.length > 1_000_000 || containsUnsafeWorkflowValue(input)) return null;
  const cells = Array.isArray(input.cells) ? input.cells : null;
  if (!cells || cells.length > 2_000) return null;
  const allowedShapes = new Set(["edge", "rect", "circle", "ellipse", "polygon"]);
  const ids = new Set<string>();
  for (const cell of cells) {
    if (!isRecord(cell) || typeof cell.id !== "string" || cell.id.trim().length < 1 || cell.id.length > 120 ||
        typeof cell.shape !== "string" || !allowedShapes.has(cell.shape) || ids.has(cell.id)) return null;
    ids.add(cell.id);
    if (cell.position !== undefined) {
      if (!isRecord(cell.position) ||
          !validFiniteRange(cell.position.x, -1_000_000, 1_000_000) ||
          !validFiniteRange(cell.position.y, -1_000_000, 1_000_000)) return null;
    }
    if (cell.size !== undefined) {
      if (!isRecord(cell.size) ||
          !validFiniteRange(cell.size.width, 1, 10_000) ||
          !validFiniteRange(cell.size.height, 1, 10_000)) return null;
    }
    if (cell.zIndex !== undefined && !validFiniteRange(cell.zIndex, -100_000, 100_000)) return null;
    if (cell.angle !== undefined && !validFiniteRange(cell.angle, -36_000, 36_000)) return null;
  }
  for (const cell of cells) {
    if (!isRecord(cell) || cell.shape !== "edge") continue;
    if (!validWorkflowEndpoint(cell.source, ids) || !validWorkflowEndpoint(cell.target, ids)) return null;
  }
  return input;
}
