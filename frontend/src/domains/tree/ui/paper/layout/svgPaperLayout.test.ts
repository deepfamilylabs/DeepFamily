import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../../../shared/model";
import { buildPaperGenerations, PAPER_GENEALOGY_STYLE, type TranslateFn } from "../paperData";
import { buildSvgPaperLayout } from "./svgPaperLayout";

const translate: TranslateFn = (key, fallback, options) =>
  (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
    String(options?.[name] ?? ""),
  );

function makeGraph() {
  const rootHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const childHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const rootId = makeNodeId(rootHash, 1);
  const childId = makeNodeId(childHash, 1);
  return {
    rootId,
    childId,
    graph: {
      nodes: [
        { id: rootId, depth: 0, personHash: rootHash, versionIndex: 1 },
        { id: childId, depth: 1, personHash: childHash, versionIndex: 1 },
      ],
      edges: [{ from: rootId, to: childId }],
      childrenByParent: { [rootId]: [childId] },
    },
    nodesData: {
      [rootId]: {
        id: rootId,
        personHash: rootHash,
        versionIndex: 1,
        tokenId: "1",
        fullName: "曹源",
      },
      [childId]: {
        id: childId,
        personHash: childHash,
        versionIndex: 1,
        tokenId: "2",
        fullName: "曹续",
      },
    } satisfies Record<string, NodeData>,
  };
}

describe("buildSvgPaperLayout", () => {
  it("uses the tree-backed node dimensions for legacy vertical-register SVG layouts", () => {
    const { graph, rootId, nodesData } = makeGraph();
    const generations = buildPaperGenerations({ graph, nodesData, t: translate });

    const layout = buildSvgPaperLayout({
      style: PAPER_GENEALOGY_STYLE.DIEJI,
      graph,
      rootId,
      generations,
    });

    expect(layout.nodes[0].w).toBe(122);
    expect(layout.nodes[0].h).toBe(132);
  });
});
