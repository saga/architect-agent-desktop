import { describe, expect, it } from "vitest";
import {
  getKnowledgeGraphClickedNodeId,
  normalizeKnowledgeGraphData,
  validateWorkflowGraphJson,
} from "../src/renderer/graph-validation";

describe("G6 KnowledgeGraph input validation", () => {
  it("normalizes a valid graph and strips untrusted renderer properties", () => {
    const result = normalizeKnowledgeGraphData({
      nodes: [
        { id: "issuer", label: "Issuer A", style: { onClick: "alert(1)" } },
        { id: "fund", data: { label: "Fund X" } },
      ],
      edges: [{ id: "owns", source: "fund", target: "issuer", label: "holds" }],
    });
    expect(result).toEqual({
      nodes: [
        { id: "issuer", label: "Issuer A", data: { label: "Issuer A" } },
        { id: "fund", label: "Fund X", data: { label: "Fund X" } },
      ],
      edges: [{ id: "owns", source: "fund", target: "issuer", label: "holds" }],
    });
  });

  it("only forwards click events for IDs in the validated graph", () => {
    const ids = new Set(["issuer-1", "fund-1"]);
    expect(getKnowledgeGraphClickedNodeId({ target: { id: "issuer-1" } }, ids)).toBe("issuer-1");
    expect(getKnowledgeGraphClickedNodeId({ target: { id: "unknown" } }, ids)).toBeNull();
    expect(getKnowledgeGraphClickedNodeId({ target: { id: { malicious: true } } }, ids)).toBeNull();
    expect(getKnowledgeGraphClickedNodeId({ currentTarget: { id: "issuer-1" } }, ids)).toBeNull();
    expect(getKnowledgeGraphClickedNodeId(null, ids)).toBeNull();
  });

  it("rejects duplicate node IDs and duplicate edge IDs", () => {
    expect(normalizeKnowledgeGraphData([
      { id: "same", label: "A" },
      { id: "same", label: "B" },
    ])).toBeNull();
    expect(normalizeKnowledgeGraphData([
      { id: "a" }, { id: "b" },
    ], [
      { id: "same", source: "a", target: "b" },
      { id: "same", source: "b", target: "a" },
    ])).toBeNull();
  });

  it("rejects malformed nodes, malformed edges and dangling endpoints", () => {
    expect(normalizeKnowledgeGraphData([{ label: "Missing ID" }])).toBeNull();
    expect(normalizeKnowledgeGraphData([{ id: "a" }, null])).toBeNull();
    expect(normalizeKnowledgeGraphData([{ id: "a" }, { id: "b" }], [
      { id: "edge", source: "a", target: "missing" },
    ])).toBeNull();
    expect(normalizeKnowledgeGraphData([{ id: "a" }, { id: "b" }], [
      { id: "edge", source: 1, target: "b" },
    ])).toBeNull();
  });

  it("rejects graphs beyond node, edge and serialized-size limits", () => {
    const nodes = Array.from({ length: 5_001 }, (_, index) => ({ id: "n-" + index }));
    expect(normalizeKnowledgeGraphData(nodes)).toBeNull();
    expect(normalizeKnowledgeGraphData([{ id: "a" }], Array.from({ length: 15_001 }, (_, index) => ({
      id: "e-" + index, source: "a", target: "a",
    })))).toBeNull();
    expect(normalizeKnowledgeGraphData([{ id: "a", label: "x".repeat(1_000_001) }])).toBeNull();
  });
});

describe("X6 WorkflowDiagram input validation", () => {
  const validGraph = () => ({
    cells: [
      { id: "start", shape: "rect", position: { x: 10, y: 20 }, size: { width: 120, height: 48 } },
      { id: "finish", shape: "ellipse", position: { x: 240, y: 20 }, size: { width: 120, height: 48 } },
      { id: "transition", shape: "edge", source: { cell: "start" }, target: { cell: "finish" } },
    ],
  });

  it("accepts an empty canvas as a valid editable workflow", () => {
    expect(validateWorkflowGraphJson({ cells: [] })).toEqual({ cells: [] });
  });

  it("accepts valid bounded nodes and connected edges", () => {
    expect(validateWorkflowGraphJson(validGraph())).toEqual(validGraph());
  });

  it("rejects duplicate IDs, missing endpoints and invalid edge points", () => {
    const duplicate = validGraph();
    duplicate.cells.push({ id: "start", shape: "rect" } as never);
    expect(validateWorkflowGraphJson(duplicate)).toBeNull();

    const dangling = validGraph();
    (dangling.cells[2] as Record<string, unknown>).target = { cell: "unknown" };
    expect(validateWorkflowGraphJson(dangling)).toBeNull();

    const invalidPoint = validGraph();
    (invalidPoint.cells[2] as Record<string, unknown>).source = { x: Number.NaN, y: 20 };
    expect(validateWorkflowGraphJson(invalidPoint)).toBeNull();
  });

  it("rejects unsafe HTML, event handlers, script URLs and executable values", () => {
    for (const unsafe of [
      { cells: [{ id: "a", shape: "rect", html: "<img src=x>" }] },
      { cells: [{ id: "a", shape: "rect", attrs: { body: { onClick: "run()" } } }] },
      { cells: [{ id: "a", shape: "rect", attrs: { label: { text: "javascript:alert(1)" } } }] },
      { cells: [{ id: "a", shape: "rect", data: { render: () => "unsafe" } }] },
    ]) expect(validateWorkflowGraphJson(unsafe)).toBeNull();
  });

  it("rejects non-finite and extreme node geometry", () => {
    const badPosition = validGraph();
    (badPosition.cells[0] as Record<string, unknown>).position = { x: Infinity, y: 0 };
    expect(validateWorkflowGraphJson(badPosition)).toBeNull();

    const badSize = validGraph();
    (badSize.cells[0] as Record<string, unknown>).size = { width: 20_000, height: 48 };
    expect(validateWorkflowGraphJson(badSize)).toBeNull();

    const badAngle = validGraph();
    (badAngle.cells[0] as Record<string, unknown>).angle = 99_999;
    expect(validateWorkflowGraphJson(badAngle)).toBeNull();
  });

  it("rejects unsupported X6 shapes, excessive payloads and excessive cell counts", () => {
    expect(validateWorkflowGraphJson({ cells: [{ id: "img", shape: "image" }] })).toBeNull();
    expect(validateWorkflowGraphJson({ cells: Array.from({ length: 2_001 }, (_, i) => ({ id: String(i), shape: "rect" })) })).toBeNull();
    expect(validateWorkflowGraphJson({ cells: [{ id: "large", shape: "rect", data: "x".repeat(1_000_001) }] })).toBeNull();
  });
});
