import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";
import { PAPER_TEXT } from "../paperStyles";
import { clipText, getPaperGenerationMark, toChineseNumeral } from "../paperText";

export type PagodaNode = PaperPerson & {
  x: number;
  y: number;
  w: number;
  h: number;
  relativeDepth: number;
  repeated: boolean;
  branchRoot: boolean;
};

export type PagodaConnector = {
  parentId: NodeId;
  childIds: NodeId[];
  parentCenterX: number;
  parentBottomY: number;
  horizontalY: number;
  horizontalStartX: number;
  horizontalEndX: number;
  childTopY: number;
};

export type PagodaDepthGuide = {
  depth: number;
  label: string;
  y: number;
  repeated: boolean;
};

export type PagodaBranchPage = {
  index: number;
  chartIndex: number;
  branchIndex: number;
  kind: "main" | "branch";
  rootId: NodeId;
  generationDepths: number[];
  repeatedDepth?: number;
  title: string;
  nodes: PagodaNode[];
  connectors: PagodaConnector[];
  guides: PagodaDepthGuide[];
  width: number;
  height: number;
};

export type PagodaChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  pages: PagodaBranchPage[];
};

export type PagodaPaperBook = {
  charts: PagodaChartWindow[];
};

export const PAGODA_GENERATIONS_PER_CHART = 5;
export const PAGODA_CHART_STEP = PAGODA_GENERATIONS_PER_CHART - 1;
export const PAGODA_NODE_WIDTH = 48;
export const PAGODA_NODE_HEIGHT = 132;
export const PAGODA_NODE_NAME_Y = 28;
// Keep the layout's reserved name height in sync with the shared name token so customizing the
// token's font size also re-measures the pagoda node height (see node-height math below).
export const PAGODA_NODE_NAME_FONT_SIZE = PAPER_TEXT.name.fontSize;
export const PAGODA_NODE_NAME_MAX_LENGTH = 10;
export const PAGODA_NODE_NAME_CONNECTOR_GAP = 12;
export const PAGODA_MIN_CONNECTOR_ANCHOR_Y = 80;
export const PAGODA_GAP_X = 24;
export const PAGODA_GAP_Y = 158;
export const PAGODA_PAGE_WIDTH = 1180;
export const PAGODA_PAGE_HEIGHT = 872;
export const PAGODA_INNER_LEFT = 72;
export const PAGODA_INNER_RIGHT = 120;
export const PAGODA_INNER_TOP = 52;
export const PAGODA_INNER_BOTTOM = 64;

const PAGODA_BODY_WIDTH = PAGODA_PAGE_WIDTH - PAGODA_INNER_LEFT - PAGODA_INNER_RIGHT;
export const PAGODA_BRANCH_LEAF_CAPACITY = Math.max(
  1,
  Math.floor((PAGODA_BODY_WIDTH + PAGODA_GAP_X) / (PAGODA_NODE_WIDTH + PAGODA_GAP_X)),
);

function fallbackTranslate(
  key: string,
  fallback?: string,
  options?: Record<string, unknown>,
): string {
  return (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_match, name) =>
    String(options?.[name] ?? ""),
  );
}

function getGenerationLabel(
  generation: PaperGeneration | undefined,
  depth: number,
  t: TranslateFn,
): string {
  return (
    generation?.label ||
    t("genealogyBook.generationLabel", "Generation {{number}}", { number: depth + 1 })
  );
}

export function getPagodaGenerationMark(depth: number, t: TranslateFn): string {
  return getPaperGenerationMark(depth, t);
}

function getPagodaVisibleName(person: PaperPerson): string {
  return clipText(
    person.ui.fullName || person.ui.titleText || person.ui.shortHashText,
    PAGODA_NODE_NAME_MAX_LENGTH,
  );
}

