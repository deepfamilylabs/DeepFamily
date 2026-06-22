import type { NodeData, NodeId } from "../../../../shared/model";
import { birthDateString, deathDateString, sortNodeIdsByBirthOrder } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import { getNodeUi, type NodeUi } from "../nodeUi";

export const PAPER_GENEALOGY_STYLE = {
  OU: "ou",
  SU: "su",
  DIEJI: "dieji",
  LINEAGE: "lineage",
  MODERN: "modern",
} as const;

export type PaperGenealogyStyle =
  (typeof PAPER_GENEALOGY_STYLE)[keyof typeof PAPER_GENEALOGY_STYLE];

export const PAPER_GENEALOGY_STYLES = [
  PAPER_GENEALOGY_STYLE.OU,
  PAPER_GENEALOGY_STYLE.SU,
  PAPER_GENEALOGY_STYLE.DIEJI,
  PAPER_GENEALOGY_STYLE.LINEAGE,
  PAPER_GENEALOGY_STYLE.MODERN,
] as const satisfies readonly PaperGenealogyStyle[];

export function isPaperGenealogyStyle(value: string | null): value is PaperGenealogyStyle {
  return typeof value === "string" && (PAPER_GENEALOGY_STYLES as readonly string[]).includes(value);
}

export type TranslateFn = (
  key: string,
  fallback?: string,
  options?: Record<string, unknown>,
) => string;

export type PaperChildRef = {
  id: NodeId;
  name: string;
  gender?: number;
};

export type PaperSpouseRef = {
  id: NodeId;
  name: string;
  gender?: number;
};

export type PaperPerson = {
  id: NodeId;
  depth: number;
  sequence: number;
  relation?:
    | { kind: "root" }
    | {
      kind: "child";
      parentId: NodeId;
      parentName?: string;
      siblingIndex: number;
      siblingCount: number;
      rankSource: "birthDate";
    };
  ui: NodeUi;
  nodeData?: NodeData;
  detailLines: string[];
  classicalLines: string[];
  childCount: number;
  children: PaperChildRef[];
  spouses: PaperSpouseRef[];
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

export function isPaperChildrenLine(
  line: string,
  t?: TranslateFn,
): boolean {
  const childrenLabel = tFallback(t, "genealogyBook.fields.children", "Children");
  return line.trim().toLocaleLowerCase().startsWith(`${childrenLabel}:`.toLocaleLowerCase());
}

export type PaperSpouseRenderMode = "classical" | "labeled";

// Spouse(s) formatted for the laid-out record. The "classical" form keys the marker on THIS
// person's gender — a man's spouse is 配 (wife), a woman's is 適 (married-out to husband), unknown
// gender falls back to the neutral 配偶; the "labeled" form is the modern "配偶: X" field used by
// the Modern style. Returns undefined when no spouse name is resolvable. Styles opt in via mode
// (Dieji "classical", Modern "labeled"); an absent mode injects nothing (Ou/Su/Lineage omit it).
function buildSpouseRecordLine(
  person: PaperPerson,
  t?: TranslateFn,
  mode?: PaperSpouseRenderMode,
): string | undefined {
  if (!mode) return undefined;
  const names = person.spouses.map((spouse) => spouse.name).filter(Boolean);
  if (!names.length) return undefined;

  if (mode === "labeled") {
    const label = tFallback(t, "genealogyBook.fields.spouse", "Spouse");
    const sep = /[㐀-鿿]/u.test(label) ? "、" : ", ";
    return `${label}: ${names.join(sep)}`;
  }

  const selfGender = person.nodeData?.gender ?? person.ui.gender;
  const marker =
    selfGender === 1
      ? tFallback(t, "genealogyBook.fields.spouseWife", "Wife")
      : selfGender === 2
        ? tFallback(t, "genealogyBook.fields.spouseHusband", "Husband")
        : tFallback(t, "genealogyBook.fields.spouse", "Spouse");
  const isCjkMarker = /[㐀-鿿]/u.test(marker);
  const nameSep = isCjkMarker ? "、" : ", ";
  // CJK markers (配/適) read as "配王氏" with no separator; latin markers need a space ("Wife 王氏").
  const markerSep = isCjkMarker ? "" : " ";
  return `${marker}${markerSep}${names.join(nameSep)}`;
}

export function splitPaperRecordLines(
  person: PaperPerson,
  t?: TranslateFn,
  spouseMode?: PaperSpouseRenderMode,
): { baseLines: string[]; childrenLine?: string } {
  const sourceLines = person.classicalLines.length ? person.classicalLines : person.detailLines;
  const baseLines = sourceLines.filter((line) => !isPaperChildrenLine(line, t));
  // Spouses live on person.spouses (kept out of the data-layer lines); only styles that opt in via
  // spouseMode surface them in the laid-out record between the biography and the children line.
  const spouseLine = buildSpouseRecordLine(person, t, spouseMode);
  return {
    baseLines: spouseLine ? [...baseLines, spouseLine] : baseLines,
    childrenLine: person.detailLines.find((line) => isPaperChildrenLine(line, t)),
  };
}

function buildDetailLines(params: {
  ui: NodeUi;
  nodeData?: NodeData;
  childNames: string[];
  t?: TranslateFn;
}): string[] {
  const { ui, nodeData, childNames, t } = params;
  const birth = ui.birthDateText || birthDateString(nodeData);
  const death = deathDateString(nodeData);
  const birthPlace = ui.birthPlace || nodeData?.birthPlace;
  const tag = ui.tagText || nodeData?.tag;
  const childrenLabel = tFallback(t, "genealogyBook.fields.children", "Children");
  const childSeparator = /[\u3400-\u9fff]/u.test(childrenLabel) ? "、" : ", ";

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
    childNames.length ? `${childrenLabel}: ${childNames.join(childSeparator)}` : undefined,
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
    {
      parentId: NodeId;
      parentName?: string;
      siblingIndex: number;
      siblingCount: number;
      rankSource: "birthDate";
    }
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
    const parentName = nodesData[parentId]?.fullName;
    ranked.forEach((id, siblingIndex) => {
      relationByChild.set(id, {
        parentId,
        parentName,
        siblingIndex,
        siblingCount: ranked.length,
        rankSource: "birthDate",
      });
    });
  }
}

