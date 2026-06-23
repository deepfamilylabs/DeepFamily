import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";
import { PAPER_RECORD_INLINE_PADDING } from "../paperStyles";
import {
  clipText,
  getPaperGenerationMark,
  splitTextByVisualUnits,
} from "../paperText";
import {
  OU_CHART_STEP,
  OU_GENERATIONS_PER_CHART,
  OU_LEFT_PAGE_BODY_WIDTH,
  OU_RIGHT_PAGE_BODY_WIDTH,
  type OuPageBodyWidths,
  type OuPageSide,
} from "./ouPagination";

export type SuPageSide = OuPageSide;

export type SuPersonEntry = {
  key: string;
  person: PaperPerson;
  text: string;
  spreadIndex: number;
  side: SuPageSide;
  slotIndex: number;
  partIndex: number;
  totalPartCount: number;
  continued: boolean;
  depth: number;
  rowIndex: number;
  x: number;
  y: number;
  widthPx: number;
  // Per-entry slot advance. It is adjusted slightly per page side so the original slot count is
  // preserved while the content edge keeps the same inset from the spine as Ou records.
  slotWidth: number;
  heightPx: number;
  centerX: number;
  topY: number;
  bottomY: number;
  branchY: number;
};

export type SuConnector = {
  key: string;
  kind: "local" | "outgoing" | "incoming" | "bridge";
  side: SuPageSide;
  parentId: NodeId;
  childIds: NodeId[];
  parentCenterX?: number;
  parentBottomY?: number;
  horizontalY: number;
  horizontalStartX: number;
  horizontalEndX: number;
  childTopY: number;
};

export type SuGenerationRow = {
  depth: number;
  label: string;
  repeated: boolean;
  entries: SuPersonEntry[];
};

export type SuPageSpread = {
  index: number;
  kind: "main" | "continuation";
  rows: SuGenerationRow[];
  connectors: SuConnector[];
};

export type SuChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  spreads: SuPageSpread[];
};

export type SuPaperBook = {
  charts: SuChartWindow[];
};

export type SuPageMetrics = {
  rightBodyWidth: number;
  leftBodyWidth: number;
  generationMarkWidth: number;
  bodyHeight: number;
  rowHeight: number;
  slotWidth: number;
};

type SuPersonPlacement = {
  person: PaperPerson;
  startSlot: number;
  chunks: string[];
};

export const SU_GENERATIONS_PER_CHART = OU_GENERATIONS_PER_CHART;
export const SU_CHART_STEP = OU_CHART_STEP;
export const SU_PAGE_HEIGHT = 872;
export const SU_GENERATION_MARK_WIDTH = 54;
export const SU_PERSON_SLOT_WIDTH = 72;
export const SU_SPINE_CONTENT_GAP = PAPER_RECORD_INLINE_PADDING;
export const SU_NAME_LANE_WIDTH = 32;
export const SU_NAME_MAX_LENGTH = 10;
export const SU_RECORD_TOP_PADDING = 25;
export const SU_RECORD_BOTTOM_PADDING = 12;

// Vertical body geometry. Body text is 13px (PAPER_TEXT.body.fontSize) set in `writing-mode:
// vertical-rl`, where line-height is the column-to-column advance — the single knob for how tight
// the columns sit. A record renders as one merged block per page side (see mergeSuSideRecords), so
// every inter-column gap is exactly this line-height; the derived column width (ceil of fontSize ×
// line-height) keeps the merged block's width math in sync with what the browser actually wraps,
// and the chunk budgets (slot capacity in columns) drive tree placement. When the column width
// divides the 72px slot evenly the merged block fills its allotment exactly; otherwise the small
// remainder lands between records, never mid-biography.
export const SU_BODY_FONT_SIZE = 13;
export const SU_BODY_LINE_HEIGHT = 1.55;
export const SU_BODY_COLUMN_WIDTH = Math.ceil(SU_BODY_FONT_SIZE * SU_BODY_LINE_HEIGHT);
export const SU_BODY_PADDING_X = 8; // px-1 on the merged body <p> (its two ends, not per column)
const SU_RECORD_HEIGHT =
  SU_PAGE_HEIGHT / SU_GENERATIONS_PER_CHART - SU_RECORD_TOP_PADDING - SU_RECORD_BOTTOM_PADDING;