function getPagodaConnectorAnchorY(person: PaperPerson): number {
  const nameLength = Array.from(getPagodaVisibleName(person)).length;
  return Math.min(
    PAGODA_NODE_HEIGHT,
    Math.max(
      PAGODA_MIN_CONNECTOR_ANCHOR_Y,
      PAGODA_NODE_NAME_Y + nameLength * PAGODA_NODE_NAME_FONT_SIZE + PAGODA_NODE_NAME_CONNECTOR_GAP,
    ),
  );
}

function buildPersonMap(generations: PaperGeneration[]): Map<NodeId, PaperPerson> {
  const out = new Map<NodeId, PaperPerson>();
  for (const generation of generations) {
    for (const person of generation.people) out.set(person.id, person);
  }
  return out;
}

function buildDepthMap(graph: TreeGraphData, personById: Map<NodeId, PaperPerson>): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  for (const node of graph.nodes) out.set(node.id, node.depth);
  for (const person of personById.values()) {
    if (!out.has(person.id)) out.set(person.id, person.depth);
  }
  return out;
}

function getNodeDepth(id: NodeId, depthById: Map<NodeId, number>, personById: Map<NodeId, PaperPerson>) {
  return depthById.get(id) ?? personById.get(id)?.depth ?? 0;
}

function getEligibleChildren(params: {
  graph: TreeGraphData;
  parentId: NodeId;
  endDepth: number;
  depthById: Map<NodeId, number>;
  personById: Map<NodeId, PaperPerson>;
}): NodeId[] {
  const { graph, parentId, endDepth, depthById, personById } = params;
  return (graph.childrenByParent[parentId] || []).filter((childId) => {
    const childDepth = getNodeDepth(childId, depthById, personById);
    return childDepth <= endDepth && personById.has(childId);
  });
}

function getSubtreeLeafCount(params: {
  graph: TreeGraphData;
  rootId: NodeId;
  endDepth: number;
  depthById: Map<NodeId, number>;
  personById: Map<NodeId, PaperPerson>;
  visited?: Set<NodeId>;
}): number {
  const { graph, rootId, endDepth, depthById, personById } = params;
  const visited = params.visited || new Set<NodeId>();
  if (visited.has(rootId)) return 0;
  visited.add(rootId);

  const children = getEligibleChildren({ graph, parentId: rootId, endDepth, depthById, personById });
  if (!children.length) return 1;
  return Math.max(
    1,
    children.reduce(
      (total, childId) =>
        total +
        getSubtreeLeafCount({
          graph,
          rootId: childId,
          endDepth,
          depthById,
          personById,
          visited,
        }),
      0,
    ),
  );
}

