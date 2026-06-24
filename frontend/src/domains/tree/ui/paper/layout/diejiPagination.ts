import type { NodeId } from "../../../../../shared/model";
import {
  splitPaperRecordLines,
  type PaperGeneration,
  type PaperPerson,
  type TranslateFn,
} from "../paperData";
import { getPaperGenerationMark, getPaperRelationLabel, splitTextByVisualUnits } from "../paperText";

export type DiejiPageSide = "left" | "right";

export type DiejiTableLane =
  | {
      kind: "generation";
      key: string;
      depth: number;
      label: string;
      repeated: boolean;
      continued: boolean;
    }
  | {
      kind: "person";
      key: string;
      depth: number;
      label: string;
      person: PaperPerson;
      relationLabel: string;
      name: string;
      text: string;
      continued: boolean;
      partIndex: number;
    }
  | {
      kind: "blank";
      key: string;
    };

export type DiejiPageSpread = {
  index: number;
  kind: "main" | "continuation";
  lanes: DiejiTableLane[];
  rightLanes: DiejiTableLane[];
  leftLanes: DiejiTableLane[];
};

export type DiejiChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  spreads: DiejiPageSpread[];
};

export type DiejiPaperBook = {
  charts: DiejiChartWindow[];
};

export const DIEJI_GENERATIONS_PER_CHART = 5;
export const DIEJI_CHART_STEP = DIEJI_GENERATIONS_PER_CHART - 1;
export const DIEJI_RIGHT_PAGE_LANE_CAPACITY = 14;
export const DIEJI_LEFT_PAGE_LANE_CAPACITY = 14;
export const DIEJI_SPREAD_LANE_CAPACITY = DIEJI_RIGHT_PAGE_LANE_CAPACITY + DIEJI_LEFT_PAGE_LANE_CAPACITY;
// Each lane's biography column is ~696px tall (page 872 − 64 relation − 96 name − 16 py-2 padding),
// holding ~53 full-width CJK glyphs ≈ 106 half-em units of vertical text at 13px. Budget just
// under that so a record fills the column before spilling into the next lane, and never wraps to
// a clipped second column. The integer-unit model slightly under-weights rotated half-width
// glyphs (dates/numbers run a touch taller than 0.5em), so the buffer keeps date-heavy lanes safe.
export const DIEJI_RECORD_UNITS_PER_LANE = 102;

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

function formatDiejiRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

function getRelationLabel(person: PaperPerson, t: TranslateFn): string {
  // Keep the father name and rank word as separate "\n"-joined segments so the renderer can lay
  // them out as two adjacent vertical columns (e.g. "曹昌晟" beside "长女") instead of one merged
  // column. If either column is too tall, the renderer falls back to one continuous wrapped phrase.
  return getPaperRelationLabel(person, t, {
    withParentName: true,
    separator: "\n",
    parentNameMax: Number.POSITIVE_INFINITY,
  });
}

export function getDiejiGenerationMark(depth: number, t: TranslateFn): string {
  return getPaperGenerationMark(depth, t);
}

export function getDiejiFullRecordText(person: PaperPerson, t?: TranslateFn): string {
  // This vertical register omits the 子女 (children) line; only Modern lists children in body text.
  const { baseLines } = splitPaperRecordLines(person, t, "classical");
  return baseLines.map(formatDiejiRecordLine).join("，") || person.ui.shortHashText;
}

function getDiejiRecordSections(person: PaperPerson, t: TranslateFn): string[] {
  // Only the base biography is laid out; the 子女 line is dropped (see getDiejiFullRecordText).
  const { baseLines } = splitPaperRecordLines(person, t, "classical");
  const baseRecord = baseLines.map(formatDiejiRecordLine).join("，") || person.ui.shortHashText;
  return [baseRecord];
}

export function splitDiejiSpreadColumns(
  spread: DiejiPageSpread,
  side: DiejiPageSide,
): DiejiTableLane[] {
  return side === "right" ? spread.rightLanes : spread.leftLanes;
}

function makeBlankLane(params: {
  spreadIndex: number;
  side: DiejiPageSide;
  index: number;
}): DiejiTableLane {
  const { spreadIndex, side, index } = params;
  return {
    kind: "blank",
    key: `blank:${spreadIndex}:${side}:${index}`,
  };
}

function fillDiejiSideLanes(params: {
  lanes: DiejiTableLane[];
  capacity: number;
  spreadIndex: number;
  side: DiejiPageSide;
}): DiejiTableLane[] {
  const { lanes, capacity, spreadIndex, side } = params;
  if (lanes.length >= capacity) return lanes;

  return [
    ...lanes,
    ...Array.from({ length: capacity - lanes.length }, (_value, offset) =>
      makeBlankLane({
        spreadIndex,
        side,
        index: lanes.length + offset,
      }),
    ),
  ];
}

function makeGenerationLane(params: {
  depth: number;
  label: string;
  repeated: boolean;
  continued?: boolean;
}): DiejiTableLane {
  const { depth, label, repeated, continued = false } = params;
  return {
    kind: "generation",
    key: `generation:${depth}:${continued ? "continued" : "main"}`,
    depth,
    label,
    repeated,
    continued,
  };
}