// Half-em units one full-height column holds (full-width glyph = 2 units; see measureRecordUnits).
export const SU_COLUMN_UNIT_CAPACITY = Math.floor(SU_RECORD_HEIGHT / SU_BODY_FONT_SIZE) * 2;
// Columns that fit a slot, sizing the chunk budgets that drive tree placement. The name lane
// shares the first slot; continuation slots use the whole slot. No per-column padding is subtracted
// here: the merged block pads only its two ends, so each slot tiles cleanly at SU_BODY_COLUMN_WIDTH.
export const SU_ENTRY_TOP_Y = 22;
export const SU_NAME_TOP_Y = 25;
export const SU_NAME_GLYPH_ADVANCE = 20;
export const SU_NAME_STEM_GAP = 8;
export const SU_ENTRY_BOTTOM_GAP = 12;

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

function formatSuRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

function getSuVisibleName(person: PaperPerson): string {
  return clipText(
    person.ui.fullName || person.ui.titleText || person.ui.shortHashText,
    SU_NAME_MAX_LENGTH,
  );
}

function getSuParentStemStartY(
  person: PaperPerson,
  rowY: number,
  rowHeight: number,
): number {
  const femaleMarkLength = person.ui.gender === 2 ? 2 : 0;
  const nameLength = Array.from(getSuVisibleName(person)).length + femaleMarkLength;
  return Math.min(
    rowY + rowHeight - SU_ENTRY_BOTTOM_GAP,
    rowY + SU_NAME_TOP_Y + nameLength * SU_NAME_GLYPH_ADVANCE + SU_NAME_STEM_GAP,
  );
}

export function getSuGenerationMark(depth: number, t: TranslateFn): string {
  return getPaperGenerationMark(depth, t);
}

export function getSuFullRecordText(person: PaperPerson): string {
  return (
    person.classicalLines.map(formatSuRecordLine).join("，") ||
    person.ui.shortHashText
  );
}

export function getSuPageMetrics(
  pageBodyWidths: OuPageBodyWidths = DEFAULT_PAGE_BODY_WIDTHS,
): SuPageMetrics {
  return {
    rightBodyWidth: pageBodyWidths.right,
    leftBodyWidth: pageBodyWidths.left,
    generationMarkWidth: SU_GENERATION_MARK_WIDTH,
    bodyHeight: SU_PAGE_HEIGHT,
    rowHeight: SU_PAGE_HEIGHT / SU_GENERATIONS_PER_CHART,
    slotWidth: SU_PERSON_SLOT_WIDTH,
  };
}

export function getSuPageWidth(side: SuPageSide, metrics: SuPageMetrics): number {
  return side === "right"
    ? metrics.rightBodyWidth + metrics.generationMarkWidth
    : metrics.leftBodyWidth;
}

export function splitSuRowEntries(
  row: SuGenerationRow,
  side: SuPageSide,
): SuPersonEntry[] {
  return row.entries.filter((entry) => entry.side === side);
}

function getSideBodyWidth(side: SuPageSide, metrics: SuPageMetrics): number {
  return side === "right" ? metrics.rightBodyWidth : metrics.leftBodyWidth;
}

function getSideSlotCapacity(side: SuPageSide, metrics: SuPageMetrics): number {
  return Math.max(1, Math.floor(getSideBodyWidth(side, metrics) / metrics.slotWidth));
}

function getSideSlotWidth(side: SuPageSide, metrics: SuPageMetrics): number {
  const capacity = getSideSlotCapacity(side, metrics);
  return Math.max(
    1,
    (getSideBodyWidth(side, metrics) - SU_SPINE_CONTENT_GAP) / capacity,
  );
}

function getSpreadSlotCapacity(metrics: SuPageMetrics): number {
  return getSideSlotCapacity("right", metrics) + getSideSlotCapacity("left", metrics);
}

