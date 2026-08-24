// @vitest-environment jsdom
import React, { type ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNodeId, type NodeData } from "../../../../../shared/model";
import { PaperGenealogyView as PaperGenealogyViewBase } from "../PaperGenealogyView";
import { buildPaperGenerations as buildPaperGenerationsBase } from "../paperData";
import { withValidatedPaperMetadata } from "../paperTestMetadata";
import { getSuFullRecordText, SU_BODY_LINE_HEIGHT } from "../layout/suPagination";

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

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function makeFamily() {
  const root = {
    id: makeNodeId(makeHash(1), 1),
    depth: 0,
    personHash: makeHash(1),
    versionIndex: 1,
  };
  const son = {
    id: makeNodeId(makeHash(2), 1),
    depth: 1,
    personHash: makeHash(2),
    versionIndex: 1,
  };
  const daughter = {
    id: makeNodeId(makeHash(3), 1),
    depth: 1,
    personHash: makeHash(3),
    versionIndex: 1,
  };
  return {
    root,
    son,
    daughter,
    graph: {
      nodes: [root, son, daughter],
      edges: [
        { from: root.id, to: son.id },
        { from: root.id, to: daughter.id },
      ],
      childrenByParent: {
        [root.id]: [son.id, daughter.id],
      },
    },
  };
}

function makeWideFamily(childCount: number) {
  const root = {
    id: makeNodeId(makeHash(101), 1),
    depth: 0,
    personHash: makeHash(101),
    versionIndex: 1,
  };
  const children = Array.from({ length: childCount }, (_value, index) => ({
    id: makeNodeId(makeHash(102 + index), 1),
    depth: 1,
    personHash: makeHash(102 + index),
    versionIndex: 1,
  }));
  return {
    root,
    children,
    graph: {
      nodes: [root, ...children],
      edges: children.map((child) => ({ from: root.id, to: child.id })),
      childrenByParent: {
        [root.id]: children.map((child) => child.id),
      },
    },
  };
}

function PaperGenealogyView(props: ComponentProps<typeof PaperGenealogyViewBase>) {
  return (
    <PaperGenealogyViewBase {...props} nodesData={withValidatedPaperMetadata(props.nodesData)} />
  );
}

function buildPaperGenerations(input: Parameters<typeof buildPaperGenerationsBase>[0]) {
  return buildPaperGenerationsBase({
    ...input,
    nodesData: withValidatedPaperMetadata(input.nodesData),
  });
}

