import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import { toChineseNumeral } from "../paperText";
import {
  OU_CHART_STEP,
  OU_GENERATIONS_PER_CHART,
  OU_LEFT_PAGE_BODY_WIDTH,
  OU_RIGHT_PAGE_BODY_WIDTH,
  type OuPageBodyWidths,
  type OuPageSide,
} from "./ouPagination";
import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";

export type LineagePageSide = OuPageSide;

export type LineageEntry = {
  key: string;
  person: PaperPerson;
  spreadIndex: number;
  slotIndex: number;
  side: LineagePageSide;
  depth: number;
  rowIndex: number;
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  centerX: number;
  nameY: number;
  circleY: number;
  stemBottomY: number;
};

export type LineageConnector = {
  key: string;
  kind: "local" | "outgoing" | "incoming";
  side: LineagePageSide;
  parentId: NodeId;
  childIds: NodeId[];
  parentCenterX?: number;
  parentBottomY?: number;
  horizontalY: number;
  horizontalStartX: number;
  horizontalEndX: number;
  childCircleY: number;
};

export type LineageGenerationRow = {
  depth: number;
  label: string;
  repeated: boolean;
  entries: LineageEntry[];
};

export type LineagePageSpread = {
  index: number;
  kind: "main" | "continuation";
  rows: LineageGenerationRow[];
  connectors: LineageConnector[];
};

export type LineageChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  spreads: LineagePageSpread[];
};

export type LineagePaperBook = {
  charts: LineageChartWindow[];
};

export type LineagePageMetrics = {
  rightBodyWidth: number;
  leftBodyWidth: number;
  generationMarkWidth: number;
  headerHeight: number;
  bodyHeight: number;
  rowHeight: number;
};

type RawLineageEntry = {
  key: string;
  person: PaperPerson;
  spreadIndex: number;
  slotIndex: number;
  side: LineagePageSide;
  x: number;
  widthPx: number;
};

export const LINEAGE_GENERATIONS_PER_CHART = OU_GENERATIONS_PER_CHART;
export const LINEAGE_CHART_STEP = OU_CHART_STEP;
export const LINEAGE_PAGE_HEADER_HEIGHT = 32;
export const LINEAGE_PAGE_BODY_HEIGHT = 840;
export const LINEAGE_ROW_HEIGHT = LINEAGE_PAGE_BODY_HEIGHT / LINEAGE_GENERATIONS_PER_CHART;
export const LINEAGE_GENERATION_MARK_WIDTH = 54;
export const LINEAGE_PERSON_SLOT_WIDTH = 56;
export const LINEAGE_NODE_NAME_Y = 68;
export const LINEAGE_NODE_CIRCLE_GAP = 10;
export const LINEAGE_NODE_STEM_BOTTOM_Y = 124;
export const LINEAGE_BRANCH_LEAF_CAPACITY = Math.max(
  1,
  Math.floor(OU_RIGHT_PAGE_BODY_WIDTH / LINEAGE_PERSON_SLOT_WIDTH),
);

const DEFAULT_PAGE_BODY_WIDTHS: OuPageBodyWidths = {
  right: OU_RIGHT_PAGE_BODY_WIDTH,
  left: OU_LEFT_PAGE_BODY_WIDTH,
};

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

export function getLineageGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.ouGenerationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

export function getLineagePageMetrics(
  pageBodyWidths: OuPageBodyWidths = DEFAULT_PAGE_BODY_WIDTHS,
): LineagePageMetrics {
  return {
    rightBodyWidth: pageBodyWidths.right,
    leftBodyWidth: pageBodyWidths.left,
    generationMarkWidth: LINEAGE_GENERATION_MARK_WIDTH,
    headerHeight: LINEAGE_PAGE_HEADER_HEIGHT,
    bodyHeight: LINEAGE_PAGE_BODY_HEIGHT,
    rowHeight: LINEAGE_ROW_HEIGHT,
  };
}

