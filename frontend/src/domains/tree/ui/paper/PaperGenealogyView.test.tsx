// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNodeId, type NodeData } from "../../../../shared/model";
import { buildPaperGenerations } from "./paperData";
import { PaperGenealogyView } from "./PaperGenealogyView";
import { buildLineagePaperBook } from "./layout/lineagePagination";
import { buildOuPaperBook, getOuFullRecordText, getOuRecordSlotSpan } from "./layout/ouPagination";
import { measureRecordUnits } from "./paperText";
import { MODERN_RECORD_UNITS_PER_ROW } from "./renderers/ModernBookRenderer";
import {
  buildSuPaperBook,
  getSuFullRecordText,
  getSuPersonLaneKeys,
  SU_LEFT_PAGE_LANE_CAPACITY,
  SU_RIGHT_PAGE_LANE_CAPACITY,
} from "./layout/suPagination";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: any) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions.replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
          String(options?.[name] ?? ""),
        );
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === "object") {
        return String(fallbackOrOptions.defaultValue ?? key).replace(
          /{{\s*(\w+)\s*}}/g,
          (_match, name) => String((fallbackOrOptions as Record<string, unknown>)[name] ?? ""),
        );
      }
      return key;
    },
  }),
}));

const rootHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const childHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const rootId = makeNodeId(rootHash, 1);
const childId = makeNodeId(childHash, 2);

const translate = (key: string, fallback?: string, options?: Record<string, unknown>) =>
  (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) => String(options?.[name] ?? ""));

const zhTranslate = (key: string, fallback?: string, options?: Record<string, unknown>) => {
  const zh: Record<string, string> = {
    "genealogyBook.fields.birth": "生",
    "genealogyBook.fields.death": "卒",
    "genealogyBook.fields.origin": "籍贯",
    "genealogyBook.fields.deathPlace": "卒于",
    "genealogyBook.fields.notes": "附记",
    "genealogyBook.fields.children": "子女",
    "genealogyBook.generationLabel": "第 {{number}} 世",
    "genealogyBook.suRootLabel": "始祖",
    "genealogyBook.suFirstSon": "长子",
    "genealogyBook.suSecondSon": "次子",
    "genealogyBook.suNthSon": "{{han}}子",
    "genealogyBook.suFirstDaughter": "长女",
    "genealogyBook.suSecondDaughter": "次女",
    "genealogyBook.suNthDaughter": "{{han}}女",
    "genealogyBook.suOnlySon": "之子",
    "genealogyBook.suOnlyDaughter": "之女",
  };
  return (zh[key] || fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
    String(options?.[name] ?? ""),
  );
};

const graph = {
  nodes: [
    { id: rootId, depth: 0, personHash: rootHash, versionIndex: 1 },
    { id: childId, depth: 1, personHash: childHash, versionIndex: 2 },
  ],
  edges: [{ from: rootId, to: childId }],
  childrenByParent: {
    [rootId]: [childId],
  },
};

const nodesData: Record<string, NodeData> = {
  [rootId]: {
    id: rootId,
    personHash: rootHash,
    versionIndex: 1,
    tokenId: "1",
    fullName: "Ada Root",
    birthYear: 1815,
    birthPlace: "London",
    endorsementCount: 3,
  },
  [childId]: {
    id: childId,
    personHash: childHash,
    versionIndex: 2,
    tag: "branch",
  },
};