function splitRootChildrenIntoBranchPages(params: {
  graph: TreeGraphData;
  rootId: NodeId;
  endDepth: number;
  depthById: Map<NodeId, number>;
  personById: Map<NodeId, PaperPerson>;
}): NodeId[][] {
  const { graph, rootId, endDepth, depthById, personById } = params;
  const children = getEligibleChildren({ graph, parentId: rootId, endDepth, depthById, personById });
  if (!children.length) return [[]];

  const chunks: NodeId[][] = [];
  let current: NodeId[] = [];
  let usedLeaves = 0;

  for (const childId of children) {
    const leafCount = getSubtreeLeafCount({
      graph,
      rootId: childId,
      endDepth,
      depthById,
      personById,
    });
    if (current.length && usedLeaves + leafCount > PAGODA_BRANCH_LEAF_CAPACITY) {
      chunks.push(current);
      current = [];
      usedLeaves = 0;
    }
    current.push(childId);
    usedLeaves += leafCount;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function collectPageChildren(params: {
  graph: TreeGraphData;
  rootId: NodeId;
  rootChildIds: NodeId[];
  endDepth: number;
  depthById: Map<NodeId, number>;
  personById: Map<NodeId, PaperPerson>;
}): Map<NodeId, NodeId[]> {
  const { graph, rootId, rootChildIds, endDepth, depthById, personById } = params;
  const out = new Map<NodeId, NodeId[]>();
  const visited = new Set<NodeId>();

  function walk(id: NodeId) {
    if (visited.has(id)) return;
    visited.add(id);
    const sourceChildren =
      id === rootId
        ? rootChildIds
        : getEligibleChildren({ graph, parentId: id, endDepth, depthById, personById });
    const children = sourceChildren.filter((childId) => {
      const childDepth = getNodeDepth(childId, depthById, personById);
      return childDepth <= endDepth && personById.has(childId);
    });
    if (children.length) out.set(id, children);
    for (const childId of children) walk(childId);
  }

  walk(rootId);
  return out;
}

function getPagodaTitle(startDepth: number, endDepth: number, t: TranslateFn): string {
  return t("genealogyBook.pagodaChartTitle", "{{startHan}}世至{{endHan}}世系图", {
    start: startDepth + 1,
    end: endDepth + 1,
    startHan: toChineseNumeral(startDepth + 1),
    endHan: toChineseNumeral(endDepth + 1),
  });
}

function buildPagodaBranchPage(params: {
  graph: TreeGraphData;
  personById: Map<NodeId, PaperPerson>;
  depthById: Map<NodeId, number>;
  generationsByDepth: Map<number, PaperGeneration>;
  rootId: NodeId;
  rootChildIds: NodeId[];
  chartIndex: number;
  pageIndex: number;
  branchIndex: number;
  generationDepths: number[];
  repeatedDepth?: number;
  t: TranslateFn;
}): PagodaBranchPage {
  const {
    graph,
    personById,
    depthById,
    generationsByDepth,
    rootId,
    rootChildIds,
    chartIndex,
    pageIndex,
    branchIndex,
    generationDepths,
    repeatedDepth,
    t,
  } = params;
  const startDepth = generationDepths[0] || 0;
  const endDepth = generationDepths[generationDepths.length - 1] ?? startDepth;
  const childMap = collectPageChildren({
    graph,
    rootId,
    rootChildIds,
    endDepth,
    depthById,
    personById,
  });
  const nodes: PagodaNode[] = [];
  const visited = new Set<NodeId>();
  let nextLeafIndex = 0;

  function layout(id: NodeId): { centerX: number; y: number } | null {
    if (visited.has(id)) return null;
    const person = personById.get(id);
    if (!person) return null;
    visited.add(id);

    const children = [...(childMap.get(id) || [])].reverse();
    const childPositions: Array<{ id: NodeId; centerX: number; y: number }> = [];
    for (const childId of children) {
      const child = layout(childId);
      if (child) childPositions.push({ id: childId, ...child });
    }

    let centerX: number;
    if (!childPositions.length) {
      centerX = nextLeafIndex * (PAGODA_NODE_WIDTH + PAGODA_GAP_X) + PAGODA_NODE_WIDTH / 2;
      nextLeafIndex += 1;
    } else {
      centerX =
        (Math.min(...childPositions.map((child) => child.centerX)) +
          Math.max(...childPositions.map((child) => child.centerX))) /
        2;
    }

    const depth = getNodeDepth(id, depthById, personById);
    const relativeDepth = Math.max(0, depth - startDepth);
    const y = PAGODA_INNER_TOP + relativeDepth * PAGODA_GAP_Y;
    nodes.push({
      ...person,
      x: centerX - PAGODA_NODE_WIDTH / 2,
      y,
      w: PAGODA_NODE_WIDTH,
      h: PAGODA_NODE_HEIGHT,
      relativeDepth,
      repeated: repeatedDepth === depth,
      branchRoot: id === rootId,
    });
    return { centerX, y };
  }

  layout(rootId);

  if (!nodes.length) {
    return {
      index: pageIndex,
      chartIndex,
      branchIndex,
      kind: pageIndex === 1 ? "main" : "branch",
      rootId,
      generationDepths,
      repeatedDepth,
      title: getPagodaTitle(startDepth, endDepth, t),
      nodes: [],
      connectors: [],
      guides: [],
      width: PAGODA_PAGE_WIDTH,
      height: PAGODA_PAGE_HEIGHT,
    };
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const contentWidth = maxX - minX;
  const width = PAGODA_PAGE_WIDTH;
  const bodyWidth = width - PAGODA_INNER_LEFT - PAGODA_INNER_RIGHT;
  const offsetX = PAGODA_INNER_LEFT + Math.max(0, (bodyWidth - contentWidth) / 2) - minX;

  for (const node of nodes) node.x += offsetX;
  nodes.sort((a, b) => a.relativeDepth - b.relativeDepth || b.x - a.x);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectors: PagodaConnector[] = [];
  for (const [parentId, childIds] of childMap.entries()) {
    const parent = nodeById.get(parentId);
    if (!parent) continue;
    const childNodes = childIds.map((childId) => nodeById.get(childId)).filter(Boolean) as PagodaNode[];
    if (!childNodes.length) continue;

    const childCenters = childNodes.map((child) => child.x + child.w / 2);
    const childTopY = Math.min(...childNodes.map((child) => child.y));
    const parentBottomY = parent.y + getPagodaConnectorAnchorY(parent);
    connectors.push({
      parentId,
      childIds: childNodes.map((child) => child.id),
      parentCenterX: parent.x + parent.w / 2,
      parentBottomY,
      horizontalY: parentBottomY + (childTopY - parentBottomY) / 2,
      horizontalStartX: Math.min(...childCenters),
      horizontalEndX: Math.max(...childCenters),
      childTopY,
    });
  }

  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return {
    index: pageIndex,
    chartIndex,
    branchIndex,
    kind: pageIndex === 1 ? "main" : "branch",
    rootId,
    generationDepths,
    repeatedDepth,
    title: getPagodaTitle(startDepth, endDepth, t),
    nodes,
    connectors,
    guides: generationDepths.map((depth) => ({
      depth,
      label: getGenerationLabel(generationsByDepth.get(depth), depth, t),
      y: PAGODA_INNER_TOP + (depth - startDepth) * PAGODA_GAP_Y,
      repeated: repeatedDepth === depth,
    })),
    width,
    height: Math.max(PAGODA_PAGE_HEIGHT, maxY + PAGODA_INNER_BOTTOM),
  };
}

export function buildPagodaPaperBook(params: {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  t?: TranslateFn;
}): PagodaPaperBook {
  const { graph, rootId, generations } = params;
  const t = params.t || fallbackTranslate;
  if (!rootId || !generations.length) return { charts: [] };

  const personById = buildPersonMap(generations);
  const depthById = buildDepthMap(graph, personById);
  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: PagodaChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += PAGODA_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: PAGODA_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
    const startPeople =
      startDepth === 0 && personById.has(rootId)
        ? [personById.get(rootId) as PaperPerson]
        : generationsByDepth.get(startDepth)?.people || [];
    const pages: PagodaBranchPage[] = [];

    for (const startPerson of startPeople) {
      const chunks = splitRootChildrenIntoBranchPages({
        graph,
        rootId: startPerson.id,
        endDepth: startDepth + PAGODA_GENERATIONS_PER_CHART - 1,
        depthById,
        personById,
      });
      chunks.forEach((rootChildIds, chunkIndex) => {
        pages.push(
          buildPagodaBranchPage({
            graph,
            personById,
            depthById,
            generationsByDepth,
            rootId: startPerson.id,
            rootChildIds,
            chartIndex,
            pageIndex: pages.length + 1,
            branchIndex: chunkIndex + 1,
            generationDepths,
            repeatedDepth,
            t,
          }),
        );
      });
    }

    charts.push({
      index: chartIndex,
      generationDepths,
      repeatedDepth,
      pages,
    });
  }

  return { charts };
}
