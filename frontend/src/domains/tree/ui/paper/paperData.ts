import type { NodeData, NodeId } from "../../../../shared/model";
import { birthDateString, deathDateString } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { getNodeUi, type NodeUi } from "../nodeUi";

export type PaperGenealogyStyle = "ou" | "su" | "pagoda" | "dieji" | "modern";

export const PAPER_GENEALOGY_STYLES: PaperGenealogyStyle[] = [
  "ou",
  "su",
  "pagoda",
  "dieji",
  "modern",
];

export function isPaperGenealogyStyle(value: string | null): value is PaperGenealogyStyle {
  return PAPER_GENEALOGY_STYLES.includes(value as PaperGenealogyStyle);
}

export type TranslateFn = (
  key: string,
  fallback?: string,
  options?: Record<string, unknown>,
) => string;

export type PaperPerson = {
  id: NodeId;
  depth: number;
  sequence: number;
  relation?:
    | { kind: "root" }
    | {
      kind: "child";
      parentId: NodeId;
      siblingIndex: number;
      siblingCount: number;
      rankSource: "birthDate";
    };
  ui: NodeUi;
  nodeData?: NodeData;
  detailLines: string[];
  classicalLines: string[];
  childCount: number;
};

export type PaperGeneration = {
  depth: number;
  label: string;
  people: PaperPerson[];
};

function tFallback(t: TranslateFn | undefined, key: string, fallback: string): string {
  return t ? t(key, fallback) : fallback;
}

