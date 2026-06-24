import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../../../shared/model";
import { buildPaperGenerations, type PaperPerson, type TranslateFn } from "../paperData";
import {
  buildSuPaperBook,
  getSuFullRecordText,
  getSuPageMetrics,
  splitSuRecordText,
  SU_BODY_COLUMN_WIDTH,
  SU_BODY_PADDING_X,
  SU_COLUMN_UNIT_CAPACITY,
  SU_GENERATIONS_PER_CHART,
  SU_LEFT_SPINE_CONTENT_GAP,
  SU_NAME_LANE_WIDTH,
  type SuPersonEntry,
} from "./suPagination";
import { measureRecordUnits } from "../paperText";

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
    return {
      id: makeNodeId(personHash, 1),
      depth: index,
      personHash,
      versionIndex: 1,
    };
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

function makeBranchGraph() {
  const root = { id: makeNodeId(makeHash(101), 1), depth: 0, personHash: makeHash(101), versionIndex: 1 };
  const first = { id: makeNodeId(makeHash(102), 1), depth: 1, personHash: makeHash(102), versionIndex: 1 };
  const second = { id: makeNodeId(makeHash(103), 1), depth: 1, personHash: makeHash(103), versionIndex: 1 };
  const firstChildren = Array.from({ length: 2 }, (_value, index) => ({
    id: makeNodeId(makeHash(104 + index), 1),
    depth: 2,
    personHash: makeHash(104 + index),
    versionIndex: 1,
  }));
  const secondChild = {
    id: makeNodeId(makeHash(106), 1),
    depth: 2,
    personHash: makeHash(106),
    versionIndex: 1,
  };

  return {
    root,
    first,
    second,
    firstChildren,
    secondChild,
    rootId: root.id,
    graph: {
      nodes: [root, first, second, ...firstChildren, secondChild],
      edges: [
        { from: root.id, to: first.id },
        { from: root.id, to: second.id },
        ...firstChildren.map((child) => ({ from: first.id, to: child.id })),
        { from: second.id, to: secondChild.id },
      ],
      childrenByParent: {
        [root.id]: [first.id, second.id],
        [first.id]: firstChildren.map((child) => child.id),
        [second.id]: [secondChild.id],
      },
    },
  };
}

function makeWideGraph(childCount: number) {
  const root = { id: makeNodeId(makeHash(201), 1), depth: 0, personHash: makeHash(201), versionIndex: 1 };
  const children = Array.from({ length: childCount }, (_value, index) => ({
    id: makeNodeId(makeHash(202 + index), 1),
    depth: 1,
    personHash: makeHash(202 + index),
    versionIndex: 1,
  }));
  return {
    root,
    children,
    rootId: root.id,
    graph: {
      nodes: [root, ...children],
      edges: children.map((child) => ({ from: root.id, to: child.id })),
      childrenByParent: { [root.id]: children.map((child) => child.id) },
    },
  };
}

function makeSecondGenerationOverflowGraph(childCount: number) {
  const root = { id: makeNodeId(makeHash(301), 1), depth: 0, personHash: makeHash(301), versionIndex: 1 };
  const elderSibling = { id: makeNodeId(makeHash(302), 1), depth: 1, personHash: makeHash(302), versionIndex: 1 };
  const parent = { id: makeNodeId(makeHash(303), 1), depth: 1, personHash: makeHash(303), versionIndex: 1 };
  const children = Array.from({ length: childCount }, (_value, index) => ({
    id: makeNodeId(makeHash(304 + index), 1),
    depth: 2,
    personHash: makeHash(304 + index),
    versionIndex: 1,
  }));
  return {
    root,
    elderSibling,
    parent,
    children,
    rootId: root.id,
    graph: {
      nodes: [root, elderSibling, parent, ...children],
      edges: [
        { from: root.id, to: elderSibling.id },
        { from: root.id, to: parent.id },
        ...children.map((child) => ({ from: parent.id, to: child.id })),
      ],
      childrenByParent: {
        [root.id]: [elderSibling.id, parent.id],
        [parent.id]: children.map((child) => child.id),
      },
    },
  };
}

function makeGenerations(
  graph: ReturnType<typeof makeLinearGraph>["graph"],
  nodesData: Record<string, NodeData> = {},
) {
  return buildPaperGenerations({ graph, nodesData, t: translate });
}

