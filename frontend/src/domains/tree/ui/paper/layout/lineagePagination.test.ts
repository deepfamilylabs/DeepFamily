import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../../../shared/model";
import { buildPaperGenerations, type TranslateFn } from "../paperData";
import {
  buildLineagePaperBook,
  getLineagePageMetrics,
  getLineagePageWidth,
  LINEAGE_BRANCH_LEAF_CAPACITY,
  LINEAGE_GENERATIONS_PER_CHART,
  LINEAGE_PERSON_SLOT_WIDTH,
} from "./lineagePagination";

const translate: TranslateFn = (key, fallback, options) =>
  (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
    String(options?.[name] ?? ""),
  );

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function makeLinearGraph(length: number) {
  const nodes = Array.from({ length }, (_value, index) => {
    const personHash = makeHash(index + 1);
    const id = makeNodeId(personHash, 1);
    return { id, depth: index, personHash, versionIndex: 1 };
  });
  return {
    rootId: nodes[0]?.id || null,
    graph: {
      nodes,
      edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })),
      childrenByParent: Object.fromEntries(
        nodes.slice(0, -1).map((node, index) => [node.id, [nodes[index + 1].id]]),
      ),
    },
  };
}

function makeWideGenerationGraph(childCount: number) {
  const rootPersonHash = makeHash(101);
  const root = {
    id: makeNodeId(rootPersonHash, 1),
    depth: 0,
    personHash: rootPersonHash,
    versionIndex: 1,
  };
  const children = Array.from({ length: childCount }, (_value, index) => {
    const personHash = makeHash(index + 102);
    return { id: makeNodeId(personHash, 1), depth: 1, personHash, versionIndex: 1 };
  });
  return {
    rootId: root.id,
    graph: {
      nodes: [root, ...children],
      edges: children.map((child) => ({ from: root.id, to: child.id })),
      childrenByParent: {
        [root.id]: children.map((child) => child.id),
      },
    },
  };
}

function makeOffsetGrandchildGraph() {
  const rootPersonHash = makeHash(201);
  const root = {
    id: makeNodeId(rootPersonHash, 1),
    depth: 0,
    personHash: rootPersonHash,
    versionIndex: 1,
  };
  const children = Array.from({ length: 3 }, (_value, index) => {
    const personHash = makeHash(index + 202);
    return { id: makeNodeId(personHash, 1), depth: 1, personHash, versionIndex: 1 };
  });
  const firstBranchGrandchildren = Array.from({ length: 3 }, (_value, index) => {
    const personHash = makeHash(index + 205);
    return { id: makeNodeId(personHash, 1), depth: 2, personHash, versionIndex: 1 };
  });
  const secondBranchChildPersonHash = makeHash(208);
  const secondBranchChild = {
    id: makeNodeId(secondBranchChildPersonHash, 1),
    depth: 2,
    personHash: secondBranchChildPersonHash,
    versionIndex: 1,
  };
  const nodes = [root, ...children, ...firstBranchGrandchildren, secondBranchChild];

  return {
    rootId: root.id,
    secondParentId: children[1].id,
    secondParentChildId: secondBranchChild.id,
    graph: {
      nodes,
      edges: [
        ...children.map((child) => ({ from: root.id, to: child.id })),
        ...firstBranchGrandchildren.map((child) => ({ from: children[0].id, to: child.id })),
        { from: children[1].id, to: secondBranchChild.id },
      ],
      childrenByParent: {
        [root.id]: children.map((child) => child.id),
        [children[0].id]: firstBranchGrandchildren.map((child) => child.id),
        [children[1].id]: [secondBranchChild.id],
      },
    },
  };
}

function makeOverlappingBranchGraph() {
  const rootPersonHash = makeHash(301);
  const root = {
    id: makeNodeId(rootPersonHash, 1),
    depth: 0,
    personHash: rootPersonHash,
    versionIndex: 1,
  };
  const parents = Array.from({ length: 2 }, (_value, index) => {
    const personHash = makeHash(index + 302);
    return { id: makeNodeId(personHash, 1), depth: 1, personHash, versionIndex: 1 };
  });
  const childrenByParent = parents.map((parent, parentIndex) =>
    Array.from({ length: 4 }, (_value, childIndex) => {
      const personHash = makeHash(304 + parentIndex * 4 + childIndex);
      return {
        id: makeNodeId(personHash, 1),
        depth: 2,
        personHash,
        versionIndex: 1,
        parentId: parent.id,
      };
    }),
  );
  const grandchildren = childrenByParent.flat();
  const nodes = [
    root,
    ...parents,
    ...grandchildren.map(({ parentId: _parentId, ...node }) => node),
  ];

  return {
    rootId: root.id,
    parentIds: parents.map((parent) => parent.id),
    graph: {
      nodes,
      edges: [
        ...parents.map((parent) => ({ from: root.id, to: parent.id })),
        ...grandchildren.map((child) => ({ from: child.parentId, to: child.id })),
      ],
      childrenByParent: {
        [root.id]: parents.map((parent) => parent.id),
        [parents[0].id]: childrenByParent[0].map((child) => child.id),
        [parents[1].id]: childrenByParent[1].map((child) => child.id),
      },
    },
  };
}

function makeGenerations(graph: ReturnType<typeof makeLinearGraph>["graph"], nodesData = {}) {
  return buildPaperGenerations({
    graph,
    nodesData: nodesData as Record<string, NodeData>,
    t: translate,
  });
}