function makeLinearGraph(length: number) {
  const nodes = Array.from({ length }, (_value, index) => {
    const personHash = `0x${String(index + 1).padStart(64, String(index + 1))}`;
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

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function makeWideGenerationGraph(childCount: number) {
  const rootPersonHash = makeHash(1);
  const root = {
    id: makeNodeId(rootPersonHash, 1),
    depth: 0,
    personHash: rootPersonHash,
    versionIndex: 1,
  };
  const children = Array.from({ length: childCount }, (_value, index) => {
    const personHash = makeHash(index + 2);
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
  const rootPersonHash = makeHash(101);
  const firstParentHash = makeHash(102);
  const secondParentHash = makeHash(103);
  const firstChildHash = makeHash(104);
  const secondChildHash = makeHash(105);
  const root = {
    id: makeNodeId(rootPersonHash, 1),
    depth: 0,
    personHash: rootPersonHash,
    versionIndex: 1,
  };
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

describe("PaperGenealogyView", () => {
  afterEach(() => {
    cleanup();
  });

  it("builds generation groups with life details and hash fallback labels", () => {
    const generations = buildPaperGenerations({
      graph,
      nodesData,
      t: translate,
    });

    expect(generations).toHaveLength(2);
    expect(generations[0].label).toBe("Generation 1");
    expect(generations[0].people[0].ui.titleText).toBe("Ada Root");
    expect(generations[0].people[0].detailLines.join(" ")).toContain("Birth: 1815");
    expect(generations[0].people[0].detailLines.join(" ")).toContain("Children: 0xbbbb");
    expect(generations[1].people[0].ui.titleText).toContain("0xbbbb");

    // Classical lines are projected from real on-chain data only (no sample fields).
    const rootClassical = generations[0].people[0].classicalLines.join(" ");
    expect(rootClassical).toContain("Birth: 1815");
    expect(rootClassical).toContain("Origin: London");
    expect(rootClassical).not.toContain("Courtesy");
    expect(rootClassical).not.toContain("Spouse");

    const suBook = buildSuPaperBook({ generations, t: zhTranslate });
    const childLane = suBook.charts[0].spreads
      .flatMap((spread) => spread.lanes)
      .find((lane) => lane.kind === "person" && lane.person.id === childId);
    expect(childLane?.kind === "person" ? childLane.relationLabel : "unexpected").toBe("");
  });

  it("uses node story directly in paper records", () => {
    const generations = buildPaperGenerations({
      graph: {
        nodes: [{ id: rootId, depth: 0, personHash: rootHash, versionIndex: 1 }],
        edges: [],
        childrenByParent: {},
      },
      nodesData: {
        [rootId]: {
          id: rootId,
          personHash: rootHash,
          versionIndex: 1,
          tokenId: "1",
          fullName: "曹操",
          story: "这是同步后的完整 story，纸本只读这个字段。",
          storyMetadata: {
            totalChunks: 3,
            fullStoryHash: "",
            lastUpdateTime: 1,
            isSealed: false,
            totalLength: 0,
          },
          storyChunks: [
            {
              chunkIndex: 2,
              chunkHash: "0x3",
              content: "第三段。",
              timestamp: 1,
              editor: "0x0000000000000000000000000000000000000000",
              chunkType: 0,
              attachmentCID: "",
            },
            {
              chunkIndex: 0,
              chunkHash: "0x1",
              content: "第一段。",
              timestamp: 1,
              editor: "0x0000000000000000000000000000000000000000",
              chunkType: 0,
              attachmentCID: "",
            },
            {
              chunkIndex: 1,
              chunkHash: "0x2",
              content: "第二段。",
              timestamp: 1,
              editor: "0x0000000000000000000000000000000000000000",
              chunkType: 0,
              attachmentCID: "",
            },
          ],
        },
      },
      t: zhTranslate,
    });

    const record = getOuFullRecordText(generations[0].people[0]);
    expect(record).toContain("附记这是同步后的完整 story，纸本只读这个字段。");
    expect(record).not.toContain("第一段。第二段。第三段。");
  });

  it("projects Su-style relation labels ranked per gender within each parent", () => {
    const twoBranch = makeTwoBranchGraph();
    const generations = buildPaperGenerations({
      graph: twoBranch.graph,
      nodesData: {
        [twoBranch.firstParent.id]: {
          id: twoBranch.firstParent.id,
          personHash: twoBranch.firstParent.personHash,
          versionIndex: 1,
          gender: 1,
        },
        [twoBranch.secondParent.id]: {
          id: twoBranch.secondParent.id,
          personHash: twoBranch.secondParent.personHash,
          versionIndex: 1,
          gender: 2,
        },
        [twoBranch.firstChild.id]: {
          id: twoBranch.firstChild.id,
          personHash: twoBranch.firstChild.personHash,
          versionIndex: 1,
          gender: 1,
        },
        [twoBranch.secondChild.id]: {
          id: twoBranch.secondChild.id,
          personHash: twoBranch.secondChild.personHash,
          versionIndex: 1,
          gender: 2,
        },
      },
      t: zhTranslate,
    });
    const book = buildSuPaperBook({ generations, t: zhTranslate });
    const lanes = book.charts[0].spreads.flatMap((spread) => spread.lanes);
    const firstParentLane = lanes.find(
      (lane) => lane.kind === "person" && lane.person.id === twoBranch.firstParent.id,
    );
    const secondParentLane = lanes.find(
      (lane) => lane.kind === "person" && lane.person.id === twoBranch.secondParent.id,
    );
    const firstChildLane = lanes.find(
      (lane) => lane.kind === "person" && lane.person.id === twoBranch.firstChild.id,
    );
    const secondChildLane = lanes.find(
      (lane) => lane.kind === "person" && lane.person.id === twoBranch.secondChild.id,
    );

    // Each parent here has exactly one son and one daughter, so the sole same-gender child is
    // 之子 / 之女 (not 长子/长女). Parents have no fullName in this fixture, so no name prefix.
    expect(firstParentLane?.kind === "person" ? firstParentLane.relationLabel : "").toBe("之子");
    expect(secondParentLane?.kind === "person" ? secondParentLane.relationLabel : "").toBe("之女");
    expect(firstChildLane?.kind === "person" ? firstChildLane.relationLabel : "").toBe("之子");
    expect(secondChildLane?.kind === "person" ? secondChildLane.relationLabel : "").toBe("之女");
  });

  it("ranks every sibling and orders the generation eldest-first despite duplicate/missing birth dates", () => {
    const rootPersonHash = makeHash(201);
    const root = {
      id: makeNodeId(rootPersonHash, 1),
      depth: 0,
      personHash: rootPersonHash,
      versionIndex: 1,
    };
    // gender, birthYear; sonB and sonC share a birth year, children are stored out of birth order.
    const kids = [
      { key: "sonB", hash: makeHash(202), gender: 1, birthYear: 190 },
      { key: "daughter", hash: makeHash(203), gender: 2, birthYear: 185 },
      { key: "sonC", hash: makeHash(204), gender: 1, birthYear: 190 },
      { key: "sonA", hash: makeHash(205), gender: 1, birthYear: 180 },
    ];
    const childById = Object.fromEntries(
      kids.map((kid) => [kid.key, { ...kid, id: makeNodeId(kid.hash, 1) }]),
    );
    const childNodes = kids.map((kid) => ({
      id: childById[kid.key].id,
      depth: 1,
      personHash: kid.hash,
      versionIndex: 1,
    }));
    const nodesDataLocal: Record<string, NodeData> = {};
    for (const kid of kids) {
      nodesDataLocal[childById[kid.key].id] = {
        id: childById[kid.key].id,
        personHash: kid.hash,
        versionIndex: 1,
        gender: kid.gender,
        birthYear: kid.birthYear,
      };
    }

    const generations = buildPaperGenerations({
      graph: {
        nodes: [root, ...childNodes],
        edges: childNodes.map((node) => ({ from: root.id, to: node.id })),
        childrenByParent: { [root.id]: childNodes.map((node) => node.id) },
      },
      nodesData: nodesDataLocal,
      t: zhTranslate,
    });

    // Generation is sorted eldest-first; duplicate dates keep stored order (sonB before sonC).
    expect(generations[1].people.map((person) => person.id)).toEqual([
      childById.sonA.id,
      childById.daughter.id,
      childById.sonB.id,
      childById.sonC.id,
    ]);
    expect(generations[1].people.map((person) => person.sequence)).toEqual([1, 2, 3, 4]);

    const book = buildSuPaperBook({ generations, t: zhTranslate });
    const lanes = book.charts[0].spreads.flatMap((spread) => spread.lanes);
    const labelOf = (id: string) => {
      const lane = lanes.find((entry) => entry.kind === "person" && entry.person.id === id);
      return lane?.kind === "person" ? lane.relationLabel : "";
    };
    // Sons numbered among sons by birth (长子/次子/三子); the sole daughter is 之女.
    expect(labelOf(childById.sonA.id)).toBe("长子");
    expect(labelOf(childById.sonB.id)).toBe("次子");
    expect(labelOf(childById.sonC.id)).toBe("三子");
    expect(labelOf(childById.daughter.id)).toBe("之女");
  });

  it("lists every child by name in paper details instead of showing a child count", () => {
    const rootPersonHash = makeHash(301);
    const root = {
      id: makeNodeId(rootPersonHash, 1),
      depth: 0,
      personHash: rootPersonHash,
      versionIndex: 1,
    };
    const kids = [
      { hash: makeHash(302), fullName: "张三", birthYear: 1903 },
      { hash: makeHash(303), fullName: "张一", birthYear: 1901 },
      { hash: makeHash(304), fullName: "张四", birthYear: 1904 },
      { hash: makeHash(305), fullName: "张二", birthYear: 1902 },
    ];
    const childNodes = kids.map((kid) => ({
      id: makeNodeId(kid.hash, 1),
      depth: 1,
      personHash: kid.hash,
      versionIndex: 1,
    }));
    const nodesDataLocal: Record<string, NodeData> = Object.fromEntries(
      childNodes.map((node, index) => [
        node.id,
        {
          id: node.id,
          personHash: node.personHash,
          versionIndex: 1,
          fullName: kids[index].fullName,
          birthYear: kids[index].birthYear,
        },
      ]),
    );

    const generations = buildPaperGenerations({
      graph: {
        nodes: [root, ...childNodes],
        edges: childNodes.map((node) => ({ from: root.id, to: node.id })),
        childrenByParent: { [root.id]: childNodes.map((node) => node.id) },
      },
      nodesData: nodesDataLocal,
      t: zhTranslate,
    });

    const rootDetails = generations[0].people[0].detailLines.join(" ");
    expect(rootDetails).toContain("子女: 张一、张二、张三、张四");
    expect(rootDetails).not.toContain("子嗣");
    expect(rootDetails).not.toContain("子女: 4");

    const suRootLanes = buildSuPaperBook({ generations, t: zhTranslate }).charts[0].spreads
      .flatMap((spread) => spread.lanes)
      .filter((lane) => lane.kind === "person" && lane.person.id === root.id);
    expect(suRootLanes).toHaveLength(2);
    expect(suRootLanes[0]?.kind === "person" ? suRootLanes[0].text : "").not.toContain("子女");
    expect(suRootLanes[1]?.kind === "person" ? suRootLanes[1].text : "").toContain(
      "子女张一、张二、张三、张四",
    );

    const ouRootEntries = buildOuPaperBook({ generations, t: zhTranslate }).charts[0].spreads
      .flatMap((spread) => spread.rows)
      .flatMap((row) => row.entries)
      .filter((entry) => entry.person.id === root.id);
    expect(ouRootEntries).toHaveLength(2);
    expect(ouRootEntries[0].text).not.toContain("子女");
    expect(ouRootEntries[1].text).toContain("子女张一、张二、张三、张四");
  });

  it("renders the modern ledger view using projected genealogy data", () => {
    render(
      <PaperGenealogyView
        style="modern"
        graph={graph}
        rootId={rootId}
        nodesData={nodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-modern")).toBeTruthy();
    expect(screen.getByTestId("paper-modern-chart").className).toContain("border");
    expect(screen.getByText("Modern Ledger").className).toContain("text-xl");
    expect(
      screen.getByText(
        "Five generations per chart, with facing ledger pages for relation, name, and biography.",
      ).style.color,
    ).toBe("var(--df-paper-red)");
    expect(screen.getByTestId("paper-modern-page").className).toContain("h-[872px]");
    expect(screen.getByTestId("paper-modern-page").className).toContain("min-w-[1180px]");
    expect(screen.getByTestId("paper-modern-page").className).toContain("overflow-hidden");
    expect(screen.getByTestId("paper-modern-page").style.background).toBe("var(--df-paper-sheet)");
    expect(screen.getByTestId("paper-modern-page").childElementCount).toBe(3);
    expect(screen.getByTestId("paper-modern-page").style.gridTemplateColumns).toContain("72px");
    expect(screen.getByTestId("paper-modern-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-modern-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-modern-spine-1-1")).toBeTruthy();
    expect(screen.getAllByText("Relation")).toHaveLength(2);
    expect(screen.getAllByText("Name")).toHaveLength(2);
    expect(screen.getAllByText("Biography")).toHaveLength(2);
    expect(screen.getByTestId("paper-modern-generation-mark-0").textContent).toContain("一世");
    expect(screen.getByTestId(`paper-modern-name-${rootId}`).textContent).toContain("Ada Root");
    expect(screen.getByTestId(`paper-modern-name-${childId}`).textContent).toContain("0xbbbb");
    expect(screen.getByText(/Birth: 1815/)).toBeTruthy();
    expect(screen.queryByText(/Children: 1/)).toBeNull();
    const rootDetailRows = screen.getAllByTestId(`paper-modern-detail-${rootId}`);
    expect(rootDetailRows).toHaveLength(2);
    expect(rootDetailRows[0].textContent).not.toContain("Children:");
    expect(rootDetailRows[1].textContent).toContain("Children: 0xbbbb");
    expect(screen.getByTestId(`paper-modern-relation-${rootId}`).className).not.toContain(
      "font-bold",
    );
  });

  it("keeps long modern ledger biographies within compact continuation rows", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const longStory = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆，乡里称其笃行。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，凡族中婚丧贫乏者皆量力周济。"
    ).repeat(2);

    render(
      <PaperGenealogyView
        style="modern"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            fullName: "曹启",
            story: longStory,
          },
        }}
        hasRoot
      />,
    );

    const detailRows = screen.getAllByTestId(`paper-modern-detail-${child.id}`);
    expect(detailRows.length).toBeGreaterThan(1);
    // The first chunk fills the cell up to the visual-width budget (within one full-width
    // glyph of it) before a continuation row starts, regardless of script mix.
    const firstUnits = measureRecordUnits(detailRows[0].textContent || "");
    expect(firstUnits).toBeLessThanOrEqual(MODERN_RECORD_UNITS_PER_ROW);
    expect(firstUnits).toBeGreaterThan(MODERN_RECORD_UNITS_PER_ROW - 2);
    expect(detailRows[0].className).toContain("h-full");
    // Record text is a top-aligned, justified block so each non-final line fills edge-to-edge.
    expect(detailRows[0].className).toContain("block");
    expect(detailRows[0].style.textAlign).toBe("justify");
    // A chunk that continues into a later row also justifies its LAST line so the cell fills
    // edge-to-edge; only the final chunk (a real paragraph end) stays ragged.
    expect(detailRows[0].style.textAlignLast).toBe("justify");
    expect(detailRows[detailRows.length - 1].style.textAlignLast).toBe("auto");
    expect(screen.queryByTestId(`paper-modern-continued-${child.id}-2`)).toBeNull();
  });

  it("keeps later modern chart windows in the same paged section", () => {
    const linear = makeLinearGraph(6);

    render(
      <PaperGenealogyView
        style="modern"
        graph={linear.graph}
        rootId={linear.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-modern-chart")).toBeTruthy();
    expect(screen.queryByTestId("paper-modern-chart-2")).toBeNull();
    expect(screen.getByTestId("paper-modern-spread-2-1")).toBeTruthy();
  });

  it("renders Ou-style as five-generation tables with boundary generation repeated", () => {
    const linear = makeLinearGraph(6);

    render(
      <PaperGenealogyView
        style="ou"
        graph={linear.graph}
        rootId={linear.rootId}
        nodesData={
          linear.rootId
            ? {
                [linear.rootId]: {
                  id: linear.rootId,
                  personHash: linear.graph.nodes[0].personHash,
                  versionIndex: 1,
                  fullName: "贾源",
                },
              }
            : {}
        }
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-ou")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-table-1")).toBeTruthy();
    expect(screen.queryByTestId("paper-ou-table-2")).toBeNull();
    const spread = screen.getByTestId("paper-ou-spread-1-1");
    expect(spread).toBeTruthy();
    expect(screen.getByTestId("paper-ou-spread-2-1")).toBeTruthy();
    expect(spread.className).toContain("grid-cols-[1fr_72px_1fr]");
    expect(spread.style.width).toBe("");
    expect(screen.getByTestId("paper-ou-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getAllByTestId("paper-ou-generation-4")).toHaveLength(2);
    expect(screen.getByTestId("paper-ou-generation-5")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-generation-mark-0").textContent).toContain("一世");
  });

  it("projects Ou-style continuation spreads when one generation exceeds page width", () => {
    const wide = makeWideGenerationGraph(10);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {},
      t: zhTranslate,
    });

    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const firstChart = book.charts[0];
    const firstSpreadSecondGeneration = firstChart.spreads[0].rows.find((row) => row.depth === 1);
    const secondGenerationEntries = firstChart.spreads.flatMap(
      (spread) => spread.rows.find((row) => row.depth === 1)?.entries || [],
    );
    const secondSpreadFirstGeneration = firstChart.spreads[1].rows.find((row) => row.depth === 0);

    expect(firstChart.spreads.length).toBeGreaterThan(1);
    expect(new Set(secondGenerationEntries.map((entry) => entry.person.id)).size).toBe(10);
    expect(
      firstSpreadSecondGeneration?.entries.filter((entry) => entry.side === "right"),
    ).toHaveLength(4);
    expect(
      secondGenerationEntries.every((entry) => entry.text === getOuFullRecordText(entry.person)),
    ).toBe(true);
    expect(secondSpreadFirstGeneration?.entries).toHaveLength(0);

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-ou-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-spread-1-2")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-right-1-2")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-entry-lane-1-1-right-1").style.direction).toBe("ltr");
    expect(screen.getByTestId("paper-ou-entry-lane-1-1-right-1").className).toContain(
      "flex-row-reverse",
    );
    expect(screen.getByTestId("paper-ou-entry-lane-1-1-right-1").className).toContain(
      "justify-start",
    );
    expect(screen.getAllByTestId("paper-ou-generation-1").length).toBeGreaterThanOrEqual(
      firstChart.spreads.length,
    );
  });

  it("allocates wider Ou-style entries for long records instead of hiding overflow text", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const longStory =
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆，乡里称其笃行。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，凡族中婚丧贫乏者皆量力周济。" +
      "晚年手订家乘，考订先世迁徙源流，分房列派，俾后人知所由来。";
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          story: longStory,
        },
      },
      t: zhTranslate,
    });

    const person = generations[1].people[0];
    const fullRecord = getOuFullRecordText(person);
    const slotSpan = getOuRecordSlotSpan(person, zhTranslate);
    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const renderedEntry = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .find((entry) => entry.person.id === person.id);

    expect(fullRecord).toContain("晚年手订家乘");
    expect(slotSpan).toBeGreaterThan(1);
    expect(renderedEntry?.text).toBe(fullRecord);
    expect(renderedEntry?.slotSpan).toBe(slotSpan);
  });

  it("keeps Cao Biao's Ou-style record complete instead of clipping the last columns", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const story =
      "曹彪（195-251），太和六年（232年）封楚王。嘉平三年（251年）因与太尉王凌谋反事泄，被赐死";
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹彪",
          birthYear: 195,
          birthMonth: 1,
          birthDay: 1,
          deathYear: 251,
          deathMonth: 1,
          deathDay: 1,
          birthPlace: "沛国谯县（今安徽亳州）",
          deathPlace: "楚国",
          story,
        },
      },
      t: zhTranslate,
    });

    const person = generations[1].people[0];
    const fullRecord = getOuFullRecordText(person);

    expect(fullRecord).toContain("因与太尉王凌谋反事泄，被赐死");
    expect(getOuRecordSlotSpan(person, zhTranslate)).toBeGreaterThan(1);

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            tokenId: "2",
            fullName: "曹彪",
            birthYear: 195,
            birthMonth: 1,
            birthDay: 1,
            deathYear: 251,
            deathMonth: 1,
            deathDay: 1,
            birthPlace: "沛国谯县（今安徽亳州）",
            deathPlace: "楚国",
            story,
          },
        }}
        hasRoot
      />,
    );

    const detail = screen.getByTestId(`paper-ou-detail-${child.id}`);
    expect(detail.textContent).toContain("因与太尉王凌谋反事泄，被赐死");
    expect(detail.className).not.toContain("overflow-hidden");
    expect(screen.getByTestId(`paper-row-${child.id}`).getAttribute("data-slot-span")).toBe("2");
  });

  it("continues oversized Ou-style records onto the left page before clipping text", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const longStory = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆，乡里称其笃行。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，凡族中婚丧贫乏者皆量力周济。" +
      "晚年手订家乘，考订先世迁徙源流，分房列派，俾后人知所由来。"
    ).repeat(4);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹启",
          story: longStory,
        },
      },
      t: zhTranslate,
    });

    const person = generations[1].people[0];
    const fullRecord = getOuFullRecordText(person);
    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .filter((entry) => entry.person.id === person.id);

    expect(renderedEntries.length).toBeGreaterThan(1);
    expect(renderedEntries.map((entry) => entry.text).join("")).toBe(fullRecord);
    expect(renderedEntries[0].side).toBe("right");
    expect(renderedEntries[1].side).toBe("left");
    expect(renderedEntries[0].continued).toBe(false);
    expect(renderedEntries[1].continued).toBe(true);

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            tokenId: "2",
            fullName: "曹启",
            story: longStory,
          },
        }}
        hasRoot
      />,
    );

    const names = screen
      .getAllByTestId(`paper-ou-name-${child.id}`)
      .map((node) => node.textContent || "");
    expect(names.filter((name) => name.includes("曹启"))).toHaveLength(1);
    expect(names.some((name) => name.trim() === "")).toBe(true);
    const continuedName = screen
      .getAllByTestId(`paper-ou-name-${child.id}`)
      .find((node) => !(node.textContent || "").trim());
    expect(continuedName?.parentElement?.className).toContain("w-0");
    expect(
      screen
        .getAllByTestId(`paper-ou-detail-${child.id}`)
        .every((node) => !node.className.includes("overflow-hidden")),
    ).toBe(true);
  });

  it("uses the wider Ou-style left page body before creating a continuation spread", () => {
    const wide = makeWideGenerationGraph(5);
    const childRecords = Object.fromEntries(
      wide.graph.nodes.slice(1).map((node, index) => [
        node.id,
        {
          id: node.id,
          personHash: node.personHash,
          versionIndex: 1,
          tokenId: String(index + 2),
          fullName: `曹左${index + 1}`,
          birthYear: 195 + index,
          birthMonth: 1,
          birthDay: 1,
          deathYear: 250 + index,
          deathMonth: 1,
          deathDay: 1,
          birthPlace: "沛国谯县（今安徽亳州）",
          deathPlace: "洛阳",
          story: "续排测试，确认左页可容三人。",
        },
      ]),
    );
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: childRecords,
      t: zhTranslate,
    });

    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const firstChart = book.charts[0];
    const secondGenerationRows = firstChart.spreads.map((spread) =>
      spread.rows.find((row) => row.depth === 1),
    );
    const firstSpreadEntries = secondGenerationRows[0]?.entries || [];

    expect(firstChart.spreads).toHaveLength(1);
    expect(firstSpreadEntries.filter((entry) => entry.side === "right")).toHaveLength(3);
    expect(firstSpreadEntries.filter((entry) => entry.side === "left")).toHaveLength(3);
    expect(firstSpreadEntries.some((entry) => entry.side === "left" && entry.continued)).toBe(true);
    expect(new Set(firstSpreadEntries.map((entry) => entry.person.id)).size).toBe(5);
  });

  it("keeps Ou-style names right-aligned inside each packed person entry", () => {
    const wide = makeWideGenerationGraph(3);

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    const firstChildName = screen.getByTestId(`paper-ou-name-${wide.graph.nodes[1].id}`);
    const firstChildEntry = screen.getByTestId(`paper-row-${wide.graph.nodes[1].id}`);

    expect(firstChildName.style.textAlign).toBe("right");
    expect(firstChildName.style.writingMode).toBe("vertical-rl");
    expect(firstChildEntry.getAttribute("data-slot-span")).toBe("1");
  });

  it("marks Ou-style female persons with a 女 annotation under the name", () => {
    const wide = makeWideGenerationGraph(2);
    const [, daughter, son] = wide.graph.nodes;

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [daughter.id]: {
            id: daughter.id,
            personHash: daughter.personHash,
            versionIndex: 1,
            gender: 2,
          },
          [son.id]: {
            id: son.id,
            personHash: son.personHash,
            versionIndex: 1,
            gender: 1,
          },
        }}
        hasRoot
      />,
    );

    const femaleMark = screen.getByTestId(`paper-ou-female-${daughter.id}`);
    expect(femaleMark.textContent).toContain("女");
    expect(screen.queryByTestId(`paper-ou-female-${son.id}`)).toBeNull();
  });

  it("renders Su-style as five-generation vertical charts with boundary generation repeated", () => {
    const linear = makeLinearGraph(6);
    const linearNodesData = linear.rootId
      ? {
          [linear.rootId]: {
            id: linear.rootId,
            personHash: linear.graph.nodes[0].personHash,
            versionIndex: 1,
            fullName: "贾源",
          },
        }
      : {};
    const generations = buildPaperGenerations({
      graph: linear.graph,
      nodesData: linearNodesData,
      t: zhTranslate,
    });
    const book = buildSuPaperBook({ generations, t: zhTranslate });

    expect(
      book.charts
        .flatMap((chart) => chart.spreads)
        .every(
          (spread) =>
            spread.rightLanes.length === SU_RIGHT_PAGE_LANE_CAPACITY &&
            spread.leftLanes.length === SU_LEFT_PAGE_LANE_CAPACITY,
        ),
    ).toBe(true);
    expect(book.charts[0].spreads[0].lanes.some((lane) => lane.kind === "blank")).toBe(false);
    expect(
      [...book.charts[0].spreads[0].rightLanes, ...book.charts[0].spreads[0].leftLanes].some(
        (lane) => lane.kind === "blank",
      ),
    ).toBe(true);

    render(
      <PaperGenealogyView
        style="su"
        graph={linear.graph}
        rootId={linear.rootId}
        nodesData={linearNodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-su")).toBeTruthy();
    expect(screen.getByTestId("paper-su-table-1")).toBeTruthy();
    expect(screen.queryByTestId("paper-su-table-2")).toBeNull();
    expect(screen.getByTestId("paper-su-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-spread-2-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-spread-1-1").className).toContain("min-w-[1180px]");
    expect(screen.getByTestId("paper-su-spread-1-1").className).toContain(
      "grid-cols-[1fr_72px_1fr]",
    );
    expect(screen.getByTestId("paper-su-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-right-1-1").firstElementChild?.className).not.toContain(
      "border-x",
    );
    expect(screen.getByTestId("paper-su-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getAllByTestId("paper-su-generation-4")).toHaveLength(2);
    expect(screen.getByTestId("paper-su-generation-5")).toBeTruthy();
    expect(screen.getByTestId("paper-su-generation-mark-0").textContent).toContain("一世");
    expect(screen.getByTestId("paper-su-generation-mark-0").className).toContain("w-full");
    expect(screen.getByTestId("paper-su-generation-mark-0").style.width).toBe("");
    expect(screen.queryByTestId("paper-svg-su")).toBeNull();

    const rootRows = screen.getAllByTestId(`paper-row-${linear.rootId}`);
    expect(rootRows[0].style.gridTemplateRows).toBe("64px 96px 1fr");
    expect(rootRows[0].style.flexGrow).toBe("1");
    expect(rootRows[0].style.minWidth).toBe("0px");
    expect(rootRows[0].style.width).toBe("0px");
    expect(screen.getByTestId("paper-su-generation-0").style.flexGrow).toBe("1");
    expect(screen.getByTestId("paper-su-generation-0").style.minWidth).toBe("0px");
    expect(screen.getByTestId("paper-su-generation-0").style.gridTemplateRows).toBe(
      "64px 96px 1fr",
    );
    const firstBlankLane = screen.getAllByTestId(/^paper-su-blank-/)[0];
    expect(firstBlankLane.style.gridTemplateRows).toBe("64px 96px 1fr");
    expect(firstBlankLane.style.flexGrow).toBe("1");
    expect(firstBlankLane.style.minWidth).toBe("0px");
    expect(screen.getAllByTestId(`paper-su-relation-${linear.rootId}`)[0].textContent).toContain(
      "ancestor",
    );
    expect(screen.getAllByTestId(`paper-su-relation-${linear.rootId}`)[0].className).not.toContain(
      "font-bold",
    );
    expect(screen.getAllByTestId(`paper-su-name-${linear.rootId}`)[0].textContent).toContain(
      "贾源",
    );
    const rootDetail = screen.getAllByTestId(`paper-su-detail-${linear.rootId}`)[0];
    expect(rootDetail.className).toContain("w-fit");
    expect(rootDetail.parentElement?.className).toContain("justify-center");
    expect(rootRows[0].textContent).not.toContain("1.1");
  });

  it("projects Su-style continuation spreads when the right-to-left lane stream exceeds one spread", () => {
    const wide = makeWideGenerationGraph(30);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {},
      t: zhTranslate,
    });

    const book = buildSuPaperBook({ generations, t: zhTranslate });
    const firstChart = book.charts[0];
    const secondGenerationLanes = firstChart.spreads.flatMap((spread) =>
      spread.lanes.filter((lane) => lane.kind === "person" && lane.depth === 1),
    );
    const secondSpreadFirstLane = firstChart.spreads[1].lanes.find((lane) => lane.kind !== "blank");
    const firstChild = wide.graph.nodes[1];
    const firstChildLaneCount = firstChart.spreads
      .flatMap((spread) => spread.lanes)
      .filter((lane) => lane.kind === "person" && lane.person.id === firstChild.id).length;

    expect(firstChart.spreads.length).toBeGreaterThan(1);
    expect(
      firstChart.spreads.every(
        (spread) =>
          spread.rightLanes.length === SU_RIGHT_PAGE_LANE_CAPACITY &&
          spread.leftLanes.length === SU_LEFT_PAGE_LANE_CAPACITY,
      ),
    ).toBe(true);
    expect(
      new Set(secondGenerationLanes.map((lane) => (lane.kind === "person" ? lane.person.id : "")))
        .size,
    ).toBe(30);
    expect(
      firstChart.spreads.flatMap((spread) => spread.lanes).some((lane) => lane.kind === "blank"),
    ).toBe(false);
    expect(
      firstChart.spreads
        .flatMap((spread) => [...spread.rightLanes, ...spread.leftLanes])
        .some((lane) => lane.kind === "blank"),
    ).toBe(true);
    expect(firstChart.spreads[0].rightLanes[0].kind).toBe("generation");
    expect(
      secondGenerationLanes.every(
        (lane) => lane.kind === "person" && lane.text === getSuFullRecordText(lane.person),
      ),
    ).toBe(true);
    expect(getSuPersonLaneKeys(firstChart.spreads, firstChild.id)).toHaveLength(
      firstChildLaneCount,
    );
    expect(secondSpreadFirstLane?.kind).toBe("generation");
    expect(
      secondSpreadFirstLane && "continued" in secondSpreadFirstLane
        ? secondSpreadFirstLane.continued
        : false,
    ).toBe(true);

    render(
      <PaperGenealogyView
        style="su"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-su-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-spread-1-2")).toBeTruthy();
    expect(screen.getByTestId("paper-su-right-1-2")).toBeTruthy();
    expect(screen.getByTestId(`paper-su-name-${wide.graph.nodes[1].id}`).style.writingMode).toBe(
      "vertical-rl",
    );
    expect(screen.getByTestId(`paper-su-name-${wide.graph.nodes[1].id}`).style.textAlign).toBe(
      "right",
    );
  });

  it("splits long Su-style records into continued entries instead of hiding text", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const longStory = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆，乡里称其笃行。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，凡族中婚丧贫乏者皆量力周济。" +
      "晚年手订家乘，考订先世迁徙源流，分房列派，俾后人知所由来。" +
      "其后又重修祠宇，置祭器，定族规，凡春秋祭祀、婚丧礼节、子弟入学皆有条目。" +
      "临终嘱诸子守谱牒、睦宗族、敬祖先，后世修谱者皆据其旧稿续编。"
    ).repeat(3);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          fullName: "曹启",
          story: longStory,
        },
      },
      t: zhTranslate,
    });

    const person = generations[1].people[0];
    const fullRecord = getSuFullRecordText(person);
    const book = buildSuPaperBook({ generations, t: zhTranslate });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.lanes)
      .filter((lane) => lane.kind === "person" && lane.person.id === person.id);

    expect(renderedEntries.length).toBeGreaterThan(1);
    expect(renderedEntries.map((lane) => (lane.kind === "person" ? lane.text : "")).join("")).toBe(
      fullRecord,
    );
    expect(renderedEntries[0].kind === "person" ? renderedEntries[0].continued : true).toBe(false);
    expect(renderedEntries[1].kind === "person" ? renderedEntries[1].continued : false).toBe(true);
    expect(renderedEntries[0].kind === "person" ? renderedEntries[0].name : "").toBe("曹启");
    expect(
      renderedEntries.slice(1).every((lane) => lane.kind === "person" && lane.name === ""),
    ).toBe(true);
    expect(getSuPersonLaneKeys(book.charts[0].spreads, person.id).length).toBe(
      renderedEntries.length,
    );

    render(
      <PaperGenealogyView
        style="su"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            fullName: "曹启",
            story: longStory,
          },
        }}
        hasRoot
      />,
    );

    const names = screen
      .getAllByTestId(`paper-su-name-${child.id}`)
      .map((node) => node.textContent || "");
    expect(names.filter((name) => name.includes("曹启"))).toHaveLength(1);
    expect(names.some((name) => name.includes("续"))).toBe(false);
    expect(names.some((name) => name.trim() === "")).toBe(true);
    expect(screen.getAllByTestId(`paper-su-detail-${child.id}`)[0].style.wordBreak).toBe(
      "break-all",
    );
    expect(screen.getAllByTestId(`paper-su-detail-${child.id}`)[0].className).not.toContain(
      "overflow-hidden",
    );
  });

  it("renders the pagoda SVG paper style", () => {
    render(
      <PaperGenealogyView
        style="pagoda"
        graph={graph}
        rootId={rootId}
        nodesData={nodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-svg-pagoda")).toBeTruthy();
    expect(screen.getByTestId("paper-pagoda")).toBeTruthy();
    expect(screen.getByTestId("paper-pagoda-chart-1")).toBeTruthy();
    expect(screen.getByTestId("paper-pagoda-chart-1").textContent).toContain("Pagoda");
    expect(screen.getByTestId("paper-pagoda-chart-1").textContent).toContain(
      "Five generations per chart, ancestor above, branches descend by level.",
    );
    expect(screen.getByTestId("paper-pagoda-page-1-1").textContent).not.toContain(
      "一世至五世系图",
    );
    expect(screen.getByTestId("paper-pagoda-frame-1-1").className).toContain("h-[872px]");
    expect(screen.getByTestId("paper-pagoda-frame-1-1").className).toContain("min-w-[1180px]");
    expect(screen.getByTestId("paper-pagoda-page-1-1")).toBeTruthy();
    expect(screen.queryByTestId("paper-pagoda-outer-border")).toBeNull();
    expect(screen.queryByTestId("paper-pagoda-inner-border")).toBeNull();
    expect(screen.queryByTestId("paper-pagoda-generation-rail")).toBeNull();
    expect(screen.getByTestId("paper-pagoda-generation-separator-1").getAttribute("stroke")).toBe(
      "var(--df-paper-line-soft)",
    );
    expect(
      screen.getByTestId("paper-pagoda-generation-separator-1").getAttribute("stroke-width"),
    ).toBe("0.6");
    expect(
      screen.getByTestId("paper-pagoda-generation-separator-1").getAttribute("stroke-opacity"),
    ).toBe("0.35");
    expect(
      screen.getByTestId("paper-pagoda-generation-separator-1").getAttribute("stroke-dasharray"),
    ).toBeNull();
    expect(Number(screen.getByTestId("paper-pagoda-generation-separator-1").getAttribute("y1"))).toBeCloseTo(
      149.96,
    );
    expect(screen.getByTestId("paper-pagoda-generation-mark-bg-0").getAttribute("x")).toBe("1122");
    expect(screen.getByTestId("paper-pagoda-generation-mark-bg-0").getAttribute("y")).toBe("36");
    expect(screen.getByTestId("paper-pagoda-generation-mark-bg-0").getAttribute("fill")).toBe(
      "#1f1a14",
    );
    expect(screen.getByTestId("paper-pagoda-generation-mark-0").getAttribute("y")).toBe("47");
    expect(screen.getByTestId("paper-pagoda-generation-mark-0").style.fill).toBe(
      "rgb(247, 239, 216)",
    );
    expect(screen.getByTestId(`paper-pagoda-connector-${rootId}`).getAttribute("stroke")).toBe(
      "var(--df-paper-line)",
    );
    expect(screen.getByTestId(`paper-node-${rootId}`)).toBeTruthy();
    expect(screen.getByTestId(`paper-node-${childId}`)).toBeTruthy();
    expect(screen.queryByText(/Birth: 1815/)).toBeNull();
  });

  it("aligns Pagoda names to connector centers and uses readable Chinese ordinal labels", () => {
    const wide = makeWideGenerationGraph(3);
    const thirdChild = wide.graph.nodes[3];
    const childNodesData: Record<string, NodeData> = Object.fromEntries(
      wide.graph.nodes.slice(1).map((node) => [
        node.id,
        {
          id: node.id,
          personHash: node.personHash,
          versionIndex: node.versionIndex,
          gender: 1,
        },
      ]),
    );
    childNodesData[wide.rootId] = {
      id: wide.rootId,
      personHash: wide.graph.nodes[0].personHash,
      versionIndex: wide.graph.nodes[0].versionIndex,
      fullName: "清河公主",
    };

    render(
      <PaperGenealogyView
        style="pagoda"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={childNodesData}
        hasRoot
      />,
    );

    const thirdName = screen.getByTestId(`paper-pagoda-name-${thirdChild.id}`);
    const thirdRelation = screen.getByTestId(`paper-pagoda-relation-${thirdChild.id}`);
    const thirdRelationPosition = screen.getByTestId(
      `paper-pagoda-relation-position-${thirdChild.id}`,
    );
    const thirdStem = screen.getByTestId(`paper-pagoda-child-stem-${thirdChild.id}`);
    const thirdNode = screen.getByTestId(`paper-node-${thirdChild.id}`);
    const rootNode = screen.getByTestId(`paper-node-${wide.rootId}`);
    const rootConnectorStem = screen
      .getByTestId(`paper-pagoda-connector-${wide.rootId}`)
      .querySelector("line");
    const relationTranslate = thirdRelationPosition.getAttribute("transform") || "";
    const relationPosition = relationTranslate.match(/translate\(([-\d.]+), ([-\d.]+)\)/);
    const relationX = Number(relationPosition?.[1]);
    const relationY = Number(relationPosition?.[2]);
    const nodeTranslate = thirdNode.getAttribute("transform") || "";
    const nodePosition = nodeTranslate.match(/translate\(([-\d.]+), ([-\d.]+)\)/);
    const nodeY = Number(nodePosition?.[2]);
    const rootTranslate = rootNode.getAttribute("transform") || "";
    const rootPosition = rootTranslate.match(/translate\(([-\d.]+), ([-\d.]+)\)/);
    const rootY = Number(rootPosition?.[2]);

    expect(screen.getByTestId("paper-pagoda-relation-layer")).toBeTruthy();
    expect(screen.getByTestId(`paper-pagoda-name-${wide.rootId}`).textContent).toBe("清河公主");
    expect(Number(rootConnectorStem?.getAttribute("y1"))).toBe(rootY + 116);
    expect(thirdName.getAttribute("x")).toBe("24");
    expect(thirdName.getAttribute("y")).toBe("28");
    expect(thirdName.style.fontSize).toBe("19px");
    expect(thirdName.style.fontWeight).toBe("700");
    expect(thirdName.style.letterSpacing).toBe("0px");
    expect(thirdName.style.textAlign).toBe("right");
    expect(relationX).toBe(
      Number(thirdStem.getAttribute("x1")) - 12,
    );
    expect(relationY).toBeGreaterThan(Number(thirdStem.getAttribute("y1")));
    expect(relationY).toBeLessThan(Number(thirdStem.getAttribute("y2")));
    expect(thirdRelation.getAttribute("x")).toBe("0");
    expect(thirdRelation.getAttribute("y")).toBe("0");
    expect(Number(thirdStem.getAttribute("y2"))).toBeGreaterThan(
      Number(thirdStem.getAttribute("y1")),
    );
    expect(Number(thirdStem.getAttribute("y2"))).toBe(
      nodeY + Number(thirdName.getAttribute("y")) - 8,
    );
    expect(thirdRelation.textContent).toBe("三子");
    expect(thirdRelation.textContent).not.toContain("3");
    expect(thirdRelation.style.fontSize).toBe("11px");
    expect(thirdRelation.style.fontWeight).toBe("400");
  });

  it("omits Pagoda branch page labels", () => {
    const wide = makeWideGenerationGraph(16);

    render(
      <PaperGenealogyView
        style="pagoda"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-pagoda-frame-1-2")).toBeTruthy();
    expect(screen.queryByText(/第\s*\d+\s*支/)).toBeNull();
  });

  it("renders Lineage as an Ou-style paged spread with person relationship lines", () => {
    const linear = makeLinearGraph(6);
    const linearNodesData = linear.rootId
      ? {
          [linear.rootId]: {
            id: linear.rootId,
            personHash: linear.graph.nodes[0].personHash,
            versionIndex: 1,
            fullName: "贾源",
            birthYear: 1815,
          },
          [linear.graph.nodes[1].id]: {
            id: linear.graph.nodes[1].id,
            personHash: linear.graph.nodes[1].personHash,
            versionIndex: 1,
            fullName: "贾演",
            gender: 1,
          },
        }
      : {};
    const generations = buildPaperGenerations({
      graph: linear.graph,
      nodesData: linearNodesData,
      t: zhTranslate,
    });
    const book = buildLineagePaperBook({
      graph: linear.graph,
      rootId: linear.rootId,
      generations,
      t: zhTranslate,
    });

    expect(book.charts).toHaveLength(2);
    expect(book.charts[0].generationDepths).toEqual([0, 1, 2, 3, 4]);
    expect(book.charts[1].repeatedDepth).toBe(4);

    render(
      <PaperGenealogyView
        style="lineage"
        graph={linear.graph}
        rootId={linear.rootId}
        nodesData={linearNodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-lineage")).toBeTruthy();
    expect(screen.getByTestId("paper-lineage-table-1")).toBeTruthy();
    expect(screen.queryByTestId("paper-lineage-table-2")).toBeNull();
    expect(screen.getByTestId("paper-lineage-spread-2-1")).toBeTruthy();
    expect(screen.getByTestId("paper-lineage-spread-1-1").className).toContain("min-w-[1180px]");
    expect(screen.getByTestId("paper-lineage-spread-1-1").className).toContain(
      "grid-cols-[1fr_72px_1fr]",
    );
    expect(screen.getByTestId("paper-lineage-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-lineage-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-lineage-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getByTestId("paper-lineage-page-right-1-1")).toBeTruthy();
    expect(
      screen
        .getByTestId("paper-lineage-right-1-1")
        .querySelector('[data-testid="paper-lineage-generation-mark-0"]')?.textContent,
    ).toContain("一世");
    expect(
      screen
        .getByTestId("paper-lineage-left-1-1")
        .querySelector('[data-testid="paper-lineage-generation-mark-0"]'),
    ).toBeNull();
    expect(screen.getByTestId("paper-lineage-right-1-1").textContent).not.toContain("贾氏族谱");
    expect(
      screen.getByTestId(`paper-lineage-connector-${linear.rootId}`).getAttribute("stroke"),
    ).toBe("var(--df-paper-line)");
    expect(screen.getByTestId(`paper-lineage-name-${linear.rootId}`).textContent).toContain(
      "贾源",
    );
    expect(screen.getByTestId(`paper-lineage-root-stem-${linear.rootId}`)).toBeTruthy();
    expect(
      screen.queryByTestId(`paper-lineage-root-stem-${linear.graph.nodes[1].id}`),
    ).toBeNull();
    expect(screen.getByTestId(`paper-lineage-relation-${linear.rootId}`).textContent).toContain(
      "ancestor",
    );
    expect(screen.getByTestId(`paper-lineage-relation-${linear.graph.nodes[1].id}`).textContent).toBe(
      "之子",
    );
    expect(screen.queryByText(/Birth: 1815/)).toBeNull();
  });

  it("renders an empty state when no root is available", () => {
    render(
      <PaperGenealogyView
        style="ou"
        graph={{ nodes: [], edges: [], childrenByParent: {} }}
        rootId={null}
        nodesData={{}}
        hasRoot={false}
        contractMessage="Select a root"
      />,
    );

    expect(screen.getByTestId("paper-genealogy-empty")).toBeTruthy();
    expect(screen.getByText("Select a root")).toBeTruthy();
  });
});
