import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";

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
  widthPx: number;
  continued: boolean;
  partIndex: number;
};

export type OuPageBodyWidths = {
  right: number;
  left: number;
};

export const OU_GENERATIONS_PER_CHART = 5;
export const OU_CHART_STEP = 4;
export const OU_RIGHT_PAGE_CAPACITY = 3;
export const OU_LEFT_PAGE_CAPACITY = 3;
export const OU_SPREAD_ROW_CAPACITY = OU_RIGHT_PAGE_CAPACITY + OU_LEFT_PAGE_CAPACITY;
export const OU_PAGE_SIDE_CAPACITY = 3;
export const OU_PERSON_SLOT_WIDTH = 168;
export const OU_RIGHT_PAGE_BODY_WIDTH = OU_PAGE_SIDE_CAPACITY * OU_PERSON_SLOT_WIDTH;
export const OU_LEFT_PAGE_BODY_WIDTH = OU_RIGHT_PAGE_BODY_WIDTH + 56;
export const OU_COLUMN_ALIGNMENT_WIDTH = 14;
export const OU_PERSON_MIN_WIDTH = 112;
export const OU_PERSON_BASE_WIDTH = 84;
export const OU_RECORD_CHARS_PER_COLUMN = 14;
export const OU_RECORD_COLUMN_WIDTH = 17;
const DEFAULT_OU_PAGE_BODY_WIDTHS: OuPageBodyWidths = {
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

function getTextColumnCount(text: string): number {
  return Math.max(1, Math.ceil(Array.from(text).length / OU_RECORD_CHARS_PER_COLUMN));
}

function alignOuWidth(widthPx: number): number {
  return Math.ceil(widthPx / OU_COLUMN_ALIGNMENT_WIDTH) * OU_COLUMN_ALIGNMENT_WIDTH;
}

function getOuSideWidth(
  side: OuPageSide,
  pageBodyWidths: OuPageBodyWidths = DEFAULT_OU_PAGE_BODY_WIDTHS,
): number {
  return side === "right" ? pageBodyWidths.right : pageBodyWidths.left;
}

function getNaturalTextWidthPx(text: string): number {
  return alignOuWidth(
    Math.max(
      OU_PERSON_MIN_WIDTH,
      OU_PERSON_BASE_WIDTH + getTextColumnCount(text) * OU_RECORD_COLUMN_WIDTH,
    ),
  );
}

function getTextWidthPx(text: string, sideWidth = OU_RIGHT_PAGE_BODY_WIDTH): number {
  return Math.min(sideWidth, getNaturalTextWidthPx(text));
}

function getTextCharCapacityForWidth(widthPx: number): number {
  const columns = Math.max(
    1,
    Math.floor((widthPx - OU_PERSON_BASE_WIDTH) / OU_RECORD_COLUMN_WIDTH),
  );
  return columns * OU_RECORD_CHARS_PER_COLUMN;
}

function getWidthSlotSpan(widthPx: number): number {
  return Math.min(
    OU_PAGE_SIDE_CAPACITY,
    Math.max(1, Math.ceil(widthPx / OU_PERSON_SLOT_WIDTH)),
  );
}

function getOuRecordTotalSlotSpan(person: PaperPerson): number {
  return getWidthSlotSpan(getTextWidthPx(getOuFullRecordText(person)));
}

export function getOuRecordSlotSpan(person: PaperPerson): number {
  return Math.min(OU_PAGE_SIDE_CAPACITY, getOuRecordTotalSlotSpan(person));
}

export function splitOuRowEntries(
  row: OuGenerationRow,
  side: OuPageSide,
): OuPersonRecordEntry[] {
  return side === "right"
    ? row.entries.filter((entry) => entry.side === "right")
    : row.entries.filter((entry) => entry.side === "left");
}

function paginateGenerationEntries(
  people: PaperPerson[],
  pageBodyWidths: OuPageBodyWidths = DEFAULT_OU_PAGE_BODY_WIDTHS,
): OuPersonRecordEntry[][] {
  const spreads: OuPersonRecordEntry[][] = [[]];
  let spreadIndex = 0;
  let side: OuPageSide = "right";
  let usedWidth = 0;

  const advanceSide = () => {
    if (side === "right") {
      side = "left";
    } else {
      spreadIndex += 1;
      spreads[spreadIndex] = [];
      side = "right";
    }
    usedWidth = 0;
  };

  const pushEntry = (
    person: PaperPerson,
    text: string,
    partIndex: number,
    availableWidth = getOuSideWidth(side, pageBodyWidths),
  ) => {
    const widthPx = getTextWidthPx(text, availableWidth);
    spreads[spreadIndex].push({
      key: `${person.id}:${spreadIndex}:${side}:${partIndex}`,
      person,
      text,
      side,
      slotSpan: getWidthSlotSpan(widthPx),
      widthPx,
      continued: partIndex > 0,
      partIndex: partIndex + 1,
    });
    usedWidth += widthPx;
  };

  for (const person of people) {
    const fullText = getOuFullRecordText(person);
    const chars = Array.from(fullText);
    let start = 0;
    let partIndex = 0;

    while (start < chars.length) {
      const sideWidth = getOuSideWidth(side, pageBodyWidths);
      const availableWidth = Math.max(0, sideWidth - usedWidth);
      if (availableWidth < OU_PERSON_MIN_WIDTH) {
        advanceSide();
        continue;
      }

      const remainingText = chars.slice(start).join("");
      const remainingWidth = getNaturalTextWidthPx(remainingText);
      if (remainingWidth <= availableWidth) {
        pushEntry(person, remainingText, partIndex, availableWidth);
        break;
      }

      const chunkLength = Math.min(
        getTextCharCapacityForWidth(availableWidth),
        chars.length - start,
      );
      const text = chars.slice(start, start + chunkLength).join("");
      pushEntry(person, text, partIndex, availableWidth);
      start += chunkLength;
      partIndex += 1;
      if (start < chars.length) advanceSide();
    }
  }

  return spreads;
}

export function buildOuPaperBook(params: {
  generations: PaperGeneration[];
  t?: TranslateFn;
  pageBodyWidths?: OuPageBodyWidths;
}): OuPaperBook {
  const { generations } = params;
  const t = params.t || fallbackTranslate;
  const pageBodyWidths = params.pageBodyWidths || DEFAULT_OU_PAGE_BODY_WIDTHS;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(generations.map((generation) => [generation.depth, generation]));
  const entriesByDepth = new Map(
    generations.map((generation) => [
      generation.depth,
      paginateGenerationEntries(generation.people, pageBodyWidths),
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