export function getLineagePageWidth(
  side: LineagePageSide,
  metrics: LineagePageMetrics,
): number {
  return side === "right"
    ? metrics.rightBodyWidth + metrics.generationMarkWidth
    : metrics.leftBodyWidth;
}

export function splitLineageRowEntries(
  row: LineageGenerationRow,
  side: LineagePageSide,
): LineageEntry[] {
  return row.entries.filter((entry) => entry.side === side);
}

function getSideBodyWidth(side: LineagePageSide, metrics: LineagePageMetrics): number {
  return side === "right" ? metrics.rightBodyWidth : metrics.leftBodyWidth;
}

function getSideSlotCapacity(side: LineagePageSide, metrics: LineagePageMetrics): number {
  return Math.max(1, Math.floor(getSideBodyWidth(side, metrics) / LINEAGE_PERSON_SLOT_WIDTH));
}

function getSpreadSlotCapacity(metrics: LineagePageMetrics): number {
  return getSideSlotCapacity("right", metrics) + getSideSlotCapacity("left", metrics);
}

function buildRawEntryFromSlot(
  person: PaperPerson,
  slotIndex: number,
  metrics: LineagePageMetrics,
): RawLineageEntry {
  const rightCapacity = getSideSlotCapacity("right", metrics);
  const spreadCapacity = getSpreadSlotCapacity(metrics);
  const spreadIndex = Math.floor(slotIndex / spreadCapacity);
  const localSlotIndex = slotIndex % spreadCapacity;
  const side = localSlotIndex < rightCapacity ? "right" : "left";
  const sideSlotIndex = side === "right" ? localSlotIndex : localSlotIndex - rightCapacity;
  const widthPx = LINEAGE_PERSON_SLOT_WIDTH;
  const x = Math.max(0, getSideBodyWidth(side, metrics) - (sideSlotIndex + 1) * widthPx);

  return {
    key: `${person.id}:${spreadIndex}:${side}`,
    person,
    spreadIndex,
    slotIndex,
    side,
    x,
    widthPx,
  };
}

function buildEntry(params: {
  raw: RawLineageEntry;
  depth: number;
  rowIndex: number;
  metrics: LineagePageMetrics;
}): LineageEntry {
  const { raw, depth, rowIndex, metrics } = params;
  const y = rowIndex * metrics.rowHeight;
  return {
    key: raw.key,
    person: raw.person,
    spreadIndex: raw.spreadIndex,
    slotIndex: raw.slotIndex,
    side: raw.side,
    depth,
    rowIndex,
    x: raw.x,
    y,
    widthPx: raw.widthPx,
    heightPx: metrics.rowHeight,
    centerX: raw.x + raw.widthPx / 2,
    nameY: y + LINEAGE_NODE_NAME_Y,
    circleY: y + LINEAGE_NODE_NAME_Y - LINEAGE_NODE_CIRCLE_GAP,
    stemBottomY: y + LINEAGE_NODE_STEM_BOTTOM_Y,
  };
}

function buildEntryIndex(rows: LineageGenerationRow[]): Map<NodeId, LineageEntry[]> {
  const out = new Map<NodeId, LineageEntry[]>();
  for (const row of rows) {
    for (const entry of row.entries) {
      const existing = out.get(entry.person.id) || [];
      existing.push(entry);
      out.set(entry.person.id, existing);
    }
  }
  return out;
}

function getSpineBoundaryX(side: LineagePageSide, metrics: LineagePageMetrics): number {
  return side === "right" ? 0 : metrics.leftBodyWidth;
}

function getSpreadExitBoundaryX(): number {
  return 0;
}

function getSpreadEntryBoundaryX(side: LineagePageSide, metrics: LineagePageMetrics): number {
  return side === "right" ? metrics.rightBodyWidth : metrics.leftBodyWidth;
}

function getConnectorHorizontalY(parent: LineageEntry, children: LineageEntry[]): number {
  const childCircleY = Math.min(...children.map((child) => child.circleY));
  return parent.stemBottomY + (childCircleY - parent.stemBottomY) / 2;
}