function getSlotPosition(
  slotIndex: number,
  metrics: SuPageMetrics,
): {
  spreadIndex: number;
  side: SuPageSide;
  sideSlotIndex: number;
  x: number;
  slotWidth: number;
} {
  const rightCapacity = getSideSlotCapacity("right", metrics);
  const spreadCapacity = getSpreadSlotCapacity(metrics);
  const spreadIndex = Math.floor(slotIndex / spreadCapacity);
  const localSlotIndex = slotIndex % spreadCapacity;
  const side = localSlotIndex < rightCapacity ? "right" : "left";
  const sideSlotIndex = side === "right" ? localSlotIndex : localSlotIndex - rightCapacity;
  const bodyWidth = getSideBodyWidth(side, metrics);
  const slotWidth = getSideSlotWidth(side, metrics);
  const contentStartX = side === "right" ? SU_SPINE_CONTENT_GAP : 0;
  const contentEndX =
    side === "right" ? bodyWidth : bodyWidth - SU_SPINE_CONTENT_GAP;
  const x = Math.max(
    contentStartX,
    contentEndX - (sideSlotIndex + 1) * slotWidth,
  );

  return { spreadIndex, side, sideSlotIndex, x, slotWidth };
}

export function splitSuRecordText(
  person: PaperPerson,
  startSlot = 0,
  metrics: SuPageMetrics = getSuPageMetrics(),
): string[] {
  let remaining = getSuFullRecordText(person);
  const chunks: string[] = [];
  let slotIndex = startSlot;
  let groupKey = "";
  let groupSlotCount = 0;
  let groupHasNameLane = false;
  let previousColumnCount = 0;

  while (remaining) {
    const position = getSlotPosition(slotIndex, metrics);
    const nextGroupKey = `${position.spreadIndex}:${position.side}`;
    if (nextGroupKey !== groupKey) {
      groupKey = nextGroupKey;
      groupSlotCount = 0;
      groupHasNameLane = slotIndex === startSlot;
      previousColumnCount = 0;
    }

    groupSlotCount += 1;
    const nameLane = groupHasNameLane ? SU_NAME_LANE_WIDTH : 0;
    const availableBodyWidth = Math.max(
      SU_BODY_COLUMN_WIDTH,
      groupSlotCount * position.slotWidth - nameLane - SU_BODY_PADDING_X,
    );
    const columnCount = Math.max(
      1,
      Math.floor(availableBodyWidth / SU_BODY_COLUMN_WIDTH),
    );
    const addedColumns = Math.max(1, columnCount - previousColumnCount);
    const budget = addedColumns * SU_COLUMN_UNIT_CAPACITY;
    const [chunk, ...rest] = splitTextByVisualUnits(remaining, budget);

    chunks.push(chunk);
    remaining = rest.join("");
    previousColumnCount = columnCount;
    slotIndex += 1;
  }

  return chunks;
}

function buildPersonMap(generations: PaperGeneration[]): Map<NodeId, PaperPerson> {
  return new Map(
    generations.flatMap((generation) =>
      generation.people.map((person) => [person.id, person] as const),
    ),
  );
}

function buildChartPlacements(params: {
  graph: TreeGraphData;
  generationDepths: number[];
  generationsByDepth: Map<number, PaperGeneration>;
  metrics: SuPageMetrics;
}): { placements: SuPersonPlacement[]; spreadSlotCount: number } {
  const { graph, generationDepths, generationsByDepth, metrics } = params;
  const startDepth = generationDepths[0];
  const endDepth = generationDepths[generationDepths.length - 1];
  const peopleByDepth = new Map(
    generationDepths.map((depth) => [depth, generationsByDepth.get(depth)?.people || []]),
  );
  const personById = new Map(
    Array.from(peopleByDepth.values())
      .flat()
      .map((person) => [person.id, person]),
  );
  const orderByDepth = new Map(
    Array.from(peopleByDepth.entries()).map(([depth, people]) => [
      depth,
      new Map(people.map((person, index) => [person.id, index])),
    ]),
  );
  const childrenMemo = new Map<NodeId, PaperPerson[]>();
  const chunksMemo = new Map<NodeId, Map<number, string[]>>();
  const widthMemo = new Map<NodeId, Map<number, number>>();
  const placements: SuPersonPlacement[] = [];
  const placed = new Set<NodeId>();
  let maxSlot = -1;

  const getChunks = (person: PaperPerson, startSlot: number): string[] => {
    const personMemo = chunksMemo.get(person.id) || new Map<number, string[]>();
    const memo = personMemo.get(startSlot);
    if (memo) return memo;
    const chunks = splitSuRecordText(person, startSlot, metrics);
    personMemo.set(startSlot, chunks);
    chunksMemo.set(person.id, personMemo);
    return chunks;
  };

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

  const getSubtreeWidth = (person: PaperPerson, startSlot: number): number => {
    const personMemo = widthMemo.get(person.id) || new Map<number, number>();
    const memo = personMemo.get(startSlot);
    if (memo !== undefined) return memo;
    const children = getVisibleChildren(person);
    let childSlot = startSlot;
    for (const child of children) {
      childSlot += getSubtreeWidth(child, childSlot);
    }
    const childrenWidth = childSlot - startSlot;
    const width = Math.max(getChunks(person, startSlot).length, childrenWidth, 1);
    personMemo.set(startSlot, width);
    widthMemo.set(person.id, personMemo);
    return width;
  };

  const placeSubtree = (person: PaperPerson, startSlot: number) => {
    if (placed.has(person.id)) return;
    placed.add(person.id);
    const chunks = getChunks(person, startSlot);
    placements.push({ person, startSlot, chunks });
    maxSlot = Math.max(maxSlot, startSlot + chunks.length - 1);

    let childSlot = startSlot;
    for (const child of getVisibleChildren(person)) {
      placeSubtree(child, childSlot);
      childSlot += getSubtreeWidth(child, childSlot);
      maxSlot = Math.max(maxSlot, childSlot - 1);
    }
  };

  let cursor = 0;
  for (const person of peopleByDepth.get(startDepth) || []) {
    placeSubtree(person, cursor);
    cursor += getSubtreeWidth(person, cursor);
  }

  for (const depth of generationDepths) {
    for (const person of peopleByDepth.get(depth) || []) {
      if (placed.has(person.id)) continue;
      const fallbackSlot = Math.max(cursor, maxSlot + 1);
      placeSubtree(person, fallbackSlot);
      cursor = fallbackSlot + getSubtreeWidth(person, fallbackSlot);
    }
  }

  return {
    placements,
    spreadSlotCount: Math.max(1, maxSlot + 1),
  };
}

