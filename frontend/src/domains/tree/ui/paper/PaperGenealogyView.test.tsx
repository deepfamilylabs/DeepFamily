// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNodeId, type NodeData } from "../../../../shared/model";
import { buildPaperGenerations, splitPaperRecordLines } from "./paperData";
import { PaperGenealogyView } from "./PaperGenealogyView";
import { buildLineagePaperBook } from "./layout/lineagePagination";
import {
  buildOuPaperBook,
  getOuFullRecordText,
  getOuRecordSlotSpan,
  OU_NAME_LANE_WIDTH,
  OU_PAGE_EDGE_PADDING,
  OU_PERSON_CONTINUATION_BASE_WIDTH,
  OU_PERSON_CONTINUATION_MIN_WIDTH,
  OU_PERSON_BASE_WIDTH,
  OU_PERSON_MIN_WIDTH,
  OU_RECORD_COLUMN_WIDTH,
  OU_RECORD_SPLIT_UNIT_TOLERANCE,
  OU_RECORD_UNITS_PER_COLUMN,
} from "./layout/ouPagination";
import { measureRecordUnits } from "./paperText";
import { ModernBookRenderer, MODERN_RECORD_UNITS_PER_ROW } from "./renderers/ModernBookRenderer";
import {
  buildDiejiPaperBook,
  getDiejiFullRecordText,
  getDiejiPersonLaneKeys,
  DIEJI_LEFT_PAGE_LANE_CAPACITY,
  DIEJI_RIGHT_PAGE_LANE_CAPACITY,
} from "./layout/diejiPagination";

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
    "genealogyBook.fields.spouse": "配偶",
    "genealogyBook.fields.spouseWife": "配",
    "genealogyBook.fields.spouseHusband": "適",
    "genealogyBook.generationLabel": "第 {{number}} 世",
    "genealogyBook.rootLabel": "始祖",
    "genealogyBook.firstSon": "长子",
    "genealogyBook.secondSon": "次子",
    "genealogyBook.nthSon": "{{han}}子",
    "genealogyBook.firstDaughter": "长女",
    "genealogyBook.secondDaughter": "次女",
    "genealogyBook.nthDaughter": "{{han}}女",
    "genealogyBook.onlySon": "之子",
    "genealogyBook.onlyDaughter": "之女",
    "genealogyBook.modernSonsCount": "传子{{han}}",
    "genealogyBook.modernDaughtersCount": "传女{{han}}",
    "genealogyBook.modernIssueCount": "传嗣{{han}}",
    "genealogyBook.modernPageRef": "[见{{han}}页]",
    "genealogyBook.repeatedGeneration": "重列",
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

    const diejiBook = buildDiejiPaperBook({ generations, t: zhTranslate });
    const childLane = diejiBook.charts[0].spreads
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

  it("projects shared paper relation labels ranked per gender within each parent", () => {
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
    const book = buildDiejiPaperBook({ generations, t: zhTranslate });
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

    const book = buildDiejiPaperBook({ generations, t: zhTranslate });
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

  it("lists children by name in the data layer but omits the 子女 line from vertical paper records", () => {
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

    // Data layer still records children by name (not a "子女: 4" count) so styles can use it.
    const rootDetails = generations[0].people[0].detailLines.join(" ");
    expect(rootDetails).toContain("子女: 张一、张二、张三、张四");
    expect(rootDetails).not.toContain("子嗣");
    expect(rootDetails).not.toContain("子女: 4");

    // Only the Modern style lists children in its body text; vertical paper records omit the 子女 line.
    const diejiRootLanes = buildDiejiPaperBook({ generations, t: zhTranslate }).charts[0].spreads
      .flatMap((spread) => spread.lanes)
      .filter((lane) => lane.kind === "person" && lane.person.id === root.id);
    expect(diejiRootLanes).toHaveLength(1);
    expect(diejiRootLanes[0]?.kind === "person" ? diejiRootLanes[0].text : "").not.toContain("子女");

    const ouRootEntries = buildOuPaperBook({ generations, t: zhTranslate }).charts[0].spreads
      .flatMap((spread) => spread.rows)
      .flatMap((row) => row.entries)
      .filter((entry) => entry.person.id === root.id);
    expect(ouRootEntries).toHaveLength(1);
    expect(ouRootEntries[0].text).not.toContain("子女");
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
    expect(screen.getByText("Modern Ledger").style.fontSize).toBe("20px");
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
    const modernSpine = screen.getByTestId("paper-modern-spine-1-1");
    expect(modernSpine).toBeTruthy();
    expect(modernSpine.textContent).toContain("卷一");
    expect(modernSpine.textContent).toContain("一");
    expect(modernSpine.textContent).toContain("二");
    expect(modernSpine.textContent).toContain("DeepFamily");
    expect(modernSpine.textContent).not.toContain("Main chart");
    expect(screen.getByTestId("paper-modern-spine-1-1-pages").textContent).toBe("一二");
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
    expect(rootDetailRows[1].textContent).toContain("issue 1");
    expect(rootDetailRows[1].textContent).toContain("0xbbbb");
    expect(rootDetailRows[1].textContent).toContain("[p. 1]");
    expect(screen.getByTestId(`paper-modern-relation-${rootId}`).className).not.toContain(
      "font-bold",
    );
  });

  it("uses transmission counts and page references for modern ledger children", () => {
    const parentHash = makeHash(301);
    const sonHash = makeHash(302);
    const daughterHash = makeHash(303);
    const parent = {
      id: makeNodeId(parentHash, 1),
      depth: 0,
      personHash: parentHash,
      versionIndex: 1,
    };
    const son = {
      id: makeNodeId(sonHash, 1),
      depth: 1,
      personHash: sonHash,
      versionIndex: 1,
    };
    const daughter = {
      id: makeNodeId(daughterHash, 1),
      depth: 1,
      personHash: daughterHash,
      versionIndex: 1,
    };
    const generations = buildPaperGenerations({
      graph: {
        nodes: [parent, son, daughter],
        edges: [
          { from: parent.id, to: son.id },
          { from: parent.id, to: daughter.id },
        ],
        childrenByParent: {
          [parent.id]: [son.id, daughter.id],
        },
      },
      nodesData: {
        [parent.id]: {
          id: parent.id,
          personHash: parent.personHash,
          versionIndex: 1,
          fullName: "贾代善",
        },
        [son.id]: {
          id: son.id,
          personHash: son.personHash,
          versionIndex: 1,
          fullName: "贾敷",
          gender: 1,
        },
        [daughter.id]: {
          id: daughter.id,
          personHash: daughter.personHash,
          versionIndex: 1,
          fullName: "贾敏",
          gender: 2,
        },
      },
      t: zhTranslate,
    });

    render(<ModernBookRenderer generations={generations} t={zhTranslate} />);

    const parentRecord = screen
      .getAllByTestId(`paper-modern-detail-${parent.id}`)
      .map((row) => row.textContent || "")
      .join("");
    expect(parentRecord).toContain("传子一");
    expect(parentRecord).toContain("传女一");
    expect(parentRecord).toContain("贾敷 [见一页]");
    expect(parentRecord).toContain("贾敏 [见一页]");
    expect(parentRecord).not.toContain("子女");
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
    // Record text is a top-aligned, justified block with chunks cut at the two-line visual budget.
    expect(detailRows[0].className).toContain("block");
    expect(detailRows[0].style.textAlign).toBe("justify");
    // The last line stays natural; forcing text-align-last: justify creates oversized spacing.
    expect(detailRows[0].style.textAlignLast).toBe("auto");
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
    expect(screen.getAllByTestId("paper-modern-generation-4")).toHaveLength(1);
    expect(screen.getByTestId("paper-modern-generation-5")).toBeTruthy();
  });

  it("renders Ou-style as five-generation tables with the boundary generation repeated", () => {
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
    const ouSpine = screen.getByTestId("paper-ou-spine-1-1");
    expect(ouSpine.textContent).toContain("贾氏族谱");
    expect(ouSpine.textContent).toContain("卷一");
    expect(ouSpine.textContent).toContain("一");
    expect(ouSpine.textContent).toContain("二");
    expect(ouSpine.textContent).toContain("DeepFamily");
    expect(ouSpine.textContent).not.toContain("Main chart");
    expect(screen.getByTestId("paper-ou-spine-1-1-pages").textContent).toBe("二一");
    expect(screen.getAllByTestId("paper-ou-generation-4")).toHaveLength(2);
    expect(screen.getAllByText("repeated").length).toBeGreaterThan(0);
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
    expect(screen.getByTestId("paper-ou-entry-lane-1-1-right-1").style.paddingLeft).toBe("");
    expect(screen.getByTestId("paper-ou-entry-lane-1-1-left-1").style.paddingLeft).toBe(
      `${OU_PAGE_EDGE_PADDING}px`,
    );
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
    const renderedParts = screen
      .getAllByTestId(`paper-row-${child.id}`)
      .sort(
        (a, b) =>
          Number(a.getAttribute("data-part-index")) - Number(b.getAttribute("data-part-index")),
      );
    const renderedDetails = screen
      .getAllByTestId(`paper-ou-detail-${child.id}`)
      .sort(
        (a, b) =>
          Number(a.parentElement?.getAttribute("data-part-index")) -
          Number(b.parentElement?.getAttribute("data-part-index")),
      );
    expect(renderedParts[0].getAttribute("data-continues-after")).toBe("true");
    expect(renderedParts[renderedParts.length - 1].getAttribute("data-continues-after")).toBe(
      "false",
    );
    expect(renderedDetails[0].style.textAlignLast).toBe("justify");
    expect(renderedDetails[renderedDetails.length - 1].style.textAlignLast).toBe("auto");
  });

  it("fills digit-heavy Ou-style chunks by visual width before splitting", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const digitHeavyStory = "A1234567890,".repeat(140);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹数",
          story: digitHeavyStory,
        },
      },
      t: zhTranslate,
    });

    const person = generations[1].people[0];
    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .filter((entry) => entry.person.id === person.id);
    const firstEntry = renderedEntries[0];
    const firstContinuedEntry = renderedEntries.find(
      (entry) => entry.continued && entry.partIndex < entry.totalPartCount,
    );
    expect(firstEntry).toBeTruthy();
    if (!firstEntry) throw new Error("missing first Ou continuation chunk");
    expect(firstContinuedEntry).toBeTruthy();
    if (!firstContinuedEntry) throw new Error("missing continued Ou continuation chunk");
    const firstChunkCapacity =
      Math.floor((firstEntry.widthPx - OU_PERSON_BASE_WIDTH) / OU_RECORD_COLUMN_WIDTH) *
      OU_RECORD_UNITS_PER_COLUMN;
    const firstChunkUnits = measureRecordUnits(firstEntry.text);
    const continuedChunkCapacity =
      Math.floor(
        (firstContinuedEntry.widthPx - OU_PERSON_CONTINUATION_BASE_WIDTH) /
          OU_RECORD_COLUMN_WIDTH,
      ) * OU_RECORD_UNITS_PER_COLUMN;
    const continuedCapacityWithNameLane =
      Math.floor((firstContinuedEntry.widthPx - OU_PERSON_BASE_WIDTH) / OU_RECORD_COLUMN_WIDTH) *
      OU_RECORD_UNITS_PER_COLUMN;
    const continuedChunkUnits = measureRecordUnits(firstContinuedEntry.text);

    expect(renderedEntries.length).toBeGreaterThan(1);
    expect(renderedEntries.map((entry) => entry.text).join("")).toBe(getOuFullRecordText(person));
    expect(firstChunkUnits).toBeLessThanOrEqual(firstChunkCapacity);
    expect(firstChunkUnits).toBeGreaterThan(
      firstChunkCapacity - OU_RECORD_SPLIT_UNIT_TOLERANCE,
    );
    expect(Array.from(firstEntry.text).length).toBeGreaterThan(firstChunkCapacity / 2);
    expect(continuedChunkCapacity).toBeGreaterThan(continuedCapacityWithNameLane);
    expect(continuedChunkUnits).toBeLessThanOrEqual(continuedChunkCapacity);
    expect(continuedChunkUnits).toBeGreaterThan(
      continuedChunkCapacity - OU_RECORD_SPLIT_UNIT_TOLERANCE,
    );
  });

  it("sizes short Ou-style continuation fragments to their visible columns", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const rightColumnCount = 2;
    const tailChars = 5;
    const story = "才".repeat((OU_RECORD_UNITS_PER_COLUMN / 2) * rightColumnCount + tailChars);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹续",
          story,
        },
      },
      t: zhTranslate,
    });
    const rightWidth = OU_PERSON_BASE_WIDTH + OU_RECORD_COLUMN_WIDTH * rightColumnCount;
    const person = generations[1].people[0];
    const book = buildOuPaperBook({
      generations,
      t: zhTranslate,
      pageBodyWidths: {
        right: rightWidth,
        left: 280,
      },
    });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .filter((entry) => entry.person.id === person.id);
    const continuation = renderedEntries.find((entry) => entry.continued);

    expect(renderedEntries).toHaveLength(2);
    expect(renderedEntries.map((entry) => entry.text).join("")).toBe(getOuFullRecordText(person));
    expect(renderedEntries[0].widthPx).toBe(rightWidth);
    expect(measureRecordUnits(continuation?.text || "")).toBeLessThanOrEqual(
      OU_RECORD_UNITS_PER_COLUMN,
    );
    expect(continuation?.widthPx).toBe(OU_PERSON_CONTINUATION_MIN_WIDTH);
    expect(continuation?.widthPx).toBeLessThan(OU_PERSON_MIN_WIDTH);
  });

  it("fills the Ou-style right page spine column before crossing the spine", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹植",
          story: "才高辞丽文采风流宗族修谱传承有序".repeat(10),
        },
      },
      t: zhTranslate,
    });
    const rightColumnCount = 3;
    const renderedCjkCharsPerColumn = 11;
    const rightWidth = OU_PERSON_BASE_WIDTH + OU_RECORD_COLUMN_WIDTH * rightColumnCount;
    const person = generations[1].people[0];
    const book = buildOuPaperBook({
      generations,
      t: zhTranslate,
      pageBodyWidths: {
        right: rightWidth,
        left: 280,
      },
    });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .filter((entry) => entry.person.id === person.id);
    const firstEntry = renderedEntries[0];
    const leftContinuation = renderedEntries.find((entry) => entry.side === "left");

    expect(firstEntry).toBeTruthy();
    if (!firstEntry) throw new Error("missing first Ou split chunk");
    expect(leftContinuation).toBeTruthy();
    expect(renderedEntries.map((entry) => entry.text).join("")).toBe(getOuFullRecordText(person));
    expect(firstEntry.side).toBe("right");
    expect(firstEntry.widthPx).toBe(rightWidth);
    expect(Array.from(firstEntry.text)).toHaveLength(
      rightColumnCount * renderedCjkCharsPerColumn,
    );
    expect(measureRecordUnits(firstEntry.text)).toBe(
      rightColumnCount * renderedCjkCharsPerColumn * 2,
    );
  });

  it("does not use the old overfull Ou-style split point beside the spine", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {
        [child.id]: {
          id: child.id,
          personHash: child.personHash,
          versionIndex: 1,
          tokenId: "2",
          fullName: "曹植",
          birthYear: 192,
          deathYear: 232,
          story:
            "曹植（192—232），字子建，曹操与卞氏之子、曹丕同母弟，建安文学代表作者。" +
            "早年以才学受曹操重视，储位之争后渐失信任，曹丕、曹叡两朝屡遭贬爵迁封。",
        },
      },
      t: zhTranslate,
    });
    const rightColumnCount = 5;
    const rightWidth = OU_PERSON_BASE_WIDTH + OU_RECORD_COLUMN_WIDTH * rightColumnCount;
    const person = generations[1].people[0];
    const book = buildOuPaperBook({
      generations,
      t: zhTranslate,
      pageBodyWidths: {
        right: rightWidth,
        left: 280,
      },
    });
    const renderedEntries = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .filter((entry) => entry.person.id === person.id);
    const firstEntry = renderedEntries[0];

    expect(firstEntry).toBeTruthy();
    if (!firstEntry) throw new Error("missing Cao Zhi Ou split chunk");
    expect(renderedEntries.map((entry) => entry.text).join("")).toBe(getOuFullRecordText(person));
    expect(firstEntry.side).toBe("right");
    expect(firstEntry.text.endsWith("视，储位之争")).toBe(false);
    expect(measureRecordUnits(firstEntry.text)).toBeGreaterThan(
      rightColumnCount * OU_RECORD_UNITS_PER_COLUMN - OU_RECORD_SPLIT_UNIT_TOLERANCE,
    );
    expect(measureRecordUnits(firstEntry.text)).toBeLessThanOrEqual(
      rightColumnCount * OU_RECORD_UNITS_PER_COLUMN,
    );
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
          story: "续排测试，确认左页会继续承接。",
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
    const leftEntries = firstSpreadEntries.filter((entry) => entry.side === "left");

    expect(firstChart.spreads).toHaveLength(1);
    expect(firstSpreadEntries.filter((entry) => entry.side === "right")).toHaveLength(3);
    expect(leftEntries.length).toBeGreaterThan(0);
    expect(leftEntries.some((entry) => entry.continued)).toBe(true);
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
    const firstChildNameLane = firstChildName.parentElement;

    expect(firstChildName.style.textAlign).toBe("right");
    expect(firstChildName.style.writingMode).toBe("vertical-rl");
    expect(firstChildNameLane?.style.width).toBe(`${OU_NAME_LANE_WIDTH}px`);
    expect(firstChildNameLane?.className).not.toContain("border-l");
    expect(firstChildEntry.className).not.toContain("border-l");
    expect(firstChildEntry.style.flexGrow).toBe("0");
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

  it("shows the shared father-name relation label above each Ou-style name", () => {
    const wide = makeWideGenerationGraph(2);
    const [root, firstSon, secondSon] = wide.graph.nodes;

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "曹操",
          },
          [firstSon.id]: {
            id: firstSon.id,
            personHash: firstSon.personHash,
            versionIndex: 1,
            gender: 1,
            birthYear: 187,
          },
          [secondSon.id]: {
            id: secondSon.id,
            personHash: secondSon.personHash,
            versionIndex: 1,
            gender: 1,
            birthYear: 189,
          },
        }}
        hasRoot
      />,
    );

    // Parentage sits in the name lane, above the name, as two centered vertical columns: the
    // father name on the right and the rank word on the left.
    const firstRelation = screen.getByTestId(`paper-ou-relation-${firstSon.id}`);
    expect(firstRelation.textContent).toBe("曹操长子");
    expect(firstRelation.style.display).toBe("inline-flex");
    expect(firstRelation.style.flexDirection).toBe("row-reverse");
    expect(firstRelation.style.alignItems).toBe("center");
    const firstRelationColumns = Array.from(firstRelation.children) as HTMLElement[];
    expect(firstRelationColumns.map((column) => column.textContent)).toEqual(["曹操", "长子"]);
    expect(firstRelationColumns[0]?.style.writingMode).toBe("vertical-rl");
    const nameLane = screen.getByTestId(`paper-ou-name-${firstSon.id}`).parentElement;
    expect(nameLane?.firstElementChild).toBe(firstRelation);
    // Relation and name are centered in the lane, so the single-column 始祖 is centered.
    expect(nameLane?.className).toContain("items-center");
    expect(screen.getByTestId(`paper-ou-relation-${secondSon.id}`).textContent).toBe("曹操次子");
    // The root keeps the shared 始祖 relation label.
    expect(screen.getByTestId(`paper-ou-relation-${root.id}`).textContent).toContain("ancestor");
    // The label is no longer duplicated inline at the head of the biography body.
    expect(screen.getByTestId(`paper-ou-detail-${firstSon.id}`).textContent).not.toContain(
      "曹操长子",
    );
  });

  it("center-aligns uneven Ou-style father and birth-rank relation columns", () => {
    const wide = makeWideGenerationGraph(27);
    const [root, ...children] = wide.graph.nodes;
    const target = children[26];

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "曹操",
          },
          ...Object.fromEntries(
            children.map((child) => [
              child.id,
              {
                id: child.id,
                personHash: child.personHash,
                versionIndex: 1,
                gender: 1,
              },
            ]),
          ),
        }}
        hasRoot
      />,
    );

    const relation = screen.getByTestId(`paper-ou-relation-${target.id}`);
    const columns = Array.from(relation.children) as HTMLElement[];

    expect(relation.style.display).toBe("inline-flex");
    expect(relation.style.flexDirection).toBe("row-reverse");
    expect(relation.style.alignItems).toBe("center");
    expect(relation.style.columnGap).toBe("0px");
    expect(relation.style.lineHeight).toBe("1");
    expect(columns.map((column) => column.textContent)).toEqual(["曹操", "二十七子"]);
    expect(columns.every((column) => column.style.writingMode === "vertical-rl")).toBe(true);
    expect(columns.every((column) => column.style.lineHeight === "1")).toBe(true);
  });

  it("keeps five-character Ou-style parent names in relation columns", () => {
    const wide = makeWideGenerationGraph(25);
    const [root, ...children] = wide.graph.nodes;
    const target = children[24];

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "西乡哀侯曹",
          },
          ...Object.fromEntries(
            children.map((child) => [
              child.id,
              {
                id: child.id,
                personHash: child.personHash,
                versionIndex: 1,
                gender: 1,
              },
            ]),
          ),
        }}
        hasRoot
      />,
    );

    const relation = screen.getByTestId(`paper-ou-relation-${target.id}`);
    const columns = Array.from(relation.children) as HTMLElement[];

    expect(relation.textContent).toBe("西乡哀侯曹二十五子");
    expect(columns.map((column) => column.textContent)).toEqual(["西乡哀侯曹", "二十五子"]);
  });

  it("keeps overlong Ou-style parent names in relation columns", () => {
    const wide = makeWideGenerationGraph(1);
    const [root, child] = wide.graph.nodes;

    render(
      <PaperGenealogyView
        style="ou"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "西乡哀侯曹赞",
          },
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            gender: 1,
          },
        }}
        hasRoot
      />,
    );

    const relation = screen.getByTestId(`paper-ou-relation-${child.id}`);
    const columns = Array.from(relation.children) as HTMLElement[];

    expect(relation.textContent).toBe("西乡哀侯曹赞之子");
    expect(relation.textContent).not.toContain("…");
    expect(columns.map((column) => column.textContent)).toEqual(["西乡哀侯曹赞", "之子"]);
    expect(columns.every((column) => column.style.writingMode === "vertical-rl")).toBe(true);
  });

  it("renders Dieji-style as five-generation vertical charts with the boundary generation repeated", () => {
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
    const book = buildDiejiPaperBook({ generations, t: zhTranslate });

    expect(
      book.charts
        .flatMap((chart) => chart.spreads)
        .every(
          (spread) =>
            spread.rightLanes.length === DIEJI_RIGHT_PAGE_LANE_CAPACITY &&
            spread.leftLanes.length === DIEJI_LEFT_PAGE_LANE_CAPACITY,
        ),
    ).toBe(true);
    expect(book.charts[0].spreads[0].lanes.some((lane) => lane.kind === "blank")).toBe(false);
    expect(book.charts[0].generationDepths).toEqual([0, 1, 2, 3, 4]);
    expect(book.charts[1].generationDepths).toEqual([4, 5, 6, 7, 8]);
    expect(book.charts[1].repeatedDepth).toBe(4);
    expect(
      [...book.charts[0].spreads[0].rightLanes, ...book.charts[0].spreads[0].leftLanes].some(
        (lane) => lane.kind === "blank",
      ),
    ).toBe(true);

    render(
      <PaperGenealogyView
        style="dieji"
        graph={linear.graph}
        rootId={linear.rootId}
        nodesData={linearNodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-dieji")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-table-1")).toBeTruthy();
    expect(screen.queryByTestId("paper-dieji-table-2")).toBeNull();
    expect(screen.getByTestId("paper-dieji-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-spread-2-1")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-spread-1-1").className).toContain("min-w-[1180px]");
    expect(screen.getByTestId("paper-dieji-spread-1-1").className).toContain(
      "grid-cols-[1fr_72px_1fr]",
    );
    expect(screen.getByTestId("paper-dieji-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-right-1-1").firstElementChild?.className).not.toContain(
      "border-x",
    );
    expect(screen.getByTestId("paper-dieji-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getAllByTestId("paper-dieji-generation-4")).toHaveLength(2);
    expect(screen.getAllByText("repeated").length).toBeGreaterThan(0);
    expect(screen.getByTestId("paper-dieji-generation-5")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-generation-mark-0").textContent).toContain("一世");
    expect(screen.getByTestId("paper-dieji-generation-mark-0").className).toContain("w-full");
    expect(screen.getByTestId("paper-dieji-generation-mark-0").style.width).toBe("");
    expect(screen.queryByTestId("paper-svg-dieji")).toBeNull();

    const rootRows = screen.getAllByTestId(`paper-row-${linear.rootId}`);
    expect(rootRows[0].style.gridTemplateRows).toBe("64px 96px 1fr");
    expect(rootRows[0].style.flexGrow).toBe("1");
    expect(rootRows[0].style.minWidth).toBe("0px");
    expect(rootRows[0].style.width).toBe("0px");
    expect(screen.getByTestId("paper-dieji-generation-0").style.flexGrow).toBe("1");
    expect(screen.getByTestId("paper-dieji-generation-0").style.minWidth).toBe("0px");
    expect(screen.getByTestId("paper-dieji-generation-0").style.gridTemplateRows).toBe(
      "64px 96px 1fr",
    );
    const firstBlankLane = screen.getAllByTestId(/^paper-dieji-blank-/)[0];
    expect(firstBlankLane.style.gridTemplateRows).toBe("64px 96px 1fr");
    expect(firstBlankLane.style.flexGrow).toBe("1");
    expect(firstBlankLane.style.minWidth).toBe("0px");
    expect(screen.getAllByTestId(`paper-dieji-relation-${linear.rootId}`)[0].textContent).toContain(
      "ancestor",
    );
    expect(screen.getAllByTestId(`paper-dieji-relation-${linear.rootId}`)[0].className).not.toContain(
      "font-bold",
    );
    expect(screen.getAllByTestId(`paper-dieji-name-${linear.rootId}`)[0].textContent).toContain(
      "贾源",
    );
    const rootDetail = screen.getAllByTestId(`paper-dieji-detail-${linear.rootId}`)[0];
    expect(rootDetail.className).toContain("w-fit");
    expect(rootDetail.parentElement?.className).toContain("justify-center");
    expect(rootRows[0].textContent).not.toContain("1.1");
  });

  it("center-aligns uneven Dieji-style father and birth-rank relation columns", () => {
    const wide = makeWideGenerationGraph(23);
    const [root, ...children] = wide.graph.nodes;
    const target = children[22];

    render(
      <PaperGenealogyView
        style="dieji"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "曹操",
          },
          ...Object.fromEntries(
            children.map((child) => [
              child.id,
              {
                id: child.id,
                personHash: child.personHash,
                versionIndex: 1,
                gender: 1,
              },
            ]),
          ),
        }}
        hasRoot
      />,
    );

    const relationCell = screen.getByTestId(`paper-dieji-relation-${target.id}`);
    const relation = relationCell.firstElementChild as HTMLElement | null;
    const columns = Array.from(relation?.children || []) as HTMLElement[];

    expect(relationCell.textContent).toBe("曹操二十三子");
    expect(relation?.style.display).toBe("inline-flex");
    expect(relation?.style.flexDirection).toBe("row-reverse");
    expect(relation?.style.alignItems).toBe("center");
    expect(relation?.style.columnGap).toBe("0px");
    expect(relation?.style.lineHeight).toBe("1");
    expect(columns.map((column) => column.textContent)).toEqual(["曹操", "二十三子"]);
    expect(columns.every((column) => column.style.writingMode === "vertical-rl")).toBe(true);
    expect(columns.every((column) => column.style.lineHeight === "1")).toBe(true);
  });

  it("keeps five-character Dieji-style parent names in relation columns", () => {
    const wide = makeWideGenerationGraph(25);
    const [root, ...children] = wide.graph.nodes;
    const target = children[24];

    render(
      <PaperGenealogyView
        style="dieji"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "西乡哀侯曹",
          },
          ...Object.fromEntries(
            children.map((child) => [
              child.id,
              {
                id: child.id,
                personHash: child.personHash,
                versionIndex: 1,
                gender: 1,
              },
            ]),
          ),
        }}
        hasRoot
      />,
    );

    const relationCell = screen.getByTestId(`paper-dieji-relation-${target.id}`);
    const relation = relationCell.firstElementChild as HTMLElement | null;
    const columns = Array.from(relation?.children || []) as HTMLElement[];

    expect(relationCell.textContent).toBe("西乡哀侯曹二十五子");
    expect(columns.map((column) => column.textContent)).toEqual(["西乡哀侯曹", "二十五子"]);
  });

  it("wraps overlong Dieji-style relation labels as one full phrase", () => {
    const wide = makeWideGenerationGraph(1);
    const [root, child] = wide.graph.nodes;

    render(
      <PaperGenealogyView
        style="dieji"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [root.id]: {
            id: root.id,
            personHash: root.personHash,
            versionIndex: 1,
            fullName: "西乡哀侯曹赞",
          },
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            gender: 1,
          },
        }}
        hasRoot
      />,
    );

    const relationCell = screen.getByTestId(`paper-dieji-relation-${child.id}`);
    const relation = relationCell.firstElementChild as HTMLElement | null;

    expect(relationCell.textContent).toBe("西乡哀侯曹赞之子");
    expect(relationCell.textContent).not.toContain("…");
    expect(relation?.children).toHaveLength(0);
    expect(relation?.style.writingMode).toBe("vertical-rl");
    expect(relation?.style.height).toBe("100%");
    expect(relation?.style.wordBreak).toBe("break-all");
  });

  it("renders full Dieji-style names instead of clipping long titles", () => {
    const wide = makeWideGenerationGraph(1);
    const child = wide.graph.nodes[1];
    const fullName = "西乡哀侯曹赞奉车都尉郎";

    render(
      <PaperGenealogyView
        style="dieji"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{
          [child.id]: {
            id: child.id,
            personHash: child.personHash,
            versionIndex: 1,
            fullName,
          },
        }}
        hasRoot
      />,
    );

    const name = screen.getByTestId(`paper-dieji-name-${child.id}`);

    expect(name.textContent).toBe(fullName);
    expect(name.textContent).not.toContain("…");
  });

  it("projects Dieji-style continuation spreads when the right-to-left lane stream exceeds one spread", () => {
    const wide = makeWideGenerationGraph(30);
    const generations = buildPaperGenerations({
      graph: wide.graph,
      nodesData: {},
      t: zhTranslate,
    });

    const book = buildDiejiPaperBook({ generations, t: zhTranslate });
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
          spread.rightLanes.length === DIEJI_RIGHT_PAGE_LANE_CAPACITY &&
          spread.leftLanes.length === DIEJI_LEFT_PAGE_LANE_CAPACITY,
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
        (lane) => lane.kind === "person" && lane.text === getDiejiFullRecordText(lane.person),
      ),
    ).toBe(true);
    expect(getDiejiPersonLaneKeys(firstChart.spreads, firstChild.id)).toHaveLength(
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
        style="dieji"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-dieji-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-spread-1-2")).toBeTruthy();
    expect(screen.getByTestId("paper-dieji-right-1-2")).toBeTruthy();
    expect(screen.getByTestId(`paper-dieji-name-${wide.graph.nodes[1].id}`).style.writingMode).toBe(
      "vertical-rl",
    );
    expect(screen.getByTestId(`paper-dieji-name-${wide.graph.nodes[1].id}`).style.textAlign).toBe(
      "right",
    );
  });

  it("splits long Dieji-style records into continued entries instead of hiding text", () => {
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
    const fullRecord = getDiejiFullRecordText(person);
    const book = buildDiejiPaperBook({ generations, t: zhTranslate });
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
    expect(getDiejiPersonLaneKeys(book.charts[0].spreads, person.id).length).toBe(
      renderedEntries.length,
    );

    render(
      <PaperGenealogyView
        style="dieji"
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
      .getAllByTestId(`paper-dieji-name-${child.id}`)
      .map((node) => node.textContent || "");
    expect(names.filter((name) => name.includes("曹启"))).toHaveLength(1);
    expect(names.some((name) => name.includes("续"))).toBe(false);
    expect(names.some((name) => name.trim() === "")).toBe(true);
    expect(screen.getAllByTestId(`paper-dieji-detail-${child.id}`)[0].style.wordBreak).toBe(
      "break-all",
    );
    expect(screen.getAllByTestId(`paper-dieji-detail-${child.id}`)[0].className).not.toContain(
      "overflow-hidden",
    );
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
    expect(book.charts[1].generationDepths).toEqual([4, 5, 6, 7, 8]);
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
    expect(screen.getAllByText("repeated").length).toBeGreaterThan(0);
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
    expect(screen.getByTestId(`paper-lineage-circle-${linear.graph.nodes[1].id}`)).toBeTruthy();
    expect(screen.queryByTestId(`paper-lineage-relation-${linear.graph.nodes[4].id}`)).toBeNull();
    expect(screen.queryByTestId(`paper-lineage-circle-${linear.graph.nodes[4].id}`)).toBeNull();
    expect(screen.queryByText(/Birth: 1815/)).toBeNull();
  });

  it("merges overlapping Lineage connector segments for one parent on a page", () => {
    const wide = makeWideGenerationGraph(16);

    render(
      <PaperGenealogyView
        style="lineage"
        graph={wide.graph}
        rootId={wide.rootId}
        nodesData={{}}
        hasRoot
      />,
    );

    const rightPage = screen.getByTestId("paper-lineage-page-right-1-1");
    expect(
      rightPage.querySelectorAll(
        `[data-testid="paper-lineage-connector-${wide.rootId}"]`,
      ),
    ).toHaveLength(1);
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

describe("paper spouse rendering", () => {
  const makeHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  const husbandHash = makeHash(401);
  const wifeHash = makeHash(402);
  const childHash401 = makeHash(403);
  const husbandId = makeNodeId(husbandHash, 1);
  const wifeId = makeNodeId(wifeHash, 1);
  const child401Id = makeNodeId(childHash401, 1);

  const spouseGraph = {
    nodes: [
      { id: husbandId, depth: 0, personHash: husbandHash, versionIndex: 1 },
      { id: child401Id, depth: 1, personHash: childHash401, versionIndex: 1 },
    ],
    edges: [{ from: husbandId, to: child401Id }],
    childrenByParent: { [husbandId]: [child401Id] },
  };
  const spouseNodesData: Record<string, NodeData> = {
    [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1, gender: 1, fullName: "李三" },
    [wifeId]: { id: wifeId, personHash: wifeHash, versionIndex: 1, gender: 2, fullName: "王氏" },
    [child401Id]: { id: child401Id, personHash: childHash401, versionIndex: 1 },
  };

  it("derives spouses from spouseLinks but keeps them out of the data-layer lines", () => {
    const generations = buildPaperGenerations({
      graph: spouseGraph,
      nodesData: spouseNodesData,
      spouseLinks: new Map([[husbandId, [wifeId]]]),
      t: zhTranslate,
    });
    const husband = generations[0].people[0];
    expect(husband.spouses.map((spouse) => spouse.name)).toEqual(["王氏"]);
    expect(husband.classicalLines.join(" ")).not.toContain("王氏");
    expect(husband.detailLines.join(" ")).not.toContain("王氏");
  });

  it("shows 配王氏 in Dieji and 配偶: 王氏 in Modern; Ou omits spouses", () => {
    const generations = buildPaperGenerations({
      graph: spouseGraph,
      nodesData: spouseNodesData,
      spouseLinks: new Map([[husbandId, [wifeId]]]),
      t: zhTranslate,
    });
    const husband = generations[0].people[0];
    expect(getDiejiFullRecordText(husband, zhTranslate)).toContain("配王氏");
    expect(splitPaperRecordLines(husband, zhTranslate, "labeled").baseLines.join(" ")).toContain(
      "配偶: 王氏",
    );
    expect(getOuFullRecordText(husband, zhTranslate)).not.toContain("王氏");
  });

  it("uses 適 for a woman's record (keyed on her gender)", () => {
    const generations = buildPaperGenerations({
      graph: {
        nodes: [
          { id: wifeId, depth: 0, personHash: wifeHash, versionIndex: 1 },
          { id: child401Id, depth: 1, personHash: childHash401, versionIndex: 1 },
        ],
        edges: [{ from: wifeId, to: child401Id }],
        childrenByParent: { [wifeId]: [child401Id] },
      },
      nodesData: spouseNodesData,
      spouseLinks: new Map([[wifeId, [husbandId]]]),
      t: zhTranslate,
    });
    const wife = generations[0].people[0];
    expect(getDiejiFullRecordText(wife, zhTranslate)).toContain("適李三");
  });

  it("omits the spouse line when no spouseLinks entry is provided", () => {
    const generations = buildPaperGenerations({
      graph: spouseGraph,
      nodesData: spouseNodesData,
      t: zhTranslate,
    });
    const husband = generations[0].people[0];
    expect(husband.spouses).toHaveLength(0);
    expect(getDiejiFullRecordText(husband, zhTranslate)).not.toContain("配");
  });
});