function getConnectorChildCircleY(children: LineageEntry[]): number {
  return Math.min(...children.map((child) => child.circleY));
}

function buildLocalConnector(params: {
  parent: LineageEntry;
  children: LineageEntry[];
}): LineageConnector {
  const { parent, children } = params;
  const childCenters = children.map((child) => child.centerX);
  const childCircleY = getConnectorChildCircleY(children);
  const horizontalX = [parent.centerX, ...childCenters];
  return {
    key: `local:${parent.side}:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "local",
    side: parent.side,
    parentId: parent.person.id,
    childIds: children.map((child) => child.person.id),
    parentCenterX: parent.centerX,
    parentBottomY: parent.stemBottomY,
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(...horizontalX),
    horizontalEndX: Math.max(...horizontalX),
    childCircleY,
  };
}

function buildOutgoingConnector(params: {
  parent: LineageEntry;
  children: LineageEntry[];
  metrics: LineagePageMetrics;
  boundaryX?: number;
}): LineageConnector {
  const { parent, children, metrics } = params;
  const boundaryX = params.boundaryX ?? getSpineBoundaryX(parent.side, metrics);
  return {
    key: `outgoing:${parent.side}:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "outgoing",
    side: parent.side,
    parentId: parent.person.id,
    childIds: children.map((child) => child.person.id),
    parentCenterX: parent.centerX,
    parentBottomY: parent.stemBottomY,
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(parent.centerX, boundaryX),
    horizontalEndX: Math.max(parent.centerX, boundaryX),
    childCircleY: getConnectorChildCircleY(children),
  };
}

