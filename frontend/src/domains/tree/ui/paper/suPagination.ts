import type { NodeId } from "../../../../shared/model";
import type { PaperGeneration, PaperPerson, TranslateFn } from "./paperData";

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
export const SU_RIGHT_PAGE_LANE_CAPACITY = 13;
export const SU_LEFT_PAGE_LANE_CAPACITY = 13;
export const SU_SPREAD_LANE_CAPACITY = SU_RIGHT_PAGE_LANE_CAPACITY + SU_LEFT_PAGE_LANE_CAPACITY;
export const SU_PERSON_LANE_WIDTH = 42;
export const SU_GENERATION_MARK_WIDTH = 34;
export const SU_RECORD_CHARS_PER_LANE = 42;

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

function toChineseNumeral(value: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 0 || value >= 100) return String(value);
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

function formatSuRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

function splitTextByLength(text: string, maxLength: number): string[] {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return [text];

  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += maxLength) {
    chunks.push(chars.slice(start, start + maxLength).join(""));
  }
  return chunks;
}

function getRelationLabel(person: PaperPerson, t: TranslateFn): string {
  if (person.relation?.kind === "root") return t("genealogyBook.suRootLabel", "ancestor");
  if (person.relation?.kind !== "child") return "";

  const childNumber = person.relation.siblingIndex + 1;
  const gender = person.nodeData?.gender ?? person.ui.gender;
  if (gender === 1) {
    if (childNumber === 1) return t("genealogyBook.suFirstSon", "first son");
    if (childNumber === 2) return t("genealogyBook.suSecondSon", "second son");
    return t("genealogyBook.suNthSon", "{{number}} son", {
      number: toChineseNumeral(childNumber),
    });
  }
  if (gender === 2) {
    if (childNumber === 1) return t("genealogyBook.suFirstDaughter", "first daughter");
    if (childNumber === 2) return t("genealogyBook.suSecondDaughter", "second daughter");
    return t("genealogyBook.suNthDaughter", "{{number}} daughter", {
      number: toChineseNumeral(childNumber),
    });
  }

  return "";
}

export function getSuGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.suGenerationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

export function getSuFullRecordText(person: PaperPerson): string {
  const lines = person.classicalLines.length ? person.classicalLines : person.detailLines;
  return lines.map(formatSuRecordLine).join("，") || person.ui.shortHashText;
}

export function splitSuSpreadColumns(
  spread: SuPageSpread,
  side: SuPageSide,
): SuTableLane[] {
  return side === "right" ? spread.rightLanes : spread.leftLanes;
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
  const fullText = getSuFullRecordText(person);
  const chunks = splitTextByLength(fullText, SU_RECORD_CHARS_PER_LANE);
  const baseName = person.ui.fullName || person.ui.titleText || person.ui.shortHashText;
  const relationLabel = getRelationLabel(person, t);

  return chunks.map((text, index) => ({
    kind: "person",
    key: `person:${person.id}:${index}`,
    depth: person.depth,
    label,
    person,
    relationLabel: index === 0 ? relationLabel : "",
    name: index === 0 ? baseName : "",
    text,
    continued: index > 0,
    partIndex: index + 1,
  }));
}

function padLanes(lanes: SuTableLane[], targetLength: number, prefix: string): SuTableLane[] {
  if (lanes.length >= targetLength) return lanes;
  return [
    ...lanes,
    ...Array.from({ length: targetLength - lanes.length }, (_value, index) => ({
      kind: "blank" as const,
      key: `${prefix}:blank:${index}`,
    })),
  ];
}

function firstPersonLane(lanes: SuTableLane[]): Extract<SuTableLane, { kind: "person" }> | undefined {
  return lanes.find((lane): lane is Extract<SuTableLane, { kind: "person" }> => lane.kind === "person");
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
  const rawSpreads: SuTableLane[][] = [];

  for (let start = 0; start < lanes.length; start += SU_SPREAD_LANE_CAPACITY) {
    rawSpreads.push(lanes.slice(start, start + SU_SPREAD_LANE_CAPACITY));
  }

  if (!rawSpreads.length) rawSpreads.push([]);

  return rawSpreads.map((raw, spreadOffset) => {
    const spreadIndex = spreadOffset + 1;
    const withLeadingMark =
      spreadIndex === 1
        ? raw
        : ensureLeadingGenerationLane({ lanes: raw, generationsByDepth, repeatedDepth, t });
    const padded = padLanes(
      withLeadingMark,
      SU_SPREAD_LANE_CAPACITY,
      `spread:${spreadIndex}`,
    );

    return {
      index: spreadIndex,
      kind: spreadIndex === 1 ? "main" : "continuation",
      lanes: padded,
      rightLanes: padded.slice(0, SU_RIGHT_PAGE_LANE_CAPACITY),
      leftLanes: padded.slice(SU_RIGHT_PAGE_LANE_CAPACITY, SU_SPREAD_LANE_CAPACITY),
    };
  });
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