function getChildRefs(params: {
  parentId: NodeId;
  graph: TreeGraphData;
  nodesData: Record<string, NodeData>;
}): PaperChildRef[] {
  const { parentId, graph, nodesData } = params;
  const childIds = sortNodeIdsByBirthOrder(graph.childrenByParent[parentId] || [], nodesData);
  return childIds.map((id) => {
    const ui = getNodeUi(id, nodesData);
    return {
      id,
      name: ui.fullName || ui.titleText || ui.shortHashText,
      gender: nodesData[id]?.gender ?? ui.gender,
    };
  });
}

// Co-parents (spouses) for this person, resolved from the data layer's spouseLinks (personId →
// co-parent node ids). Names/genders come from nodesData — the spouse's details are fetched by the
// runtime spouse enrichment, so married-in people resolve to real names (short-hash until then).
function getSpouseRefs(params: {
  personId: NodeId;
  spouseLinks: Map<NodeId, NodeId[]>;
  nodesData: Record<string, NodeData>;
}): PaperSpouseRef[] {
  const { personId, spouseLinks, nodesData } = params;
  return (spouseLinks.get(personId) || []).map((id) => {
    const ui = getNodeUi(id, nodesData);
    return {
      id,
      name: ui.fullName || ui.titleText || ui.shortHashText,
      gender: nodesData[id]?.gender ?? ui.gender,
    };
  });
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
  spouseLinks?: Map<NodeId, NodeId[]>;
  t?: TranslateFn;
}): PaperGeneration[] {
  const { graph, nodesData, spouseLinks, t } = params;
  const byDepth = new Map<number, PaperPerson[]>();
  const relationByChild = new Map<
    NodeId,
    {
      parentId: NodeId;
      parentName?: string;
      siblingIndex: number;
      siblingCount: number;
      rankSource: "birthDate";
    }
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
    const children = getChildRefs({ parentId: node.id, graph, nodesData });
    const childCount = children.length;
    const childNames = children.map((child) => child.name);
    const spouses = spouseLinks
      ? getSpouseRefs({ personId: node.id, spouseLinks, nodesData })
      : [];
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
      children,
      spouses,
      detailLines: buildDetailLines({ ui, nodeData, childNames, t }),
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