function buildEntry(params: {
  placement: SuPersonPlacement;
  partIndex: number;
  rowIndex: number;
  metrics: SuPageMetrics;
}): SuPersonEntry {
  const { placement, partIndex, rowIndex, metrics } = params;
  const slotIndex = placement.startSlot + partIndex;
  const position = getSlotPosition(slotIndex, metrics);
  const y = rowIndex * metrics.rowHeight;
  const continued = partIndex > 0;
  return {
    key: `${placement.person.id}:${partIndex}:${position.spreadIndex}:${position.side}`,
    person: placement.person,
    text: placement.chunks[partIndex],
    spreadIndex: position.spreadIndex,
    side: position.side,
    slotIndex,
    partIndex: partIndex + 1,
    totalPartCount: placement.chunks.length,
    continued,
    depth: placement.person.depth,
    rowIndex,
    x: position.x,
    y,
    widthPx: position.slotWidth,
    slotWidth: position.slotWidth,
    heightPx: metrics.rowHeight,
    centerX: position.x + position.slotWidth - SU_NAME_LANE_WIDTH / 2,
    topY: y + SU_ENTRY_TOP_Y,
    bottomY: getSuParentStemStartY(placement.person, y, metrics.rowHeight),
    branchY: y + metrics.rowHeight - SU_ENTRY_BOTTOM_GAP,
  };
}

function getPrimaryEntries(rows: SuGenerationRow[]): Map<NodeId, SuPersonEntry> {
  const out = new Map<NodeId, SuPersonEntry>();
  for (const row of rows) {
    for (const entry of row.entries) {
      if (!entry.continued && !out.has(entry.person.id)) out.set(entry.person.id, entry);
    }
  }
  return out;
}

function getSpineBoundaryX(side: SuPageSide, metrics: SuPageMetrics): number {
  return side === "right" ? 0 : metrics.leftBodyWidth;
}

function getSpreadEntryBoundaryX(side: SuPageSide, metrics: SuPageMetrics): number {
  return side === "right" ? metrics.rightBodyWidth : metrics.leftBodyWidth;
}

function getConnectorHorizontalY(parent: SuPersonEntry, children: SuPersonEntry[]): number {
  const childTopY = Math.min(...children.map((child) => child.topY));
  return parent.branchY + (childTopY - parent.branchY) / 2;
}

