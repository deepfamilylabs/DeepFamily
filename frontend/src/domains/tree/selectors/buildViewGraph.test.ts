import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict } from "../model/treeStore";
import { buildViewGraphData } from "./buildViewGraph";

describe("buildViewGraphData visibleNodeIds", () => {
  const root = makeNodeId(`0x${"a1".repeat(32)}`, 1);
  const childVisible = makeNodeId(`0x${"b2".repeat(32)}`, 1);
  const childHidden = makeNodeId(`0x${"c3".repeat(32)}`, 1);

  const edgesStrict: EdgeStoreStrict = {
    [root]: { childIds: [childVisible, childHidden], fetchedAt: 1 },
  };

  const base = {
    rootId: root,
    childrenMode: "strict" as const,
    deduplicateChildren: false,
    endorsementsReady: false,
    nodesData: {},
    edgesUnion: {},
    edgesStrict,
  };

  it("renders every edge-reachable child when no visible set is provided", () => {
    const graph = buildViewGraphData(base);
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set<NodeId>([root, childVisible, childHidden]));
    expect(graph.childrenByParent[root]).toEqual(
      expect.arrayContaining([childVisible, childHidden]),
    );
  });

  it("omits children outside the visible set together with their edges", () => {
    const graph = buildViewGraphData({
      ...base,
      visibleNodeIds: new Set<NodeId>([root, childVisible]),
    });

    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set<NodeId>([root, childVisible]));
    expect(ids.has(childHidden)).toBe(false);
    expect(graph.edges).toEqual([{ from: root, to: childVisible }]);
    expect(graph.childrenByParent[root]).toEqual([childVisible]);
    expect(graph.edges.some((edge) => edge.to === childHidden)).toBe(false);
  });
});