function getPrimaryEntry(
  entries: SuPersonEntry[],
  personId: string,
): SuPersonEntry | undefined {
  return entries.find((entry) => entry.person.id === personId && !entry.continued);
}

describe("buildSuPaperBook", () => {
  it("uses five-generation windows and repeats the fifth generation", () => {
    const linear = makeLinearGraph(7);
    const book = buildSuPaperBook({
      graph: linear.graph,
      rootId: linear.rootId,
      generations: makeGenerations(linear.graph),
      t: translate,
    });

    expect(SU_GENERATIONS_PER_CHART).toBe(5);
    expect(book.charts).toHaveLength(2);
    expect(book.charts[0].generationDepths).toEqual([0, 1, 2, 3, 4]);
    expect(book.charts[1].generationDepths).toEqual([4, 5, 6, 7, 8]);
    expect(book.charts[1].repeatedDepth).toBe(4);
    expect(book.charts[1].spreads[0].rows[0].entries[0].person.id).toBe(
      linear.graph.nodes[4].id,
    );
  });

  it("keeps each branch contiguous with the parent at the branch's right edge", () => {
    const branch = makeBranchGraph();
    const generations = makeGenerations(branch.graph, {
      [branch.first.id]: {
        id: branch.first.id,
        personHash: branch.first.personHash,
        versionIndex: 1,
        fullName: "曹昂",
      },
    });
    const book = buildSuPaperBook({
      graph: branch.graph,
      rootId: branch.rootId,
      generations,
      t: translate,
    });
    const rows = book.charts[0].spreads[0].rows;
    const parentEntries = rows[1].entries;
    const childEntries = rows[2].entries;
    const firstParent = getPrimaryEntry(parentEntries, branch.first.id);
    const secondParent = getPrimaryEntry(parentEntries, branch.second.id);
    const firstBranchChildren = branch.firstChildren
      .map((child) => getPrimaryEntry(childEntries, child.id))
      .filter(Boolean) as SuPersonEntry[];
    const secondBranchChild = getPrimaryEntry(childEntries, branch.secondChild.id);
    const firstConnector = book.charts[0].spreads[0].connectors.find(
      (connector) => connector.parentId === branch.first.id && connector.kind === "local",
    );

    expect(firstParent?.slotIndex).toBe(firstBranchChildren[0].slotIndex);
    expect(firstParent?.centerX).toBe(
      (firstParent?.x || 0) + (firstParent?.widthPx || 0) - SU_NAME_LANE_WIDTH / 2,
    );
    expect(firstParent?.bottomY).toBeLessThan(
      (firstParent?.y || 0) + (firstParent?.heightPx || 0) - 12,
    );
    expect(firstConnector?.parentBottomY).toBe(firstParent?.bottomY);
    expect(firstConnector?.horizontalY).toBe(
      (firstParent?.branchY || 0) +
        (Math.min(...firstBranchChildren.map((child) => child.topY)) -
          (firstParent?.branchY || 0)) /
          2,
    );
    expect(firstConnector?.horizontalY || 0).toBeGreaterThan(firstParent?.bottomY || 0);
    expect(firstBranchChildren[1].slotIndex).toBeGreaterThan(firstBranchChildren[0].slotIndex);
    expect(secondParent?.slotIndex).toBe(secondBranchChild?.slotIndex);
    expect(secondParent?.slotIndex).toBeGreaterThan(firstBranchChildren[1].slotIndex);
  });

  it("keeps Su-style left page content inset from the spine", () => {
    const wide = makeWideGraph(14);
    const metrics = getSuPageMetrics();
    const spread = buildSuPaperBook({
      graph: wide.graph,
      rootId: wide.rootId,
      generations: makeGenerations(wide.graph),
      t: translate,
    }).charts[0].spreads[0];
    const children = spread.rows[1].entries.filter((entry) => !entry.continued);
    const rightEntries = children.filter((entry) => entry.side === "right");
    const leftEntries = children.filter((entry) => entry.side === "left");

    expect(rightEntries).toHaveLength(7);
    expect(leftEntries).toHaveLength(7);
    expect(Math.min(...rightEntries.map((entry) => entry.x))).toBeCloseTo(0);
    expect(
      Math.max(...leftEntries.map((entry) => entry.x + entry.slotWidth)),
    ).toBeCloseTo(metrics.leftBodyWidth - SU_LEFT_SPINE_CONTENT_GAP);
  });

  it("keeps the first Su name lane reserved while a left-page record grows across slots", () => {
    const personHash = makeHash(901);
    const personId = makeNodeId(personHash, 1);
    const person: PaperPerson = {
      id: personId,
      depth: 1,
      sequence: 1,
      ui: {
        id: personId,
        personHash,
        versionIndex: 1,
        minted: true,
        shortHashText: "曹测",
        titleText: "曹测",
        versionText: "v1",
        versionTextWithTotal: "v1",
        fullName: "曹测",
        gender: 1,
      },
      detailLines: [],
      classicalLines: ["谱".repeat(98)],
      childCount: 0,
      children: [],
      spouses: [],
    };
    const metrics = getSuPageMetrics({ right: 540, left: 594 });
    const rightCapacity = Math.floor(metrics.rightBodyWidth / metrics.slotWidth);
    const leftCapacity = Math.floor(metrics.leftBodyWidth / metrics.slotWidth);
    const leftSlotWidth = (metrics.leftBodyWidth - SU_LEFT_SPINE_CONTENT_GAP) / leftCapacity;

    const chunks = splitSuRecordText(person, rightCapacity, metrics);
    const firstThreeChunks = chunks.slice(0, 3).join("");
    const firstThreeColumns = Math.ceil(
      measureRecordUnits(firstThreeChunks) / SU_COLUMN_UNIT_CAPACITY,
    );

    expect(chunks).toHaveLength(4);
    expect(
      firstThreeColumns * SU_BODY_COLUMN_WIDTH + SU_NAME_LANE_WIDTH + SU_BODY_PADDING_X,
    ).toBeLessThanOrEqual(3 * leftSlotWidth);
  });

  it("preserves long records across continuation columns and pages without repeating labels", () => {
    const wide = makeWideGraph(1);
    const child = wide.children[0];
    // Long enough to overflow a full spread's slot capacity, so the record provably continues
    // onto a second spread (not just into continuation columns within one spread).
    const story = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，婚丧贫乏者量力周济。"
    ).repeat(12);
    const nodesData: Record<string, NodeData> = {
      [wide.root.id]: {
        id: wide.root.id,
        personHash: wide.root.personHash,
        versionIndex: 1,
        fullName: "曹操",
      },
      [child.id]: {
        id: child.id,
        personHash: child.personHash,
        versionIndex: 1,
        fullName: "曹长文",
        gender: 1,
        story,
      },
    };
    const generations = makeGenerations(wide.graph, nodesData);
    const person = generations[1].people[0];
    const book = buildSuPaperBook({
      graph: wide.graph,
      rootId: wide.rootId,
      generations,
      t: translate,
    });
    const entries = book.charts[0].spreads
      .flatMap((spread) => spread.rows[1].entries)
      .filter((entry) => entry.person.id === child.id)
      .sort((a, b) => a.partIndex - b.partIndex);
    const firstSpreadEntries = book.charts[0].spreads[0].rows[1].entries
      .filter((entry) => entry.person.id === child.id)
      .sort((a, b) => a.slotIndex - b.slotIndex);
    const rightEntries = firstSpreadEntries.filter((entry) => entry.side === "right");
    const leftEntries = firstSpreadEntries.filter((entry) => entry.side === "left");

    expect(entries.length).toBeGreaterThan(8);
    expect(rightEntries.length).toBeGreaterThan(0);
    expect(leftEntries.length).toBeGreaterThan(0);
    expect(Math.max(...rightEntries.map((entry) => entry.slotIndex))).toBeLessThan(
      Math.min(...leftEntries.map((entry) => entry.slotIndex)),
    );
    expect(entries.map((entry) => entry.text).join("")).toBe(getSuFullRecordText(person));
    expect(entries.slice(1).every((entry) => entry.continued)).toBe(true);
    expect(new Set(entries.map((entry) => entry.spreadIndex)).size).toBeGreaterThan(1);
  });

  it("creates local, cross-spine, and cross-spread connector segments", () => {
    const wide = makeWideGraph(20);
    const metrics = getSuPageMetrics();
    const book = buildSuPaperBook({
      graph: wide.graph,
      rootId: wide.rootId,
      generations: makeGenerations(wide.graph),
      t: translate,
    });
    const connectors = book.charts[0].spreads.flatMap((spread) => spread.connectors);

    expect(connectors.some((connector) => connector.kind === "local")).toBe(true);
    expect(
      connectors.some(
        (connector) => connector.kind === "outgoing" && connector.side === "right",
      ),
    ).toBe(true);
    expect(
      connectors.some(
        (connector) => connector.kind === "incoming" && connector.side === "left",
      ),
    ).toBe(true);
    expect(book.charts[0].spreads.length).toBeGreaterThan(1);
    const firstSpreadExitBridge = book.charts[0].spreads[0].connectors.find(
      (connector) => connector.kind === "bridge" && connector.side === "left",
    );
    expect(firstSpreadExitBridge?.horizontalStartX).toBe(0);
    expect(firstSpreadExitBridge?.horizontalEndX).toBeGreaterThan(0);
    expect(
      book.charts[0].spreads[1].connectors.some(
        (connector) => connector.kind === "incoming" && connector.side === "right",
      ),
    ).toBe(true);
    const nextSpreadRightIncoming = book.charts[0].spreads[1].connectors.find(
      (connector) => connector.kind === "incoming" && connector.side === "right",
    );
    expect(nextSpreadRightIncoming?.horizontalStartX).toBeGreaterThan(0);
    expect(nextSpreadRightIncoming?.horizontalEndX).toBe(metrics.rightBodyWidth);
    const nextSpreadLeftIncoming = book.charts[0].spreads
      .slice(1)
      .flatMap((spread) => spread.connectors)
      .find((connector) => connector.kind === "incoming" && connector.side === "left");
    if (nextSpreadLeftIncoming) {
      const bridge = book.charts[0].spreads
        .slice(1)
        .flatMap((spread) => spread.connectors)
        .find(
          (connector) =>
            connector.kind === "bridge" &&
            connector.parentId === nextSpreadLeftIncoming.parentId &&
            connector.horizontalY === nextSpreadLeftIncoming.horizontalY,
        );
      expect(bridge?.side).toBe("right");
      expect(bridge?.horizontalStartX).toBe(0);
      expect(bridge?.horizontalEndX).toBeGreaterThan(0);
    }
  });

  it("does not run a right-page continuation connector through an unrelated child", () => {
    const root = {
      id: makeNodeId(makeHash(701), 1),
      depth: 0,
      personHash: makeHash(701),
      versionIndex: 1,
    };
    const firstParent = {
      id: makeNodeId(makeHash(702), 1),
      depth: 1,
      personHash: makeHash(702),
      versionIndex: 1,
    };
    const secondParent = {
      id: makeNodeId(makeHash(703), 1),
      depth: 1,
      personHash: makeHash(703),
      versionIndex: 1,
    };
    const firstChildren = Array.from({ length: 17 }, (_value, index) => ({
      id: makeNodeId(makeHash(710 + index), 1),
      depth: 2,
      personHash: makeHash(710 + index),
      versionIndex: 1,
    }));
    const secondChild = {
      id: makeNodeId(makeHash(750), 1),
      depth: 2,
      personHash: makeHash(750),
      versionIndex: 1,
    };
    const nodes = [root, firstParent, secondParent, ...firstChildren, secondChild];
    const nameByNodeId = new Map([
      [root.id, "祖"],
      [firstParent.id, "父甲"],
      [secondParent.id, "父乙"],
      [secondChild.id, "乙子"],
    ]);
    const graph = {
      nodes,
      edges: [
        { from: root.id, to: firstParent.id },
        { from: root.id, to: secondParent.id },
        ...firstChildren.map((child) => ({ from: firstParent.id, to: child.id })),
        { from: secondParent.id, to: secondChild.id },
      ],
      childrenByParent: {
        [root.id]: [firstParent.id, secondParent.id],
        [firstParent.id]: firstChildren.map((child) => child.id),
        [secondParent.id]: [secondChild.id],
      },
    };
    const nodesData: Record<string, NodeData> = Object.fromEntries(
      nodes.map((node, index) => [
        node.id,
        {
          id: node.id,
          personHash: node.personHash,
          versionIndex: 1,
          tokenId: String(index + 1),
          fullName: nameByNodeId.get(node.id) || `甲子${index}`,
        },
      ]),
    );
    const metrics = getSuPageMetrics({ right: 525, left: 579 });
    const book = buildSuPaperBook({
      graph,
      rootId: root.id,
      generations: makeGenerations(graph, nodesData),
      t: translate,
      pageBodyWidths: { right: metrics.rightBodyWidth, left: metrics.leftBodyWidth },
    });
    const continuationSpread = book.charts[0].spreads[1];
    const firstIncoming = continuationSpread.connectors.find(
      (connector) =>
        connector.parentId === firstParent.id &&
        connector.kind === "incoming" &&
        connector.side === "right",
    );
    const secondLocal = continuationSpread.connectors.find(
      (connector) =>
        connector.parentId === secondParent.id &&
        connector.kind === "local" &&
        connector.side === "right",
    );
    const secondChildEntry = continuationSpread.rows
      .flatMap((row) => row.entries)
      .find((entry) => entry.person.id === secondChild.id && !entry.continued);

    expect(firstIncoming?.childIds).toEqual([
      firstChildren[15].id,
      firstChildren[16].id,
    ]);
    expect(secondLocal?.childIds).toEqual([secondChild.id]);
    expect(firstIncoming?.horizontalY).toBe(secondLocal?.horizontalY);
    expect(firstIncoming?.horizontalStartX).toBeGreaterThan(secondChildEntry?.centerX || 0);
    expect(firstIncoming?.horizontalEndX).toBe(metrics.rightBodyWidth);
  });

  it("extends the current left-page sibling line when descendants continue later", () => {
    const branch = makeSecondGenerationOverflowGraph(20);
    const metrics = getSuPageMetrics();
    const book = buildSuPaperBook({
      graph: branch.graph,
      rootId: branch.rootId,
      generations: makeGenerations(branch.graph),
      t: translate,
    });
    const firstSpread = book.charts[0].spreads[0];
    const laterEntries = book.charts[0].spreads
      .slice(1)
      .flatMap((spread) => spread.rows[2].entries)
      .filter((entry) => branch.children.some((child) => child.id === entry.person.id));
    const leftIncoming = firstSpread.connectors.find(
      (connector) =>
        connector.parentId === branch.parent.id &&
        connector.kind === "incoming" &&
        connector.side === "left",
    );

    expect(laterEntries.length).toBeGreaterThan(0);
    expect(leftIncoming?.horizontalStartX).toBe(0);
    expect(leftIncoming?.horizontalEndX).toBe(metrics.leftBodyWidth);
  });

  it("continues relationships by page-edge lines without repeating the parent", () => {
    const branch = makeSecondGenerationOverflowGraph(35);
    const metrics = getSuPageMetrics();
    const book = buildSuPaperBook({
      graph: branch.graph,
      rootId: branch.rootId,
      generations: makeGenerations(branch.graph),
      t: translate,
    });
    const childIds = new Set(branch.children.map((child) => child.id));
    const continuationSpread = book.charts[0].spreads.find((spread, spreadIndex) => {
      if (spreadIndex === 0) return false;
      const hasLeftIncoming = spread.connectors.some(
        (connector) =>
          connector.parentId === branch.parent.id &&
          connector.kind === "incoming" &&
          connector.side === "left",
      );
      const hasChildrenLater = book.charts[0].spreads
        .slice(spreadIndex + 1)
        .some((laterSpread) =>
          laterSpread.rows[2].entries.some(
            (entry) => !entry.continued && childIds.has(entry.person.id),
          ),
        );
      return hasLeftIncoming && hasChildrenLater;
    });
    const leftIncoming = continuationSpread?.connectors.find(
      (connector) =>
        connector.parentId === branch.parent.id &&
        connector.kind === "incoming" &&
        connector.side === "left",
    );

    expect(continuationSpread).toBeDefined();
    expect(
      continuationSpread?.rows[1].entries.some(
        (entry) => entry.person.id === branch.parent.id,
      ),
    ).toBe(false);
    expect(leftIncoming?.horizontalStartX).toBe(0);
    expect(leftIncoming?.horizontalEndX).toBe(metrics.leftBodyWidth);
  });
});