function buildLocalConnector(
  parent: SuPersonEntry,
  children: SuPersonEntry[],
): SuConnector {
  const childCenters = children.map((child) => child.centerX);
  return {
    key: `local:${parent.side}:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "local",
    side: parent.side,
    parentId: parent.person.id,
    childIds: children.map((child) => child.person.id),
    parentCenterX: parent.centerX,
    parentBottomY: parent.bottomY,
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(parent.centerX, ...childCenters),
    horizontalEndX: Math.max(parent.centerX, ...childCenters),
    childTopY: Math.min(...children.map((child) => child.topY)),
  };
}

function buildOutgoingConnector(params: {
  parent: SuPersonEntry;
  children: SuPersonEntry[];
  metrics: SuPageMetrics;
  boundaryX?: number;
}): SuConnector {
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
    parentBottomY: parent.bottomY,
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(parent.centerX, boundaryX),
    horizontalEndX: Math.max(parent.centerX, boundaryX),
    childTopY: Math.min(...children.map((child) => child.topY)),
  };
}

function buildIncomingConnector(params: {
  parent: SuPersonEntry;
  children: SuPersonEntry[];
  side: SuPageSide;
  metrics: SuPageMetrics;
  boundaryX?: number;
  includeSpineBoundary?: boolean;
}): SuConnector {
  const { parent, children, side, metrics } = params;
  const boundaryX = params.boundaryX ?? getSpineBoundaryX(side, metrics);
  const boundaries = params.includeSpineBoundary
    ? [boundaryX, getSpineBoundaryX(side, metrics)]
    : [boundaryX];
  const childCenters = children.map((child) => child.centerX);
  return {
    key: `incoming:${side}:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "incoming",
    side,
    parentId: parent.person.id,
    childIds: children.map((child) => child.person.id),
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: Math.min(...boundaries, ...childCenters),
    horizontalEndX: Math.max(...boundaries, ...childCenters),
    childTopY: Math.min(...children.map((child) => child.topY)),
  };
}

