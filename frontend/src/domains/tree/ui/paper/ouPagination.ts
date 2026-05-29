import type { PaperGeneration, PaperPerson, TranslateFn } from "./paperData";

export type OuPageSide = "left" | "right";

export type OuGenerationRow = {
  depth: number;
  label: string;
  repeated: boolean;
  entries: OuPersonRecordEntry[];
};

export type OuPageSpread = {
  index: number;
  kind: "main" | "continuation";
  rows: OuGenerationRow[];
};

export type OuChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  spreads: OuPageSpread[];
};

export type OuPaperBook = {
  charts: OuChartWindow[];
};

export type OuPersonRecordEntry = {
  key: string;
  person: PaperPerson;
  text: string;
  side: OuPageSide;
  slotSpan: number;
};

export const OU_GENERATIONS_PER_CHART = 5;
export const OU_CHART_STEP = 4;
export const OU_RIGHT_PAGE_CAPACITY = 3;
export const OU_LEFT_PAGE_CAPACITY = 3;
export const OU_SPREAD_ROW_CAPACITY = OU_RIGHT_PAGE_CAPACITY + OU_LEFT_PAGE_CAPACITY;
export const OU_PAGE_SIDE_CAPACITY = 3;
export const OU_RECORD_CHARS_PER_SLOT = 96;
export const OU_PERSON_SLOT_WIDTH = 168;

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

function formatOuRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

export function getOuGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.ouGenerationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

export function getOuFullRecordText(person: PaperPerson): string {
  const lines = person.classicalLines.length ? person.classicalLines : person.detailLines;
  return lines.map(formatOuRecordLine).join("，") || person.ui.shortHashText;
}

export function getOuRecordSlotSpan(person: PaperPerson): number {
  return Math.min(
    OU_PAGE_SIDE_CAPACITY,
    Math.max(1, Math.ceil(Array.from(getOuFullRecordText(person)).length / OU_RECORD_CHARS_PER_SLOT)),
  );
}

export function splitOuRowEntries(
  row: OuGenerationRow,
  side: OuPageSide,
): OuPersonRecordEntry[] {
  return side === "right"
    ? row.entries.filter((entry) => entry.side === "right")
    : row.entries.filter((entry) => entry.side === "left");
}

function paginateGenerationEntries(people: PaperPerson[]): OuPersonRecordEntry[][] {
  const spreads: OuPersonRecordEntry[][] = [[]];
  let spreadIndex = 0;
  let side: OuPageSide = "right";
  let usedSlots = 0;

  for (const person of people) {
    const slotSpan = getOuRecordSlotSpan(person);
    if (usedSlots + slotSpan > OU_PAGE_SIDE_CAPACITY) {
      if (side === "right") {
        side = "left";
      } else {
        spreadIndex += 1;
        spreads[spreadIndex] = [];
        side = "right";
      }
      usedSlots = 0;
    }

    spreads[spreadIndex].push({
      key: `${person.id}:${spreadIndex}:${side}`,
      person,
      text: getOuFullRecordText(person),
      side,
      slotSpan,
    });
    usedSlots += slotSpan;
  }

  return spreads;
}

export function buildOuPaperBook(params: {
  generations: PaperGeneration[];
  t?: TranslateFn;
}): OuPaperBook {
  const { generations } = params;
  const t = params.t || fallbackTranslate;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
  const entriesByDepth = new Map(
    generations.map((generation) => [
      generation.depth,
      paginateGenerationEntries(generation.people),
    ]),
  );
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: OuChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += OU_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: OU_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
    const spreadCount = Math.max(
      1,
      ...generationDepths.map((depth) =>
        entriesByDepth.get(depth)?.length || 0,
      ),
    );

    charts.push({
      index: chartIndex,
      generationDepths,
      repeatedDepth,
      spreads: Array.from({ length: spreadCount }, (_value, spreadOffset) => {
        const spreadIndex = spreadOffset + 1;
        return {
          index: spreadIndex,
          kind: spreadIndex === 1 ? "main" : "continuation",
          rows: generationDepths.map((depth) => {
            const generation = generationsByDepth.get(depth);
            return {
              depth,
              label: getGenerationLabel(generation, depth, t),
              repeated: repeatedDepth === depth,
              entries: entriesByDepth.get(depth)?.[spreadOffset] || [],
            };
          }),
        };
      }),
    });
  }

  return { charts };
}
