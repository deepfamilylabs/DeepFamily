import {
  splitPaperRecordLines,
  type PaperGeneration,
  type PaperPerson,
  type TranslateFn,
} from "../paperData";
import { getPaperGenerationMark, getPaperRelationLabel, toChineseNumeral } from "../paperText";

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
  relationLabel: string;
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
export const OU_CHART_STEP = OU_GENERATIONS_PER_CHART - 1;
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
// Calibrated to the 13px body text used by vertical paper records: a column is ~144px tall
// (168px row − 24px py-3 padding), fitting ~12 full-width glyphs at 13px, and each column
// advances ceil(13px × 1.55 line-height) ≈ 21px horizontally.
export const OU_RECORD_CHARS_PER_COLUMN = 12;
export const OU_RECORD_COLUMN_WIDTH = 21;
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

function formatOuRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

export function getOuGenerationMark(depth: number, t: TranslateFn): string {
  return getPaperGenerationMark(depth, t);
}

export function getOuFullRecordText(person: PaperPerson, t?: TranslateFn): string {
  // Ou omits the 子女 (children) line — only the Modern style lists children in its body text.
  const { baseLines } = splitPaperRecordLines(person, t);
  return baseLines.map(formatOuRecordLine).join("，") || person.ui.shortHashText;
}

function getOuRecordSections(person: PaperPerson, t: TranslateFn): string[] {
  // Only the base biography is laid out; the 子女 line is dropped (see getOuFullRecordText).
  const { baseLines } = splitPaperRecordLines(person, t);
  const baseRecord = baseLines.map(formatOuRecordLine).join("，") || person.ui.shortHashText;
  return [baseRecord];
}

// Full textual record for the hover title: the parentage label (e.g. "曹操长子") followed by
// the biography. The label itself is shown above the name (see relationLabel on each entry), so
// the laid-out biography body and its width measurement use getOuFullRecordText instead.
export function getOuRecordText(person: PaperPerson, t: TranslateFn): string {
  const label = getPaperRelationLabel(person, t, { withParentName: true });
  const record = getOuFullRecordText(person, t);
  return label ? `${label}，${record}` : record;
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

function getOuRecordTotalSlotSpan(person: PaperPerson, t: TranslateFn): number {
  // The biography body is what occupies the flexible width; the parentage label sits in the
  // fixed-width name lane, so width is measured from the biography alone.
  return getWidthSlotSpan(getTextWidthPx(getOuFullRecordText(person, t)));
}

export function getOuRecordSlotSpan(person: PaperPerson, t: TranslateFn): number {
  return Math.min(OU_PAGE_SIDE_CAPACITY, getOuRecordTotalSlotSpan(person, t));
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
  t: TranslateFn,
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
    relationLabel: string,
    availableWidth = getOuSideWidth(side, pageBodyWidths),
  ) => {
    const widthPx = getTextWidthPx(text, availableWidth);
    spreads[spreadIndex].push({
      key: `${person.id}:${spreadIndex}:${side}:${partIndex}`,
      person,
      text,
      relationLabel,
      side,
      slotSpan: getWidthSlotSpan(widthPx),
      widthPx,
      continued: partIndex > 0,
      partIndex: partIndex + 1,
    });
    usedWidth += widthPx;
  };

  for (const person of people) {
    let partIndex = 0;
    // The parentage label rides above the name on the first part only, so the biography body is
    // laid out unchanged — no inline "曹操长子，…" prefix. Same shared two-column shape: the
    // father name and rank word are "\n"-joined so the renderer lays them out as adjacent vertical
    // columns (father on the right, 长子/之子 on the left).
    const relationLabel = getPaperRelationLabel(person, t, {
      withParentName: true,
      separator: "\n",
      parentNameMax: 3,
    });
    const sections = getOuRecordSections(person, t);

    for (const section of sections) {
      const chars = Array.from(section);
      let start = 0;

      while (start < chars.length) {
        const sideWidth = getOuSideWidth(side, pageBodyWidths);
        const availableWidth = Math.max(0, sideWidth - usedWidth);
        if (availableWidth < OU_PERSON_MIN_WIDTH) {
          advanceSide();
          continue;
        }

        const entryRelationLabel = partIndex === 0 ? relationLabel : "";
        const remainingText = chars.slice(start).join("");
        const remainingWidth = getNaturalTextWidthPx(remainingText);
        if (remainingWidth <= availableWidth) {
          pushEntry(person, remainingText, partIndex, entryRelationLabel, availableWidth);
          partIndex += 1;
          break;
        }

        const chunkLength = Math.min(
          getTextCharCapacityForWidth(availableWidth),
          chars.length - start,
        );
        const text = chars.slice(start, start + chunkLength).join("");
        pushEntry(person, text, partIndex, entryRelationLabel, availableWidth);
        start += chunkLength;
        partIndex += 1;
        if (start < chars.length) advanceSide();
      }
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
      paginateGenerationEntries(generation.people, t, pageBodyWidths),
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
