import type { NodeId } from "../../../../../shared/model";
import {
  splitPaperRecordLines,
  type PaperGeneration,
  type PaperPerson,
  type TranslateFn,
} from "../paperData";
import { getPaperRelationLabel, splitTextByVisualUnits, toChineseNumeral } from "../paperText";

export type SuPageSide = "left" | "right";

export type SuTableLane =
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

export type SuPageSpread = {
  index: number;
  kind: "main" | "continuation";
  lanes: SuTableLane[];
  rightLanes: SuTableLane[];
  leftLanes: SuTableLane[];
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

export const SU_GENERATIONS_PER_CHART = 5;
export const SU_CHART_STEP = 4;
export const SU_RIGHT_PAGE_LANE_CAPACITY = 14;
export const SU_LEFT_PAGE_LANE_CAPACITY = 14;
export const SU_SPREAD_LANE_CAPACITY = SU_RIGHT_PAGE_LANE_CAPACITY + SU_LEFT_PAGE_LANE_CAPACITY;
// Each lane's biography column is ~696px tall (page 872 − 64 relation − 96 name − 16 py-2 padding),
// holding ~53 full-width CJK glyphs ≈ 106 half-em units of vertical text at 13px. Budget just
// under that so a record fills the column before spilling into the next lane, and never wraps to
// a clipped second column. The integer-unit model slightly under-weights rotated half-width
// glyphs (dates/numbers run a touch taller than 0.5em), so the buffer keeps date-heavy lanes safe.
export const SU_RECORD_UNITS_PER_LANE = 102;

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

function getRelationLabel(person: PaperPerson, t: TranslateFn): string {
  // Clip the father name to 3 chars so "[父名]之子/长子" stays within the 64px relation cell.
  return getPaperRelationLabel(person, t, { withParentName: true, parentNameMax: 3 });
}

export function getSuGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.suGenerationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

export function getSuFullRecordText(person: PaperPerson): string {
  const { baseLines, childrenLine } = splitPaperRecordLines(person);
  const lines = childrenLine ? [...baseLines, childrenLine] : baseLines;
  return lines.map(formatSuRecordLine).join("，") || person.ui.shortHashText;
}

function getSuRecordSections(person: PaperPerson, t: TranslateFn): string[] {
  const { baseLines, childrenLine } = splitPaperRecordLines(person, t);
  const baseRecord = baseLines.map(formatSuRecordLine).join("，") || person.ui.shortHashText;
  const childrenRecord = childrenLine ? formatSuRecordLine(childrenLine) : undefined;
  return [baseRecord, childrenRecord].filter((line): line is string => Boolean(line));
}

export function splitSuSpreadColumns(
  spread: SuPageSpread,
  side: SuPageSide,
): SuTableLane[] {
  return side === "right" ? spread.rightLanes : spread.leftLanes;
}

function makeBlankLane(params: {
  spreadIndex: number;
  side: SuPageSide;
  index: number;
}): SuTableLane {
  const { spreadIndex, side, index } = params;
  return {
    kind: "blank",
    key: `blank:${spreadIndex}:${side}:${index}`,
  };
}

function fillSuSideLanes(params: {
  lanes: SuTableLane[];
  capacity: number;
  spreadIndex: number;
  side: SuPageSide;
}): SuTableLane[] {
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
}): SuTableLane {
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

function makePersonLanes(person: PaperPerson, label: string, t: TranslateFn): SuTableLane[] {
  const sections = getSuRecordSections(person, t);
  const baseName = person.ui.fullName || person.ui.titleText || person.ui.shortHashText;
  const relationLabel = getRelationLabel(person, t);
  let laneIndex = 0;

  return sections.flatMap((section, sectionIndex) => {
    const chunks = splitTextByVisualUnits(section, SU_RECORD_UNITS_PER_LANE);
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
  lanes: SuTableLane[];
  generationsByDepth: Map<number, PaperGeneration>;
  repeatedDepth?: number;
  t: TranslateFn;
}): SuTableLane[] {
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
  lanes: SuTableLane[];
  generationsByDepth: Map<number, PaperGeneration>;
  repeatedDepth?: number;
  t: TranslateFn;
}): SuPageSpread[] {
  const { lanes, generationsByDepth, repeatedDepth, t } = params;
  const spreads: SuPageSpread[] = [];
  let start = 0;

  while (start < lanes.length || spreads.length === 0) {
    const spreadIndex = spreads.length + 1;
    const firstLane = lanes[start];
    const needsLeadingMark = spreadIndex > 1 && firstLane?.kind !== "generation";
    const capacity = needsLeadingMark ? SU_SPREAD_LANE_CAPACITY - 1 : SU_SPREAD_LANE_CAPACITY;
    const raw = lanes.slice(start, start + capacity);
    const withLeadingMark =
      !needsLeadingMark
        ? raw
        : ensureLeadingGenerationLane({ lanes: raw, generationsByDepth, repeatedDepth, t });

    spreads.push({
      index: spreadIndex,
      kind: spreadIndex === 1 ? "main" : "continuation",
      lanes: withLeadingMark,
      rightLanes: fillSuSideLanes({
        lanes: withLeadingMark.slice(0, SU_RIGHT_PAGE_LANE_CAPACITY),
        capacity: SU_RIGHT_PAGE_LANE_CAPACITY,
        spreadIndex,
        side: "right",
      }),
      leftLanes: fillSuSideLanes({
        lanes: withLeadingMark.slice(SU_RIGHT_PAGE_LANE_CAPACITY, SU_SPREAD_LANE_CAPACITY),
        capacity: SU_LEFT_PAGE_LANE_CAPACITY,
        spreadIndex,
        side: "left",
      }),
    });
    start += capacity || SU_SPREAD_LANE_CAPACITY;
  }

  return spreads;
}

export function buildSuPaperBook(params: {
  generations: PaperGeneration[];
  t?: TranslateFn;
}): SuPaperBook {
  const { generations } = params;
  const t = params.t || fallbackTranslate;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
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
    const lanes: SuTableLane[] = [];

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

export function getSuPersonLaneKeys(spreads: SuPageSpread[], personId: NodeId): string[] {
  return spreads
    .flatMap((spread) => spread.lanes)
    .filter((lane): lane is Extract<SuTableLane, { kind: "person" }> =>
      lane.kind === "person" && lane.person.id === personId,
    )
    .map((lane) => lane.key);
}