describe("SuBookRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the Ou-style spread shell, spine, and generation rail", () => {
    const family = makeFamily();
    const nodesData: Record<string, NodeData> = {
      [family.root.id]: {
        id: family.root.id,
        personHash: family.root.personHash,
        versionIndex: 1,
        fullName: "贾源",
      },
    };

    render(
      <PaperGenealogyView
        style="su"
        graph={family.graph}
        rootId={family.root.id}
        nodesData={nodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId("paper-su")).toBeTruthy();
    const spread = screen.getByTestId("paper-su-spread-1-1");
    expect(spread.className).toContain("grid-cols-[1fr_72px_1fr]");
    expect(screen.getByTestId("paper-su-left-1-1")).toBeTruthy();
    expect(screen.getByTestId("paper-su-right-1-1")).toBeTruthy();
    const spine = screen.getByTestId("paper-su-spine-1-1");
    expect(spine.textContent).toContain("贾氏族谱");
    expect(spine.textContent).toContain("卷一");
    expect(screen.getByTestId("paper-su-spine-1-1-pages").textContent).toBe("二一");
    expect(screen.getByTestId("paper-su-generation-mark-0").textContent).toContain("一世");
    expect(screen.getByTestId("paper-su-generation-0").className).toContain("border-l");
  });

  it("renders vertical records, female marks, and dropline connectors without relation text", () => {
    const family = makeFamily();
    const nodesData: Record<string, NodeData> = {
      [family.root.id]: {
        id: family.root.id,
        personHash: family.root.personHash,
        versionIndex: 1,
        fullName: "曹操",
      },
      [family.son.id]: {
        id: family.son.id,
        personHash: family.son.personHash,
        versionIndex: 1,
        fullName: "曹丕",
        gender: 1,
        birthYear: 187,
      },
      [family.daughter.id]: {
        id: family.daughter.id,
        personHash: family.daughter.personHash,
        versionIndex: 1,
        fullName: "曹华",
        gender: 2,
        birthYear: 190,
      },
    };

    render(
      <PaperGenealogyView
        style="su"
        graph={family.graph}
        rootId={family.root.id}
        nodesData={nodesData}
        hasRoot
      />,
    );

    expect(screen.getByTestId(`paper-su-name-${family.son.id}`).style.writingMode).toBe(
      "vertical-rl",
    );
    expect(screen.queryByTestId(`paper-su-relation-${family.son.id}`)).toBeNull();
    expect(screen.getByTestId(`paper-su-female-${family.daughter.id}`).textContent).toContain("女");
    expect(screen.queryByTestId(`paper-su-female-${family.son.id}`)).toBeNull();
    expect(screen.getAllByTestId(`paper-su-connector-${family.root.id}`).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`paper-su-child-stem-${family.son.id}`)).toBeTruthy();
  });

  it("merges overlapping parent and horizontal segments on the same page", () => {
    const family = makeWideFamily(10);

    render(
      <PaperGenealogyView
        style="su"
        graph={family.graph}
        rootId={family.root.id}
        nodesData={{}}
        hasRoot
      />,
    );

    const rightPage = screen.getByTestId("paper-su-page-right-1-1");
    expect(
      rightPage.querySelectorAll(`[data-testid="paper-su-connector-${family.root.id}"]`),
    ).toHaveLength(1);
    const connector = rightPage.querySelector(
      `[data-testid="paper-su-connector-${family.root.id}"]`,
    );
    expect(connector?.getAttribute("stroke")).toBe("var(--df-paper-line-accent)");
    expect(connector?.getAttribute("stroke-width")).toBe("1.15");
  });

  it("keeps the fixed body column spacing while pagination fills the right page first", () => {
    const family = makeFamily();
    const story = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，婚丧贫乏者量力周济。"
    ).repeat(9);
    const nodesData: Record<string, NodeData> = {
      [family.root.id]: {
        id: family.root.id,
        personHash: family.root.personHash,
        versionIndex: 1,
        fullName: "曹操",
        metadataUnlockValidated: true,
        biography: story,
      },
    };

    render(
      <PaperGenealogyView
        style="su"
        graph={family.graph}
        rootId={family.root.id}
        nodesData={nodesData}
        hasRoot
      />,
    );

    const rightPage = screen.getByTestId("paper-su-right-1-1");
    const rootRecord = Array.from(
      rightPage.querySelectorAll<HTMLElement>("article[data-person-id]"),
    ).find((node) => node.getAttribute("data-person-id") === family.root.id);
    const detail = rootRecord?.querySelector<HTMLElement>(
      `[data-testid="paper-su-detail-${family.root.id}"]`,
    );

    expect(rootRecord).toBeTruthy();
    expect(detail?.style.lineHeight).toBe(String(SU_BODY_LINE_HEIGHT));
  });

  it("keeps a long biography complete while showing the name only once", () => {
    const family = makeFamily();
    const story = (
      "少承庭训，迁居江右，主持修桥置田，赈济族人，辑录旧谱，分辨昭穆。" +
      "又置义田三十亩，以供春秋祭祀，训诸子读书务本，婚丧贫乏者量力周济。"
    ).repeat(7);
    const nodesData: Record<string, NodeData> = {
      [family.root.id]: {
        id: family.root.id,
        personHash: family.root.personHash,
        versionIndex: 1,
        fullName: "曹操",
      },
      [family.son.id]: {
        id: family.son.id,
        personHash: family.son.personHash,
        versionIndex: 1,
        fullName: "曹长文",
        gender: 1,
        metadataUnlockValidated: true,
        biography: story,
      },
    };
    const generations = buildPaperGenerations({
      graph: family.graph,
      nodesData,
      t: (key, fallback, options) =>
        (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
          String(options?.[name] ?? ""),
        ),
    });
    const fullRecord = getSuFullRecordText(generations[1].people[0]);

    render(
      <PaperGenealogyView
        style="su"
        graph={family.graph}
        rootId={family.root.id}
        nodesData={nodesData}
        hasRoot
      />,
    );

    const details = screen
      .getAllByTestId(`paper-su-detail-${family.son.id}`)
      .map((node) => ({
        part: Number(node.parentElement?.getAttribute("data-part-index") || 0),
        text: node.textContent || "",
        continuesAfter: node.parentElement?.getAttribute("data-continues-after"),
        textAlignLast: node.style.textAlignLast,
      }))
      .sort((a, b) => a.part - b.part);

    expect(details.length).toBeGreaterThan(1);
    expect(details.map((entry) => entry.text).join("")).toBe(fullRecord);
    expect(details.slice(0, -1).every((entry) => entry.continuesAfter === "true")).toBe(true);
    expect(details.slice(0, -1).every((entry) => entry.textAlignLast === "justify")).toBe(true);
    expect(details[details.length - 1].continuesAfter).toBe("false");
    expect(details[details.length - 1].textAlignLast).toBe("auto");
    expect(screen.getAllByTestId(`paper-su-name-${family.son.id}`)).toHaveLength(1);
    expect(screen.queryByTestId(`paper-su-relation-${family.son.id}`)).toBeNull();
    expect(
      screen
        .getAllByTestId(`paper-su-detail-${family.son.id}`)
        .every((detail) => detail.parentElement?.getAttribute("title") === fullRecord),
    ).toBe(true);
  });
});
