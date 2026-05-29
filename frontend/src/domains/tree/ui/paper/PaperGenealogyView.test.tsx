// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNodeId, type NodeData } from "../../../../shared/model";
import { buildPaperGenerations } from "./paperData";
import { PaperGenealogyView } from "./PaperGenealogyView";
import { buildOuPaperBook, getOuFullRecordText, getOuRecordSlotSpan } from "./ouPagination";
import { buildSuPaperBook, getSuFullRecordText, getSuPersonLaneKeys } from "./suPagination";

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

const translate = (
  key: string,
  fallback?: string,
  options?: Record<string, unknown>,
) =>
  (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
    String(options?.[name] ?? ""),
  );

const zhTranslate = (
  key: string,
  fallback?: string,
  options?: Record<string, unknown>,
) => {
  const zh: Record<string, string> = {
    "genealogyBook.fields.birth": "生",
    "genealogyBook.fields.death": "卒",
    "genealogyBook.fields.origin": "籍贯",
    "genealogyBook.fields.deathPlace": "卒于",
    "genealogyBook.fields.notes": "附记",
    "genealogyBook.generationLabel": "第 {{number}} 世",
    "genealogyBook.suRootLabel": "始祖",
    "genealogyBook.suFirstSon": "长子",
    "genealogyBook.suSecondSon": "次子",
    "genealogyBook.suNthSon": "{{number}}子",
    "genealogyBook.suFirstDaughter": "长女",
    "genealogyBook.suSecondDaughter": "次女",
    "genealogyBook.suNthDaughter": "{{number}}女",
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
  const root = { id: makeNodeId(rootPersonHash, 1), depth: 0, personHash: rootPersonHash, versionIndex: 1 };
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
    expect(generations[0].people[0].detailLines.join(" ")).toContain("Children: 1");
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

  it("projects Su-style relation labels from same-parent child order only", () => {
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

    expect(firstParentLane?.kind === "person" ? firstParentLane.relationLabel : "").toBe("长子");
    expect(secondParentLane?.kind === "person" ? secondParentLane.relationLabel : "").toBe("次女");
    expect(firstChildLane?.kind === "person" ? firstChildLane.relationLabel : "").toBe("长子");
    expect(secondChildLane?.kind === "person" ? secondChildLane.relationLabel : "").toBe("长女");
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
    expect(screen.getByText("Ada Root")).toBeTruthy();
    expect(screen.getByText(/0xbbbb/)).toBeTruthy();
    expect(screen.getByText(/Birth: 1815/)).toBeTruthy();
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
    expect(screen.getByTestId("paper-ou-table-2")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getAllByTestId("paper-ou-generation-4")).toHaveLength(2);
    expect(screen.getByTestId("paper-ou-generation-5")).toBeTruthy();
    expect(screen.getByTestId("paper-ou-generation-mark-0").textContent).toContain("一世");
  });

  it("projects Ou-style continuation spreads when one generation exceeds page width", () => {
    const wide = makeWideGenerationGraph(8);
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
    expect(new Set(secondGenerationEntries.map((entry) => entry.person.id)).size).toBe(8);
    expect(
      firstSpreadSecondGeneration?.entries.filter((entry) => entry.side === "right"),
    ).toHaveLength(3);
    expect(secondGenerationEntries.every((entry) => entry.text === getOuFullRecordText(entry.person))).toBe(
      true,
    );
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
    const slotSpan = getOuRecordSlotSpan(person);
    const book = buildOuPaperBook({ generations, t: zhTranslate });
    const renderedEntry = book.charts[0].spreads
      .flatMap((spread) => spread.rows.find((row) => row.depth === 1)?.entries || [])
      .find((entry) => entry.person.id === person.id);

    expect(fullRecord).toContain("晚年手订家乘");
    expect(slotSpan).toBeGreaterThan(1);
    expect(renderedEntry?.text).toBe(fullRecord);
    expect(renderedEntry?.slotSpan).toBe(slotSpan);
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

    render(
      <PaperGenealogyView
        style="su"
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

    expect(screen.getByTestId("paper-su")).toBeTruthy();
    expect(screen.getByTestId("paper-su-table-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-table-2")).toBeTruthy();
    expect(screen.getByTestId("paper-su-spread-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-right-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-spine-1-1").textContent).toContain("贾氏族谱");
    expect(screen.getAllByTestId("paper-su-generation-4")).toHaveLength(2);
    expect(screen.getByTestId("paper-su-generation-5")).toBeTruthy();
    expect(screen.getByTestId("paper-su-generation-mark-0").textContent).toContain("一世");
    expect(screen.queryByTestId("paper-svg-su")).toBeNull();

    expect(screen.getByTestId(`paper-row-${linear.rootId}`).style.gridTemplateRows).toBe(
      "64px 96px 1fr",
    );
    expect(screen.getByTestId("paper-su-generation-0").style.gridTemplateRows).toBe(
      "64px 96px 1fr",
    );
    expect(screen.getByTestId(`paper-su-relation-${linear.rootId}`).textContent).toContain("ancestor");
    expect(screen.getByTestId(`paper-su-name-${linear.rootId}`).textContent).toContain("贾源");
    expect(screen.getByTestId(`paper-row-${linear.rootId}`).textContent).not.toContain("1.1");
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
      spread.lanes.filter(
        (lane) => lane.kind === "person" && lane.depth === 1,
      ),
    );
    const secondSpreadFirstLane = firstChart.spreads[1].lanes.find((lane) => lane.kind !== "blank");

    expect(firstChart.spreads.length).toBeGreaterThan(1);
    expect(
      new Set(secondGenerationLanes.map((lane) => (lane.kind === "person" ? lane.person.id : ""))).size,
    ).toBe(30);
    expect(firstChart.spreads[0].rightLanes[0].kind).toBe("generation");
    expect(secondGenerationLanes.every((lane) => lane.kind === "person" && lane.text === getSuFullRecordText(lane.person))).toBe(
      true,
    );
    expect(secondSpreadFirstLane?.kind).toBe("generation");
    expect(secondSpreadFirstLane && "continued" in secondSpreadFirstLane ? secondSpreadFirstLane.continued : false).toBe(
      true,
    );

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
    expect(getSuPersonLaneKeys(book.charts[0].spreads, person.id).length).toBe(renderedEntries.length);

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

    const names = screen.getAllByTestId(`paper-su-name-${child.id}`).map((node) => node.textContent || "");
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
    expect(screen.getByTestId(`paper-node-${rootId}`)).toBeTruthy();
    expect(screen.getByTestId(`paper-node-${childId}`)).toBeTruthy();
  });

  it("renders an empty state when no root is available", () => {
    render(
      <PaperGenealogyView
        style="dieji"
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
