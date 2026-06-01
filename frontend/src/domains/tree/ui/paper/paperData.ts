import type { NodeData, NodeId } from "../../../../shared/model";
import { birthDateString, deathDateString, sortNodeIdsByBirthOrder } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { getNodeUi, type NodeUi } from "../nodeUi";

export type PaperGenealogyStyle = "ou" | "su" | "pagoda" | "lineage" | "dieji" | "modern";

export const PAPER_GENEALOGY_STYLES: PaperGenealogyStyle[] = [
  "ou",
  "su",
  "pagoda",
  "lineage",
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

  // Rank within each gender separately (长子/次子… among sons, 长女/次女… among
  // daughters), eldest-first by birth date. Missing or duplicate birth dates fall
  // back to original order instead of dropping the whole group. This per-gender
  // numbering is a paper-genealogy convention, so it stays in the paper layer.
  for (const gender of [1, 2]) {
    const sameGender = childIds.filter((id) => nodesData[id]?.gender === gender);
    if (!sameGender.length) continue;

    const ranked = sortNodeIdsByBirthOrder(sameGender, nodesData);
    ranked.forEach((id, siblingIndex) => {
      relationByChild.set(id, {
        parentId,
        siblingIndex,
        siblingCount: ranked.length,
        rankSource: "birthDate",
      });
    });
  }
}

// Reinforcement pass: assign a stable family-grouped display position to every node via
// a depth-first walk from the root that visits each parent's children eldest-first.
// Sibling ordering is already applied at the data layer (getProjectedChildIds), so this
// is idempotent for projected graphs; it also guarantees birth order for any graph that
// did not flow through that layer (e.g. hand-built graphs in tests).
function computeDisplayOrder(params: {
  graph: TreeGraphData;
  nodesData: Record<string, NodeData>;
}): Map<NodeId, number> {
  const { graph, nodesData } = params;
  const order = new Map<NodeId, number>();
  const visited = new Set<NodeId>();
  let counter = 0;

  const root = graph.nodes.find((node) => node.depth === 0);
  if (root) {
    const stack: NodeId[] = [root.id];
    while (stack.length) {
      const id = stack.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      order.set(id, counter++);
      const children = sortNodeIdsByBirthOrder(graph.childrenByParent[id] || [], nodesData);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  }

  // Defensive: keep any node not reachable from the root (graph order preserved).
  graph.nodes.forEach((node) => {
    if (!order.has(node.id)) order.set(node.id, counter++);
  });
  return order;
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

  const displayOrder = computeDisplayOrder({ graph, nodesData });

  graph.nodes.forEach((node) => {
    const ui = getNodeUi(node.id, nodesData);
    const nodeData = nodesData[node.id];
    const childCount = graph.childrenByParent[node.id]?.length || 0;
    const people = byDepth.get(node.depth) || [];
    const childRelation = relationByChild.get(node.id);
    const person: PaperPerson = {
      id: node.id,
      depth: node.depth,
      sequence: 0, // assigned after the generation is sorted into birth order
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
    .map(([depth, people]) => {
      const ordered = [...people].sort(
        (a, b) => (displayOrder.get(a.id) ?? 0) - (displayOrder.get(b.id) ?? 0),
      );
      ordered.forEach((person, index) => {
        person.sequence = index + 1;
      });
      return {
        depth,
        label: t
          ? t("genealogyBook.generationLabel", "Generation {{number}}", { number: depth + 1 })
          : `Generation ${depth + 1}`,
        people: ordered,
      };
    });
}