function buildSpreadBridgeConnector(params: {
  parent: SuPersonEntry;
  children: SuPersonEntry[];
  metrics: SuPageMetrics;
}): SuConnector {
  const { parent, children, metrics } = params;
  return {
    key: `bridge:right:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "bridge",
    side: "right",
    parentId: parent.person.id,
    childIds: [],
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: getSpineBoundaryX("right", metrics),
    horizontalEndX: getSpreadEntryBoundaryX("right", metrics),
    childTopY: Math.min(...children.map((child) => child.topY)),
  };
}

function buildSpreadExitBridgeConnector(params: {
  parent: SuPersonEntry;
  children: SuPersonEntry[];
  metrics: SuPageMetrics;
}): SuConnector {
  const { parent, children, metrics } = params;
  return {
    key: `bridge:left-exit:${parent.person.id}:${children
      .map((child) => child.person.id)
      .join(":")}`,
    kind: "bridge",
    side: "left",
    parentId: parent.person.id,
    childIds: [],
    horizontalY: getConnectorHorizontalY(parent, children),
    horizontalStartX: 0,
    horizontalEndX: getSpineBoundaryX("left", metrics),
    childTopY: Math.min(...children.map((child) => child.topY)),
  };
}

function groupBySide(entries: SuPersonEntry[]): Map<SuPageSide, SuPersonEntry[]> {
  const out = new Map<SuPageSide, SuPersonEntry[]>();
  for (const entry of entries) {
    const group = out.get(entry.side) || [];
    group.push(entry);
    out.set(entry.side, group);
  }
  return out;
}

function groupBySpread(entries: SuPersonEntry[]): Map<number, SuPersonEntry[]> {
  const out = new Map<number, SuPersonEntry[]>();
  for (const entry of entries) {
    const group = out.get(entry.spreadIndex) || [];
    group.push(entry);
    out.set(entry.spreadIndex, group);
  }
  return out;
}

function buildConnectors(params: {
  graph: TreeGraphData;
  spreads: SuPageSpread[];
  metrics: SuPageMetrics;
}): SuConnector[][] {
  const { graph, spreads, metrics } = params;
  const rows = spreads.flatMap((spread) => spread.rows);
  const primaryById = getPrimaryEntries(rows);
  const connectorsBySpread = spreads.map(() => [] as SuConnector[]);

  for (const parent of primaryById.values()) {
    const children = (graph.childrenByParent[parent.person.id] || [])
      .map((childId) => primaryById.get(childId))
      .filter(Boolean) as SuPersonEntry[];
    if (!children.length) continue;
    const continuesAfterParentSpread = children.some(
      (child) => child.spreadIndex > parent.spreadIndex,
    );

    for (const [spreadIndex, spreadChildren] of groupBySpread(children)) {
      if (spreadIndex === parent.spreadIndex) {
        const childrenBySide = groupBySide(spreadChildren);
        const sameSideChildren = childrenBySide.get(parent.side) || [];
        if (sameSideChildren.length) {
          connectorsBySpread[parent.spreadIndex].push(
            buildLocalConnector(parent, sameSideChildren),
          );
        }
        for (const [childSide, sideChildren] of childrenBySide) {
          if (childSide === parent.side) continue;
          connectorsBySpread[parent.spreadIndex].push(
            buildOutgoingConnector({ parent, children: sideChildren, metrics }),
            buildIncomingConnector({
              parent,
              children: sideChildren,
              side: childSide,
              metrics,
              boundaryX:
                parent.side === "right" &&
                childSide === "left" &&
                continuesAfterParentSpread
                  ? 0
                  : undefined,
              includeSpineBoundary:
                parent.side === "right" &&
                childSide === "left" &&
                continuesAfterParentSpread,
            }),
          );
        }
        continue;
      }

      // Reference Su-style continuation pages do not repeat the parent row label.
      // They carry the relationship only through page-edge horizontal connectors.
      connectorsBySpread[parent.spreadIndex].push(
        buildOutgoingConnector({
          parent,
          children: spreadChildren,
          metrics,
          boundaryX: 0,
        }),
      );
      if (parent.side === "right") {
        connectorsBySpread[parent.spreadIndex].push(
          buildSpreadExitBridgeConnector({
            parent,
            children: spreadChildren,
            metrics,
          }),
        );
      }
      for (const [childSide, sideChildren] of groupBySide(spreadChildren)) {
        const continuesAfterChildSpread = children.some(
          (child) => child.spreadIndex > spreadIndex,
        );
        if (childSide === "left") {
          connectorsBySpread[spreadIndex].push(
            buildSpreadBridgeConnector({
              parent,
              children: sideChildren,
              metrics,
            }),
          );
        }
        connectorsBySpread[spreadIndex].push(
          buildIncomingConnector({
            parent,
            children: sideChildren,
            side: childSide,
            metrics,
            boundaryX:
              childSide === "left" && continuesAfterChildSpread
                ? 0
                : getSpreadEntryBoundaryX(childSide, metrics),
            includeSpineBoundary: childSide === "left",
          }),
        );
      }
    }
  }

  return connectorsBySpread;
}

export function buildSuPaperBook(params: {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  t?: TranslateFn;
  pageBodyWidths?: OuPageBodyWidths;
}): SuPaperBook {
  const { graph, generations } = params;
  const t = params.t || fallbackTranslate;
  const metrics = getSuPageMetrics(params.pageBodyWidths);
  if (!generations.length) return { charts: [] };

  const personById = buildPersonMap(generations);
  if (!personById.size) return { charts: [] };

  const generationsByDepth = new Map(
    generations.map((generation) => [generation.depth, generation]),
  );
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: SuChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += SU_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: SU_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
    const { placements, spreadSlotCount } = buildChartPlacements({
      graph,
      generationDepths,
      generationsByDepth,
      metrics,
    });
    const spreadCount = Math.max(
      1,
      Math.ceil(spreadSlotCount / getSpreadSlotCapacity(metrics)),
    );
    const spreads: SuPageSpread[] = Array.from(
      { length: spreadCount },
      (_value, spreadIndex) => {
        const rows = generationDepths.map((depth, rowIndex) => {
          const generation = generationsByDepth.get(depth);
          const entries = placements
            .filter((placement) => placement.person.depth === depth)
            .flatMap((placement) =>
              placement.chunks.map((_chunk, partIndex) =>
                buildEntry({ placement, partIndex, rowIndex, metrics }),
              ),
            )
            .filter((entry) => entry.spreadIndex === spreadIndex)
            .sort((a, b) => a.slotIndex - b.slotIndex);
          return {
            depth,
            label: getGenerationLabel(generation, depth, t),
            repeated: repeatedDepth === depth,
            entries,
          };
        });
        return {
          index: spreadIndex + 1,
          kind: spreadIndex === 0 ? "main" : "continuation",
          rows,
          connectors: [],
        };
      },
    );
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