describe("buildLineagePaperBook", () => {
  it("uses Ou-style five-generation windows with the boundary generation repeated", () => {
    const linear = makeLinearGraph(6);
    const generations = makeGenerations(linear.graph);

    const book = buildLineagePaperBook({
      graph: linear.graph,
      rootId: linear.rootId,
      generations,
      t: translate,
    });

    expect(LINEAGE_GENERATIONS_PER_CHART).toBe(5);
    expect(book.charts).toHaveLength(2);
    expect(book.charts[0].generationDepths).toEqual([0, 1, 2, 3, 4]);
    expect(book.charts[1].generationDepths).toEqual([4, 5, 6, 7, 8]);
    expect(book.charts[1].repeatedDepth).toBe(4);
    expect(book.charts[1].spreads[0].rows[0].entries[0].person.id).toBe(
      linear.graph.nodes[4].id,
    );
  });

  it("continues wide relationship rows from the right page to the left page and next spread", () => {
    const childCount = LINEAGE_BRANCH_LEAF_CAPACITY * 3;
    const wide = makeWideGenerationGraph(childCount);
    const generations = makeGenerations(wide.graph);

    const book = buildLineagePaperBook({
      graph: wide.graph,
      rootId: wide.rootId,
      generations,
      t: translate,
    });
    const firstChart = book.charts[0];
    const secondGenerationEntries = firstChart.spreads.flatMap(
      (spread) => spread.rows.find((row) => row.depth === 1)?.entries || [],
    );
    const firstSpreadSecondGeneration = firstChart.spreads[0].rows.find((row) => row.depth === 1);
    const secondSpreadSecondGeneration = firstChart.spreads[1].rows.find((row) => row.depth === 1);

    expect(firstChart.spreads.length).toBeGreaterThan(1);
    expect(new Set(secondGenerationEntries.map((entry) => entry.person.id)).size).toBe(childCount);
    expect(firstSpreadSecondGeneration?.entries.some((entry) => entry.side === "right")).toBe(true);
    expect(firstSpreadSecondGeneration?.entries.some((entry) => entry.side === "left")).toBe(true);
    expect(secondSpreadSecondGeneration?.entries.some((entry) => entry.side === "right")).toBe(true);
    expect(secondGenerationEntries.every((entry) => entry.widthPx === LINEAGE_PERSON_SLOT_WIDTH)).toBe(
      true,
    );

    const rootConnectors = firstChart.spreads[0].connectors.filter(
      (connector) => connector.parentId === wide.rootId,
    );
    expect(
      rootConnectors.some((connector) => connector.kind === "local" && connector.side === "right"),
    ).toBe(true);
    expect(
      rootConnectors.some(
        (connector) => connector.kind === "outgoing" && connector.side === "right",
      ),
    ).toBe(true);
    const incomingLeft = rootConnectors.find(
      (connector) => connector.kind === "incoming" && connector.side === "left",
    );
    expect(incomingLeft?.childIds.length).toBeGreaterThan(0);
    expect(incomingLeft?.parentCenterX).toBeUndefined();

    const secondSpreadRootIncoming = firstChart.spreads[1].connectors.find(
      (connector) => connector.parentId === wide.rootId && connector.kind === "incoming",
    );
    expect(secondSpreadRootIncoming?.side).toBe("right");
    expect(secondSpreadRootIncoming?.childIds.length).toBeGreaterThan(0);
  });

  it("keeps parent-to-child branches connected when a parent sits outside the child span", () => {
    const graph = makeOffsetGrandchildGraph();
    const generations = makeGenerations(graph.graph);

    const book = buildLineagePaperBook({
      graph: graph.graph,
      rootId: graph.rootId,
      generations,
      t: translate,
    });
    const spread = book.charts[0].spreads[0];
    const parentEntry = spread.rows
      .find((row) => row.depth === 1)
      ?.entries.find((entry) => entry.person.id === graph.secondParentId);
    const childEntry = spread.rows
      .find((row) => row.depth === 2)
      ?.entries.find((entry) => entry.person.id === graph.secondParentChildId);
    const connector = spread.connectors.find(
      (item) => item.parentId === graph.secondParentId && item.kind === "local",
    );

    expect(parentEntry).toBeTruthy();
    expect(childEntry).toBeTruthy();
    expect(connector?.horizontalStartX).toBe(
      Math.min(parentEntry?.centerX || 0, childEntry?.centerX || 0),
    );
    expect(connector?.horizontalEndX).toBe(
      Math.max(parentEntry?.centerX || 0, childEntry?.centerX || 0),
    );
  });

  it("keeps sibling branch lines on the same level with separate subtree spans", () => {
    const graph = makeOverlappingBranchGraph();
    const generations = makeGenerations(graph.graph);

    const book = buildLineagePaperBook({
      graph: graph.graph,
      rootId: graph.rootId,
      generations,
      t: translate,
    });
    const branchConnectors = book.charts[0].spreads[0].connectors.filter(
      (connector) =>
        graph.parentIds.includes(connector.parentId) && connector.kind === "local",
    );

    expect(branchConnectors).toHaveLength(2);
    expect(new Set(branchConnectors.map((connector) => connector.horizontalY)).size).toBe(1);
    expect(branchConnectors[0].horizontalStartX).toBeGreaterThan(
      branchConnectors[1].horizontalEndX,
    );
  });

  it("uses Ou-style page body metrics inside the book frame", () => {
    const linear = makeLinearGraph(2);
    const generations = makeGenerations(linear.graph);

    const book = buildLineagePaperBook({
      graph: linear.graph,
      rootId: linear.rootId,
      generations,
      t: translate,
    });
    const metrics = getLineagePageMetrics();

    expect(book.charts[0].spreads[0].rows).toHaveLength(5);
    expect(getLineagePageWidth("right", metrics)).toBe(558);
    expect(getLineagePageWidth("left", metrics)).toBe(560);
  });
});
