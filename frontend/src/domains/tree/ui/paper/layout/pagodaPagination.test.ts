import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../../../shared/model";
import { buildPaperGenerations, type TranslateFn } from "../paperData";
import {
  buildPagodaPaperBook,
  PAGODA_GENERATIONS_PER_CHART,
  PAGODA_PAGE_HEIGHT,
  PAGODA_PAGE_WIDTH,
} from "./pagodaPagination";

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

function makeTwoBranchGraph() {
  const rootPersonHash = makeHash(201);
  const firstParentHash = makeHash(202);
  const secondParentHash = makeHash(203);
  const firstChildHash = makeHash(204);
  const secondChildHash = makeHash(205);
  const root = { id: makeNodeId(rootPersonHash, 1), depth: 0, personHash: rootPersonHash, versionIndex: 1 };
  const firstParent = {
    id: makeNodeId(firstParentHash, 1),
    depth: 1,
    personHash: firstParentHash,
    versionIndex: 1,
  };
  const secondParent = {
    id: makeNodeId(secondParentHash, 1),
    depth: 1,
    personHash: secondParentHash,
    versionIndex: 1,
  };
  const firstChild = {
    id: makeNodeId(firstChildHash, 1),
    depth: 2,
    personHash: firstChildHash,
    versionIndex: 1,
  };
  const secondChild = {
    id: makeNodeId(secondChildHash, 1),
    depth: 2,
    personHash: secondChildHash,
    versionIndex: 1,
  };

  return {
    root,
    firstParent,
    secondParent,
    firstChild,
    secondChild,
    rootId: root.id,
    graph: {
      nodes: [root, firstParent, secondParent, firstChild, secondChild],
      edges: [
        { from: root.id, to: firstParent.id },
        { from: root.id, to: secondParent.id },
        { from: firstParent.id, to: firstChild.id },
        { from: secondParent.id, to: secondChild.id },
      ],
      childrenByParent: {
        [root.id]: [firstParent.id, secondParent.id],
        [firstParent.id]: [firstChild.id],
        [secondParent.id]: [secondChild.id],
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

describe("buildPagodaPaperBook", () => {
  it("uses six-generation windows with the boundary generation repeated", () => {
    const linear = makeLinearGraph(7);
    const generations = makeGenerations(linear.graph);

    const book = buildPagodaPaperBook({
      graph: linear.graph,
      rootId: linear.rootId,
      generations,
      t: translate,
    });

    expect(PAGODA_GENERATIONS_PER_CHART).toBe(6);
    expect(book.charts).toHaveLength(2);
    expect(book.charts[0].generationDepths).toEqual([0, 1, 2, 3, 4, 5]);
    expect(book.charts[1].generationDepths).toEqual([5, 6, 7, 8, 9, 10]);
    expect(book.charts[1].repeatedDepth).toBe(5);
    expect(book.charts[1].pages[0].rootId).toBe(linear.graph.nodes[5].id);
    expect(book.charts[0].pages[0].title).toBe("一世至六世系图");
  });

  it("centers each parent over the child group and keeps generations on fixed bands", () => {
    const branch = makeTwoBranchGraph();
    const generations = makeGenerations(branch.graph);

    const book = buildPagodaPaperBook({
      graph: branch.graph,
      rootId: branch.rootId,
      generations,
      t: translate,
    });
    const page = book.charts[0].pages[0];
    const root = page.nodes.find((node) => node.id === branch.root.id);
    const firstParent = page.nodes.find((node) => node.id === branch.firstParent.id);
    const secondParent = page.nodes.find((node) => node.id === branch.secondParent.id);
    const connector = page.connectors.find((entry) => entry.parentId === branch.root.id);

    expect(root).toBeTruthy();
    expect(firstParent).toBeTruthy();
    expect(secondParent).toBeTruthy();
    expect(connector).toBeTruthy();
    expect(firstParent && secondParent ? firstParent.x > secondParent.x : false).toBe(true);
    expect(new Set(page.nodes.filter((node) => node.depth === 1).map((node) => node.y)).size).toBe(1);
    expect(root ? root.x + root.w / 2 : 0).toBeCloseTo(
      ((connector?.horizontalStartX || 0) + (connector?.horizontalEndX || 0)) / 2,
    );
    expect(connector?.parentCenterX).toBeCloseTo(
      ((connector?.horizontalStartX || 0) + (connector?.horizontalEndX || 0)) / 2,
    );
  });

  it("splits over-wide sibling groups into branch pages instead of shrinking the page", () => {
    const wide = makeWideGenerationGraph(30);
    const generations = makeGenerations(wide.graph);

    const book = buildPagodaPaperBook({
      graph: wide.graph,
      rootId: wide.rootId,
      generations,
      t: translate,
    });
    const firstChart = book.charts[0];
    const childIdsInPages = firstChart.pages
      .flatMap((page) => page.connectors.find((entry) => entry.parentId === wide.rootId)?.childIds || []);

    expect(firstChart.pages.length).toBeGreaterThan(1);
    expect(firstChart.pages.every((page) => page.width === PAGODA_PAGE_WIDTH)).toBe(true);
    expect(firstChart.pages.every((page) => page.nodes.some((node) => node.id === wide.rootId))).toBe(
      true,
    );
    expect(new Set(childIdsInPages).size).toBe(30);
  });

  it("uses the same fixed page size as the Ou/Su paper spread", () => {
    const branch = makeTwoBranchGraph();
    const generations = makeGenerations(branch.graph);

    const book = buildPagodaPaperBook({
      graph: branch.graph,
      rootId: branch.rootId,
      generations,
      t: translate,
    });
    const page = book.charts[0].pages[0];

    expect(page.width).toBe(1180);
    expect(page.height).toBe(872);
    expect(page.width).toBe(PAGODA_PAGE_WIDTH);
    expect(page.height).toBe(PAGODA_PAGE_HEIGHT);
  });
});
