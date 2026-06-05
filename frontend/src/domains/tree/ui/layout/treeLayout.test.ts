import { describe, expect, it } from "vitest";
import { makeNodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { computeTreeLayout } from "./treeLayout";

const cfg = {
  baseNodeWidth: 100,
  nodeHeight: 40,
  gapX: 20,
  gapY: 60,
  marginX: 10,
  marginY: 10,
};

const root = makeNodeId(`0x${"a1".repeat(32)}`, 1);
const child = makeNodeId(`0x${"b2".repeat(32)}`, 1);

describe("computeTreeLayout", () => {
  it("positions every node present in the projected graph", () => {
    const graph: TreeGraphData = {
      nodes: [
        { id: root, depth: 0, personHash: root, versionIndex: 1 },
        { id: child, depth: 1, personHash: child, versionIndex: 1 },
      ],
      edges: [{ from: root, to: child }],
      childrenByParent: { [root]: [child] },
    };

    const out = computeTreeLayout(graph, root, cfg);
    expect(out.nodes.map((n) => n.id).sort()).toEqual([root, child].sort());
  });

  it("does not invent a root node when the projected graph is empty", () => {
    // A trusted-source filter can hide the root (or the graph is empty mid-build); the layout
    // must not emit a positioned root whose id is absent from nodeUiById and crashes rendering.
    const emptyGraph: TreeGraphData = { nodes: [], edges: [], childrenByParent: {} };

    const out = computeTreeLayout(emptyGraph, root, cfg);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
  });
});