function buildIncomingConnector(params: {
  parent: LineageEntry;
  children: LineageEntry[];
  side: LineagePageSide;
  metrics: LineagePageMetrics;
  boundaryX?: number;
}): LineageConnector {
  const { parent, children, side, metrics } = params;
  const boundaryX = params.boundaryX ?? getSpineBoundaryX(side, metrics);
  const childCenters = children.map((child) => child.centerX);
  const childCircleY = getConnectorChildCircleY(children);
  return {
    key: `incoming:${side}:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "incoming",
    side,
    parentId: parent.person.id,
    childIds: children.map((child) => child.person.id),
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(boundaryX, ...childCenters),
    horizontalEndX: Math.max(boundaryX, ...childCenters),
    childCircleY,
  };
}

function groupEntriesBySide(entries: LineageEntry[]): Map<LineagePageSide, LineageEntry[]> {
  const out = new Map<LineagePageSide, LineageEntry[]>();
  for (const entry of entries) {
    const sideEntries = out.get(entry.side) || [];
    sideEntries.push(entry);
    out.set(entry.side, sideEntries);
  }
  return out;
}

function groupEntriesBySpread(entries: LineageEntry[]): Map<number, LineageEntry[]> {
  const out = new Map<number, LineageEntry[]>();
  for (const entry of entries) {
    const spreadEntries = out.get(entry.spreadIndex) || [];
    spreadEntries.push(entry);
    out.set(entry.spreadIndex, spreadEntries);
  }
  return out;
}

function appendSameSpreadConnectors(params: {
  parent: LineageEntry;
  children: LineageEntry[];
  metrics: LineagePageMetrics;
  connectors: LineageConnector[];
}) {
  const { parent, children, metrics, connectors } = params;
  const childrenBySide = groupEntriesBySide(children);
  const sameSideChildren = childrenBySide.get(parent.side) || [];
  if (sameSideChildren.length) {
    connectors.push(buildLocalConnector({ parent, children: sameSideChildren }));
  }

  for (const [childSide, sideChildren] of childrenBySide) {
    if (childSide === parent.side) continue;
    connectors.push(buildOutgoingConnector({ parent, children: sideChildren, metrics }));
    connectors.push(
      buildIncomingConnector({ parent, children: sideChildren, side: childSide, metrics }),
    );
  }
}

function appendNextSpreadConnectors(params: {
  parent: LineageEntry;
  children: LineageEntry[];
  metrics: LineagePageMetrics;
  connectorsBySpread: LineageConnector[][];
}) {
  const { parent, children, metrics, connectorsBySpread } = params;
  connectorsBySpread[parent.spreadIndex]?.push(
    buildOutgoingConnector({
      parent,
      children,
      metrics,
      boundaryX: getSpreadExitBoundaryX(),
    }),
  );

  for (const [childSide, sideChildren] of groupEntriesBySide(children)) {
    connectorsBySpread[sideChildren[0].spreadIndex]?.push(
      buildIncomingConnector({
        parent,
        children: sideChildren,
        side: childSide,
        metrics,
        boundaryX: getSpreadEntryBoundaryX(childSide, metrics),
      }),
    );
  }
}

function buildConnectors(params: {
  graph: TreeGraphData;
  spreads: LineagePageSpread[];
  metrics: LineagePageMetrics;
}): LineageConnector[][] {
  const { graph, spreads, metrics } = params;
  const rows = spreads.flatMap((spread) => spread.rows);
  const entries = rows.flatMap((row) => row.entries);
  const entryById = buildEntryIndex(rows);
  const connectorsBySpread = spreads.map(() => [] as LineageConnector[]);

  for (const parent of entries) {
    const children = (graph.childrenByParent[parent.person.id] || [])
      .map((childId) => entryById.get(childId)?.[0])
      .filter(Boolean) as LineageEntry[];
    if (!children.length) continue;

    for (const [spreadIndex, spreadChildren] of groupEntriesBySpread(children)) {
      if (spreadIndex === parent.spreadIndex) {
        appendSameSpreadConnectors({
          parent,
          children: spreadChildren,
          metrics,
          connectors: connectorsBySpread[parent.spreadIndex],
        });
      } else {
        appendNextSpreadConnectors({
          parent,
          children: spreadChildren,
          metrics,
          connectorsBySpread,
        });
      }
    }
  }

  return connectorsBySpread;
}

function addRawEntry(
  entriesByDepth: Map<number, RawLineageEntry[][]>,
  entry: RawLineageEntry,
) {
  const depthEntries = entriesByDepth.get(entry.person.depth) || [];
  const spreadEntries = depthEntries[entry.spreadIndex] || [];
  spreadEntries.push(entry);
  depthEntries[entry.spreadIndex] = spreadEntries;
  entriesByDepth.set(entry.person.depth, depthEntries);
}

function sortRawEntries(entriesByDepth: Map<number, RawLineageEntry[][]>) {
  for (const spreadEntriesByDepth of entriesByDepth.values()) {
    for (const entries of spreadEntriesByDepth) {
      entries?.sort((a, b) => a.slotIndex - b.slotIndex);
    }
  }
}

function buildChartLineageEntries(params: {
  graph: TreeGraphData;
  generationDepths: number[];
  generationsByDepth: Map<number, PaperGeneration>;
  metrics: LineagePageMetrics;
}): { entriesByDepth: Map<number, RawLineageEntry[][]>; spreadCount: number } {
  const { graph, generationDepths, generationsByDepth, metrics } = params;
  const startDepth = generationDepths[0];
  const endDepth = generationDepths[generationDepths.length - 1];
  const peopleByDepth = new Map(
    generationDepths.map((depth) => [depth, generationsByDepth.get(depth)?.people || []]),
  );
  const orderByDepth = new Map(
    Array.from(peopleByDepth.entries()).map(([depth, people]) => [
      depth,
      new Map(people.map((person, index) => [person.id, index])),
    ]),
  );
  const personById = new Map(
    Array.from(peopleByDepth.values())
      .flat()
      .map((person) => [person.id, person]),
  );
  const childrenMemo = new Map<NodeId, PaperPerson[]>();
  const widthMemo = new Map<NodeId, number>();
  const entriesByDepth = new Map<number, RawLineageEntry[][]>();
  const placed = new Set<NodeId>();
  let maxSlotIndex = 0;

  const getVisibleChildren = (person: PaperPerson): PaperPerson[] => {
    const memo = childrenMemo.get(person.id);
    if (memo) return memo;
    const order = orderByDepth.get(person.depth + 1) || new Map<NodeId, number>();
    const children = (graph.childrenByParent[person.id] || [])
      .map((childId) => personById.get(childId))
      .filter(
        (child): child is PaperPerson =>
          child !== undefined && child.depth === person.depth + 1 && child.depth <= endDepth,
      )
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    childrenMemo.set(person.id, children);
    return children;
  };

  const getSubtreeWidth = (person: PaperPerson): number => {
    const memo = widthMemo.get(person.id);
    if (memo) return memo;
    const children = getVisibleChildren(person);
    const width = children.length
      ? children.reduce((sum, child) => sum + getSubtreeWidth(child), 0)
      : 1;
    widthMemo.set(person.id, width);
    return width;
  };

  const placeSubtree = (person: PaperPerson, slotIndex: number) => {
    if (placed.has(person.id)) return;
    placed.add(person.id);
    maxSlotIndex = Math.max(maxSlotIndex, slotIndex);
    addRawEntry(entriesByDepth, buildRawEntryFromSlot(person, slotIndex, metrics));

    let childSlotIndex = slotIndex;
    for (const child of getVisibleChildren(person)) {
      placeSubtree(child, childSlotIndex);
      childSlotIndex += getSubtreeWidth(child);
    }
  };

  let cursor = 0;
  for (const person of peopleByDepth.get(startDepth) || []) {
    placeSubtree(person, cursor);
    cursor += getSubtreeWidth(person);
  }

  for (const depth of generationDepths) {
    for (const person of peopleByDepth.get(depth) || []) {
      if (placed.has(person.id)) continue;
      const fallbackSlotIndex = Math.max(cursor, maxSlotIndex + 1);
      placeSubtree(person, fallbackSlotIndex);
      cursor = fallbackSlotIndex + getSubtreeWidth(person);
    }
  }

  sortRawEntries(entriesByDepth);
  return {
    entriesByDepth,
    spreadCount: Math.max(1, Math.floor(maxSlotIndex / getSpreadSlotCapacity(metrics)) + 1),
  };
}

export function buildLineagePaperBook(params: {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  t?: TranslateFn;
  pageBodyWidths?: OuPageBodyWidths;
}): LineagePaperBook {
  const { graph, generations } = params;
  const t = params.t || fallbackTranslate;
  const metrics = getLineagePageMetrics(params.pageBodyWidths);
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: LineageChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += LINEAGE_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: LINEAGE_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
    const { entriesByDepth, spreadCount } = buildChartLineageEntries({
      graph,
      generationDepths,
      generationsByDepth,
      metrics,
    });

    const spreads: LineagePageSpread[] = Array.from({ length: spreadCount }, (_value, spreadOffset) => {
      const rows = generationDepths.map((depth, rowIndex) => {
        const generation = generationsByDepth.get(depth);
        return {
          depth,
          label: getGenerationLabel(generation, depth, t),
          repeated: repeatedDepth === depth,
          entries:
            entriesByDepth
              .get(depth)?.[spreadOffset]
              ?.map((raw) => buildEntry({ raw, depth, rowIndex, metrics })) || [],
        };
      });
      return {
        index: spreadOffset + 1,
        kind: spreadOffset === 0 ? "main" : "continuation",
        rows,
        connectors: [],
      };
    });
    const connectorsBySpread = buildConnectors({ graph, spreads, metrics });

    charts.push({
      index: chartIndex,
      generationDepths,
      repeatedDepth,
      spreads: spreads.map((spread, index) => ({
        ...spread,
        connectors: connectorsBySpread[index],
      })),
    });
  }

  return { charts };
}