function makePersonLanes(person: PaperPerson, label: string, t: TranslateFn): DiejiTableLane[] {
  const sections = getDiejiRecordSections(person, t);
  const baseName = person.ui.fullName || person.ui.titleText || person.ui.shortHashText;
  const relationLabel = getRelationLabel(person, t);
  let laneIndex = 0;

  return sections.flatMap((section, sectionIndex) => {
    const chunks = splitTextByVisualUnits(section, DIEJI_RECORD_UNITS_PER_LANE);
    return chunks.map((text, chunkIndex) => {
      const isFirstPersonLane = laneIndex === 0;
      const lane = {
        kind: "person" as const,
        key: `person:${person.id}:${sectionIndex}:${chunkIndex}`,
        depth: person.depth,
        label,
        person,
        relationLabel: isFirstPersonLane ? relationLabel : "",
        name: isFirstPersonLane ? baseName : "",
        text,
        continued: laneIndex > 0,
        partIndex: laneIndex + 1,
      };
      laneIndex += 1;
      return lane;
    });
  });
}

function ensureLeadingGenerationLane(params: {
  lanes: DiejiTableLane[];
  generationsByDepth: Map<number, PaperGeneration>;
  repeatedDepth?: number;
  t: TranslateFn;
}): DiejiTableLane[] {
  const { lanes, generationsByDepth, repeatedDepth, t } = params;
  const first = lanes.find((lane) => lane.kind !== "blank");
  if (!first || first.kind === "generation") return lanes;

  const generation = generationsByDepth.get(first.depth);
  return [
    makeGenerationLane({
      depth: first.depth,
      label: getGenerationLabel(generation, first.depth, t),
      repeated: repeatedDepth === first.depth,
      continued: true,
    }),
    ...lanes,
  ];
}

function splitChartLanesIntoSpreads(params: {
  lanes: DiejiTableLane[];
  generationsByDepth: Map<number, PaperGeneration>;
  repeatedDepth?: number;
  t: TranslateFn;
}): DiejiPageSpread[] {
  const { lanes, generationsByDepth, repeatedDepth, t } = params;
  const spreads: DiejiPageSpread[] = [];
  let start = 0;

  while (start < lanes.length || spreads.length === 0) {
    const spreadIndex = spreads.length + 1;
    const firstLane = lanes[start];
    const needsLeadingMark = spreadIndex > 1 && firstLane?.kind !== "generation";
    const capacity = needsLeadingMark ? DIEJI_SPREAD_LANE_CAPACITY - 1 : DIEJI_SPREAD_LANE_CAPACITY;
    const raw = lanes.slice(start, start + capacity);
    const withLeadingMark =
      !needsLeadingMark
        ? raw
        : ensureLeadingGenerationLane({ lanes: raw, generationsByDepth, repeatedDepth, t });

    spreads.push({
      index: spreadIndex,
      kind: spreadIndex === 1 ? "main" : "continuation",
      lanes: withLeadingMark,
      rightLanes: fillDiejiSideLanes({
        lanes: withLeadingMark.slice(0, DIEJI_RIGHT_PAGE_LANE_CAPACITY),
        capacity: DIEJI_RIGHT_PAGE_LANE_CAPACITY,
        spreadIndex,
        side: "right",
      }),
      leftLanes: fillDiejiSideLanes({
        lanes: withLeadingMark.slice(DIEJI_RIGHT_PAGE_LANE_CAPACITY, DIEJI_SPREAD_LANE_CAPACITY),
        capacity: DIEJI_LEFT_PAGE_LANE_CAPACITY,
        spreadIndex,
        side: "left",
      }),
    });
    start += capacity || DIEJI_SPREAD_LANE_CAPACITY;
  }

  return spreads;
}

export function buildDiejiPaperBook(params: {
  generations: PaperGeneration[];
  t?: TranslateFn;
}): DiejiPaperBook {
  const { generations } = params;
  const t = params.t || fallbackTranslate;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: DiejiChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += DIEJI_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: DIEJI_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
    const lanes: DiejiTableLane[] = [];

    generationDepths.forEach((depth) => {
      const generation = generationsByDepth.get(depth);
      const label = getGenerationLabel(generation, depth, t);
      lanes.push(
        makeGenerationLane({
          depth,
          label,
          repeated: repeatedDepth === depth,
        }),
      );
      for (const person of generation?.people || []) {
        lanes.push(...makePersonLanes(person, label, t));
      }
    });

    charts.push({
      index: chartIndex,
      generationDepths,
      repeatedDepth,
      spreads: splitChartLanesIntoSpreads({
        lanes,
        generationsByDepth,
        repeatedDepth,
        t,
      }),
    });
  }

  return { charts };
}

export function getDiejiPersonLaneKeys(spreads: DiejiPageSpread[], personId: NodeId): string[] {
  return spreads
    .flatMap((spread) => spread.lanes)
    .filter((lane): lane is Extract<DiejiTableLane, { kind: "person" }> =>
      lane.kind === "person" && lane.person.id === personId,
    )
    .map((lane) => lane.key);
}