function compactUnique(lines: Array<string | undefined | null | false>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function buildDetailLines(params: {
  ui: NodeUi;
  nodeData?: NodeData;
  childCount: number;
  t?: TranslateFn;
}): string[] {
  const { ui, nodeData, childCount, t } = params;
  const birth = ui.birthDateText || birthDateString(nodeData);
  const death = deathDateString(nodeData);
  const birthPlace = ui.birthPlace || nodeData?.birthPlace;
  const tag = ui.tagText || nodeData?.tag;

  return compactUnique([
    ui.versionTextWithTotal,
    tag ? `${tFallback(t, "genealogyBook.fields.tag", "Tag")}: ${tag}` : undefined,
    birth ? `${tFallback(t, "genealogyBook.fields.birth", "Birth")}: ${birth}` : undefined,
    death ? `${tFallback(t, "genealogyBook.fields.death", "Death")}: ${death}` : undefined,
    birthPlace
      ? `${tFallback(t, "genealogyBook.fields.birthPlace", "Birthplace")}: ${birthPlace}`
      : undefined,
    typeof ui.endorsementCount === "number"
      ? `${tFallback(t, "genealogyBook.fields.endorsements", "Endorsements")}: ${
          ui.endorsementCount
        }`
      : undefined,
    childCount > 0
      ? `${tFallback(t, "genealogyBook.fields.descendants", "Children")}: ${childCount}`
      : undefined,
  ]);
}

function buildClassicalLines(params: {
  ui: NodeUi;
  nodeData?: NodeData;
  t?: TranslateFn;
}): string[] {
  const { ui, nodeData, t } = params;
  const birth = ui.birthDateText || birthDateString(nodeData);
  const death = deathDateString(nodeData);
  const origin = ui.birthPlace || nodeData?.birthPlace;
  const deathPlace = nodeData?.deathPlace;
  const story = nodeData?.story;
  const tag = ui.tagText || nodeData?.tag;

  return compactUnique([
    birth ? `${tFallback(t, "genealogyBook.fields.birth", "Birth")}: ${birth}` : undefined,
    death ? `${tFallback(t, "genealogyBook.fields.death", "Death")}: ${death}` : undefined,
    origin ? `${tFallback(t, "genealogyBook.fields.origin", "Origin")}: ${origin}` : undefined,
    deathPlace
      ? `${tFallback(t, "genealogyBook.fields.deathPlace", "Death place")}: ${deathPlace}`
      : undefined,
    tag ? `${tFallback(t, "genealogyBook.fields.tag", "Tag")}: ${tag}` : undefined,
    story ? `${tFallback(t, "genealogyBook.fields.notes", "Notes")}: ${story}` : undefined,
  ]);
}

function getBirthOrderKey(nodeData: NodeData | undefined): [number, number, number] | null {
  if (!nodeData || typeof nodeData.birthYear !== "number" || nodeData.birthYear <= 0) return null;
  const year = nodeData.isBirthBC ? -nodeData.birthYear : nodeData.birthYear;
  const month =
    typeof nodeData.birthMonth === "number" && nodeData.birthMonth > 0 ? nodeData.birthMonth : 0;
  const day = typeof nodeData.birthDay === "number" && nodeData.birthDay > 0 ? nodeData.birthDay : 0;
  return [year, month, day];
}

function birthOrderKeyString(key: [number, number, number]): string {
  return key.join("-");
}

function compareBirthOrderKey(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function addBirthRankRelations(params: {
  parentId: NodeId;
  childIds: NodeId[];
  nodesData: Record<string, NodeData>;
  relationByChild: Map<
    NodeId,
    { parentId: NodeId; siblingIndex: number; siblingCount: number; rankSource: "birthDate" }
  >;
}) {
  const { parentId, childIds, nodesData, relationByChild } = params;

  for (const gender of [1, 2]) {
    const sameGender = childIds.filter((childId) => nodesData[childId]?.gender === gender);
    if (!sameGender.length) continue;

    const ranked = sameGender
      .map((childId) => {
        const birthKey = getBirthOrderKey(nodesData[childId]);
        return birthKey ? { childId, birthKey } : null;
      })
      .filter(Boolean) as Array<{ childId: NodeId; birthKey: [number, number, number] }>;

    if (ranked.length !== sameGender.length) continue;
    if (new Set(ranked.map((entry) => birthOrderKeyString(entry.birthKey))).size !== ranked.length) {
      continue;
    }

    ranked.sort((a, b) => compareBirthOrderKey(a.birthKey, b.birthKey));
    ranked.forEach((entry, index) => {
      relationByChild.set(entry.childId, {
        parentId,
        siblingIndex: index,
        siblingCount: ranked.length,
        rankSource: "birthDate",
      });
    });
  }
}

export function buildPaperGenerations(params: {
  graph: TreeGraphData;
  nodesData: Record<string, NodeData>;
  t?: TranslateFn;
}): PaperGeneration[] {
  const { graph, nodesData, t } = params;
  const byDepth = new Map<number, PaperPerson[]>();
  const relationByChild = new Map<
    NodeId,
    { parentId: NodeId; siblingIndex: number; siblingCount: number; rankSource: "birthDate" }
  >();

  for (const [parentId, childIds] of Object.entries(graph.childrenByParent)) {
    addBirthRankRelations({
      parentId,
      childIds,
      nodesData,
      relationByChild,
    });
  }

  graph.nodes.forEach((node) => {
    const ui = getNodeUi(node.id, nodesData);
    const nodeData = nodesData[node.id];
    const childCount = graph.childrenByParent[node.id]?.length || 0;
    const people = byDepth.get(node.depth) || [];
    const sequence = people.length + 1;
    const childRelation = relationByChild.get(node.id);
    const person: PaperPerson = {
      id: node.id,
      depth: node.depth,
      sequence,
      relation: childRelation
        ? { kind: "child", ...childRelation }
        : node.depth === 0
          ? { kind: "root" }
          : undefined,
      ui,
      nodeData,
      childCount,
      detailLines: buildDetailLines({ ui, nodeData, childCount, t }),
      classicalLines: buildClassicalLines({ ui, nodeData, t }),
    };
    people.push(person);
    byDepth.set(node.depth, people);
  });

  return Array.from(byDepth.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, people]) => ({
      depth,
      label: t
        ? t("genealogyBook.generationLabel", "Generation {{number}}", { number: depth + 1 })
        : `Generation ${depth + 1}`,
      people,
    }));
}
