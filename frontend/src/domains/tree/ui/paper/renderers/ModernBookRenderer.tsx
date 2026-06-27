import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  splitPaperRecordLines,
  type PaperGeneration,
  type PaperPerson,
  type TranslateFn,
} from "../paperData";
import {
  PAPER_LINE,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
} from "../paperStyles";
import { PaperZoomViewport } from "../PaperZoomViewport";
import {
  clipText,
  getPaperGenerationMark,
  getPaperRelationLabel,
  getPaperSpineTitle,
  splitTextByVisualUnits,
  toChineseNumeral,
} from "../paperText";
import { PaperFrameOverlay } from "./PaperFrameOverlay";
import { PaperSpine } from "./PaperSpine";

type ModernTableRow =
  | {
      kind: "generation";
      key: string;
      depth: number;
      label: string;
      repeated: boolean;
    }
  | {
      kind: "person";
      key: string;
      person: PaperPerson;
      relationLabel: string;
      name: string;
      fullRecord: string;
      text: string;
      lines?: string[];
      continued: boolean;
      // True when the record spills into a later row.
      hasContinuation: boolean;
      partIndex: number;
    }
  | {
      kind: "blank";
      key: string;
    };

type ModernPageSpread = {
  index: number;
  kind: "main" | "continuation";
  rows: ModernTableRow[];
  leftRows: ModernTableRow[];
  rightRows: ModernTableRow[];
};

type ModernChartWindow = {
  index: number;
  generationDepths: number[];
  repeatedDepth?: number;
  spreads: ModernPageSpread[];
};

type ModernPaperBook = {
  charts: ModernChartWindow[];
};

const MODERN_GENERATIONS_PER_CHART = 5;
const MODERN_CHART_STEP = MODERN_GENERATIONS_PER_CHART;
const MODERN_PAGE_ROW_CAPACITY = 15;
const MODERN_SPREAD_ROW_CAPACITY = MODERN_PAGE_ROW_CAPACITY * 2;
const MODERN_SPINE_WIDTH = 72;
const MODERN_REL_COL_PX = 64;
const MODERN_NAME_COL_PX = 112;
const MODERN_BIO_PADDING_PX = 24; // px-3 on both sides of the biography cell
// Break full lines a few px short of the cell width so justify can stretch them flush to the right
// edge without the rendered line ever exceeding the box (which would wrap and break the 2-line
// layout the measured-line model guarantees). The stretch is well under 0.5px per character.
const MODERN_LINE_JUSTIFY_SLACK_PX = 4;
// The modern ledger is horizontal text in fixed-height rows, so a cell's capacity is set by the
// biography column WIDTH (unlike vertical paper styles, which are bound by the fixed page
// height). The spread uses the same elastic paper frame as the other book renderers, so the per-row
// character budget is computed from the measured page width at render time. Units: a full-width
// glyph ≈ 14px = 2 units, a half-width ASCII/digit ≈ 7px = 1 unit; text chunks are cut at the
// estimated two-line capacity so a continuation row starts only after the current cell is full.
const MODERN_UNIT_PX = PAPER_TEXT.body.fontSize / 2;
const MODERN_RECORD_UNITS_PER_LINE = 50;
export const MODERN_RECORD_UNITS_PER_ROW = MODERN_RECORD_UNITS_PER_LINE * 2;
const MODERN_TABLE_COLUMNS = `${MODERN_REL_COL_PX}px ${MODERN_NAME_COL_PX}px minmax(0, 1fr)`;
const MODERN_PAGE_LOOKUP_ITERATIONS = 6;

type ModernPersonPageLookup = Map<PaperPerson["id"], number>;
type ModernRecordBudget = {
  unitsPerRow: number;
  maxLinePx?: number;
  measureTextPx?: (text: string) => number;
};

type ModernRecordChunk = {
  text: string;
  lines?: string[];
};

// Derive the per-row visual-unit budget from the measured spread width so cells fill ~2 lines.
function getModernTextMeasurer(): ((text: string) => number) | undefined {
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return undefined;
  if (typeof document === "undefined") return undefined;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.font = `${PAPER_TEXT.body.fontSize}px ${PAPER_NOTE_FONT_STACK}`;
    return (text: string) => context.measureText(text).width;
  } catch {
    return undefined;
  }
}

function computeModernRecordBudget(spreadWidth: number): ModernRecordBudget {
  if (spreadWidth <= 0) {
    return {
      unitsPerRow: MODERN_RECORD_UNITS_PER_ROW,
    };
  }

  const pageWidth = (spreadWidth - MODERN_SPINE_WIDTH) / 2;
  const bioTextPx = pageWidth - MODERN_REL_COL_PX - MODERN_NAME_COL_PX - MODERN_BIO_PADDING_PX;
  const unitsPerLine = Math.max(1, Math.floor(bioTextPx / MODERN_UNIT_PX));
  return {
    unitsPerRow: unitsPerLine * 2,
    // Reserve a small slack so justify fills the line to the box edge instead of risking a wrap.
    maxLinePx: Math.max(1, bioTextPx - MODERN_LINE_JUSTIFY_SLACK_PX),
    measureTextPx: getModernTextMeasurer(),
  };
}
const MODERN_TABLE_COLUMN_STYLE: CSSProperties = {
  gridTemplateColumns: MODERN_TABLE_COLUMNS,
};

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

function formatModernRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

function formatModernCount(key: string, fallback: string, count: number, t: TranslateFn): string {
  return t(key, fallback, {
    number: count,
    han: toChineseNumeral(count),
  });
}

function formatModernPageRef(pageNumber: number, t: TranslateFn): string {
  return t("genealogyBook.modernPageRef", "[p. {{number}}]", {
    number: pageNumber,
    han: toChineseNumeral(pageNumber),
  });
}

function getModernTransmissionSection(
  person: PaperPerson,
  t: TranslateFn,
  pageLookup: ModernPersonPageLookup,
): string | undefined {
  if (!person.children.length) return undefined;

  const sons = person.children.filter((child) => child.gender === 1);
  const daughters = person.children.filter((child) => child.gender === 2);
  const unknown = person.children.filter((child) => child.gender !== 1 && child.gender !== 2);
  const counts = [
    sons.length
      ? formatModernCount("genealogyBook.modernSonsCount", "sons {{number}}", sons.length, t)
      : undefined,
    daughters.length
      ? formatModernCount(
          "genealogyBook.modernDaughtersCount",
          "daughters {{number}}",
          daughters.length,
          t,
        )
      : undefined,
    unknown.length
      ? formatModernCount("genealogyBook.modernIssueCount", "issue {{number}}", unknown.length, t)
      : undefined,
  ].filter(Boolean) as string[];

  const childNames = [...sons, ...daughters, ...unknown].map((child) => {
    const pageNumber = pageLookup.get(child.id);
    return pageNumber ? `${child.name} ${formatModernPageRef(pageNumber, t)}` : child.name;
  });

  return [...counts, ...childNames].join(" ");
}

function getModernGenerationMark(depth: number, t: TranslateFn): string {
  return getPaperGenerationMark(depth, t);
}

function getModernFullRecordText(
  person: PaperPerson,
  t: TranslateFn,
  pageLookup: ModernPersonPageLookup,
): string {
  const { baseLines } = splitPaperRecordLines(person, t, "labeled");
  const lines = compactUnique([...baseLines, getModernTransmissionSection(person, t, pageLookup)]);

  return lines.map(formatModernRecordLine).join("，") || person.ui.shortHashText;
}

function getModernRecordSections(
  person: PaperPerson,
  t: TranslateFn,
  pageLookup: ModernPersonPageLookup,
): string[] {
  const { baseLines, spouseLine } = splitPaperRecordLines(person, t, "labeled");
  // Lift the spouse out of the biography so it stands on its own row between the life record and
  // the transmission (children) row — mirroring how 传子/传女 already gets a dedicated row.
  const bioLines = spouseLine ? baseLines.filter((line) => line !== spouseLine) : baseLines;
  const baseRecord = bioLines.map(formatModernRecordLine).join("，") || person.ui.shortHashText;
  const spouseRecord = spouseLine ? formatModernRecordLine(spouseLine) : undefined;
  const transmissionRecord = getModernTransmissionSection(person, t, pageLookup);
  return compactUnique([baseRecord, spouseRecord, transmissionRecord]);
}

function getModernRelationLabel(person: PaperPerson, t: TranslateFn): string {
  // Father name above the rank word, matching the two-line relation column layout.
  return getPaperRelationLabel(person, t, { withParentName: true, separator: "\n" });
}

function getModernPersonName(person: PaperPerson): string {
  return clipText(person.ui.fullName || person.ui.titleText || person.ui.shortHashText, 12);
}

function splitModernRecordText(text: string, budget: ModernRecordBudget): ModernRecordChunk[] {
  const { maxLinePx, measureTextPx } = budget;
  if (!maxLinePx || !measureTextPx) {
    return splitTextByVisualUnits(text, budget.unitsPerRow).map((chunk) => ({ text: chunk }));
  }
  if (measureTextPx(text) <= maxLinePx) return [{ text, lines: [text] }];

  const takeLine = (source: string): { line: string; rest: string } => {
    let line = "";
    let restStart = 0;
    const chars = Array.from(source);

    for (let index = 0; index < chars.length; index += 1) {
      const candidate = `${line}${chars[index]}`;
      if (line && measureTextPx(candidate) > maxLinePx) {
        restStart = index;
        return {
          line,
          rest: chars.slice(restStart).join(""),
        };
      }
      line = candidate;
    }

    return {
      line,
      rest: "",
    };
  };

  const chunks: ModernRecordChunk[] = [];
  let rest = text;

  while (rest) {
    const first = takeLine(rest);
    const second = first.rest ? takeLine(first.rest) : { line: "", rest: "" };
    const lines = second.line ? [first.line, second.line] : [first.line];
    chunks.push({
      text: lines.join(""),
      lines,
    });
    rest = second.rest;
  }

  return chunks;
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

function makePersonRows(params: {
  person: PaperPerson;
  t: TranslateFn;
  recordBudget: ModernRecordBudget;
  pageLookup: ModernPersonPageLookup;
}): ModernTableRow[] {
  const { person, t, recordBudget, pageLookup } = params;
  const fullRecord = getModernFullRecordText(person, t, pageLookup);
  const sections = getModernRecordSections(person, t, pageLookup);
  const relationLabel = getModernRelationLabel(person, t);
  const name = getModernPersonName(person);
  let rowIndex = 0;

  return sections.flatMap((section, sectionIndex) => {
    const chunks = splitModernRecordText(section, recordBudget);
    return chunks.map((chunk, chunkIndex) => {
      const isFirstPersonRow = rowIndex === 0;
      const row = {
        kind: "person" as const,
        key: `person:${person.id}:${sectionIndex}:${chunkIndex}`,
        person,
        relationLabel: isFirstPersonRow ? relationLabel : "",
        name: isFirstPersonRow ? name : "",
        fullRecord,
        text: chunk.text,
        lines: chunk.lines,
        continued: chunkIndex > 0,
        hasContinuation: chunkIndex < chunks.length - 1,
        partIndex: rowIndex + 1,
      };
      rowIndex += 1;
      return row;
    });
  });
}

function makeBlankRow(params: { spreadIndex: number; side: "left" | "right"; index: number }) {
  return {
    kind: "blank" as const,
    key: `blank:${params.spreadIndex}:${params.side}:${params.index}`,
  };
}

function fillModernPageRows(params: {
  rows: ModernTableRow[];
  spreadIndex: number;
  side: "left" | "right";
}): ModernTableRow[] {
  const { rows, spreadIndex, side } = params;
  if (rows.length >= MODERN_PAGE_ROW_CAPACITY) return rows;

  return [
    ...rows,
    ...Array.from({ length: MODERN_PAGE_ROW_CAPACITY - rows.length }, (_value, offset) =>
      makeBlankRow({ spreadIndex, side, index: rows.length + offset }),
    ),
  ];
}

function splitRowsIntoSpreads(rows: ModernTableRow[]): ModernPageSpread[] {
  const spreads: ModernPageSpread[] = [];
  let start = 0;

  while (start < rows.length || spreads.length === 0) {
    const spreadIndex = spreads.length + 1;
    const spreadRows = rows.slice(start, start + MODERN_SPREAD_ROW_CAPACITY);

    spreads.push({
      index: spreadIndex,
      kind: spreadIndex === 1 ? "main" : "continuation",
      rows: spreadRows,
      leftRows: fillModernPageRows({
        rows: spreadRows.slice(0, MODERN_PAGE_ROW_CAPACITY),
        spreadIndex,
        side: "left",
      }),
      rightRows: fillModernPageRows({
        rows: spreadRows.slice(MODERN_PAGE_ROW_CAPACITY, MODERN_SPREAD_ROW_CAPACITY),
        spreadIndex,
        side: "right",
      }),
    });
    start += MODERN_SPREAD_ROW_CAPACITY;
  }

  return spreads;
}

function buildModernPaperBook(params: {
  generations: PaperGeneration[];
  t: TranslateFn;
  recordBudget: ModernRecordBudget;
  pageLookup: ModernPersonPageLookup;
}): ModernPaperBook {
  const { generations, t, recordBudget, pageLookup } = params;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(
    generations.map((generation) => [generation.depth, generation]),
  );
  const maxDepth = generations[generations.length - 1]?.depth || 0;
  const charts: ModernChartWindow[] = [];

  for (
    let startDepth = 0, chartIndex = 1;
    startDepth <= maxDepth;
    startDepth += MODERN_CHART_STEP, chartIndex += 1
  ) {
    const generationDepths = Array.from(
      { length: MODERN_GENERATIONS_PER_CHART },
      (_value, offset) => startDepth + offset,
    );
    const repeatedDepth: number | undefined = undefined;
    const rows: ModernTableRow[] = [];

    generationDepths.forEach((depth) => {
      const generation = generationsByDepth.get(depth);
      rows.push({
        kind: "generation",
        key: `generation:${depth}`,
        depth,
        label: getGenerationLabel(generation, depth, t),
        repeated: repeatedDepth === depth,
      });
      for (const person of generation?.people || []) {
        rows.push(...makePersonRows({ person, t, recordBudget, pageLookup }));
      }
    });

    charts.push({
      index: chartIndex,
      generationDepths,
      repeatedDepth,
      spreads: splitRowsIntoSpreads(rows),
    });
  }

  return { charts };
}

function collectModernPersonPageLookup(book: ModernPaperBook): ModernPersonPageLookup {
  const lookup: ModernPersonPageLookup = new Map();
  let pageNumber = 1;

  for (const chart of book.charts) {
    for (const spread of chart.spreads) {
      for (const row of spread.leftRows) {
        if (row.kind === "person" && row.partIndex === 1 && !lookup.has(row.person.id)) {
          lookup.set(row.person.id, pageNumber);
        }
      }
      pageNumber += 1;

      for (const row of spread.rightRows) {
        if (row.kind === "person" && row.partIndex === 1 && !lookup.has(row.person.id)) {
          lookup.set(row.person.id, pageNumber);
        }
      }
      pageNumber += 1;
    }
  }

  return lookup;
}

function areModernPageLookupsEqual(a: ModernPersonPageLookup, b: ModernPersonPageLookup): boolean {
  if (a.size !== b.size) return false;
  for (const [id, pageNumber] of a) {
    if (b.get(id) !== pageNumber) return false;
  }
  return true;
}

function buildModernPaperBookWithPageRefs(params: {
  generations: PaperGeneration[];
  t: TranslateFn;
  recordBudget: ModernRecordBudget;
}): ModernPaperBook {
  let pageLookup: ModernPersonPageLookup = new Map();
  let book = buildModernPaperBook({ ...params, pageLookup });

  for (let attempt = 0; attempt < MODERN_PAGE_LOOKUP_ITERATIONS; attempt += 1) {
    const nextLookup = collectModernPersonPageLookup(book);
    if (areModernPageLookupsEqual(pageLookup, nextLookup)) return book;

    pageLookup = nextLookup;
    book = buildModernPaperBook({ ...params, pageLookup });
  }

  return book;
}

function ModernTableHeader({ t }: { t: TranslateFn }) {
  return (
    <div
      className="grid border-b text-center leading-none tracking-normal"
      style={{
        ...MODERN_TABLE_COLUMN_STYLE,
        ...PAPER_TEXT.tableHeader,
        borderColor: PAPER_LINE.soft,
      }}
    >
      <div
        className="flex min-w-0 items-center justify-center border-r px-1"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        {t("genealogyBook.modernHeaderRelation", "Relation")}
      </div>
      <div
        className="flex min-w-0 items-center justify-center border-r px-1"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        {t("genealogyBook.modernHeaderName", "Name")}
      </div>
      <div className="flex min-w-0 items-center justify-center px-2">
        {t("genealogyBook.modernHeaderBiography", "Biography")}
      </div>
    </div>
  );
}

function ModernGenerationRowView({
  row,
  t,
}: {
  row: Extract<ModernTableRow, { kind: "generation" }>;
  t: TranslateFn;
}) {
  return (
    <div
      className="relative flex min-h-0 items-center justify-center border-b px-3 leading-none tracking-normal"
      style={{
        ...PAPER_TEXT.generationRow,
        borderColor: PAPER_LINE.soft,
      }}
      data-testid={`paper-modern-generation-${row.depth}`}
      aria-label={row.label}
    >
      <span data-testid={`paper-modern-generation-mark-${row.depth}`}>
        {getModernGenerationMark(row.depth, t)}
      </span>
      {row.repeated ? (
        <span className="absolute right-3" style={{ ...PAPER_TEXT.tag }}>
          {t("genealogyBook.repeatedGeneration", "repeated")}
        </span>
      ) : null}
    </div>
  );
}

function ModernPersonRowView({
  row,
}: {
  row: Extract<ModernTableRow, { kind: "person" }>;
  t: TranslateFn;
}) {
  const measuredLines = row.lines?.length ? row.lines : undefined;
  const firstPartTestId =
    row.partIndex === 1
      ? `paper-modern-row-${row.person.id}`
      : `paper-modern-row-${row.person.id}-${row.partIndex}`;

  return (
    <div
      className="grid min-h-0 border-b"
      style={{
        ...MODERN_TABLE_COLUMN_STYLE,
        borderColor: PAPER_LINE.soft,
      }}
      data-testid={firstPartTestId}
      data-continued={row.continued ? "true" : "false"}
      data-part-index={row.partIndex}
      title={row.fullRecord}
    >
      <div
        className="flex h-full min-h-0 min-w-0 items-center justify-center whitespace-pre-line border-r px-1 text-center leading-5"
        style={{
          ...PAPER_TEXT.relation,
          borderColor: PAPER_LINE.soft,
        }}
        data-testid={row.partIndex === 1 ? `paper-modern-relation-${row.person.id}` : undefined}
      >
        {row.relationLabel}
      </div>
      <div
        className="flex h-full min-h-0 min-w-0 items-center justify-center border-r px-2 text-center"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        {row.name ? (
          <strong
            className="block max-w-full leading-tight tracking-normal"
            style={{
              ...PAPER_TEXT.name,
              overflowWrap: "anywhere",
            }}
            data-testid={row.partIndex === 1 ? `paper-modern-name-${row.person.id}` : undefined}
          >
            {row.name}
          </strong>
        ) : null}
      </div>
      <p
        className="m-0 block h-full min-h-0 min-w-0 overflow-hidden px-3 py-1"
        style={{
          ...PAPER_TEXT.body,
          overflowWrap: measuredLines ? "normal" : "anywhere",
          // Browser line breaking can be conservative around CJK punctuation and mixed
          // ASCII/digits. When measured lines are available, render those exact lines so a
          // continuation row starts only after the current row's two lines are filled.
          wordBreak: measuredLines ? "normal" : "break-all",
          lineBreak: measuredLines ? "auto" : "anywhere",
          textAlign: "justify",
          textAlignLast: "auto",
          textJustify: "inter-character",
        }}
        data-testid={`paper-modern-detail-${row.person.id}`}
      >
        {measuredLines
          ? measuredLines.map((line, index) => {
              // Justify every filled line flush to the right edge; leave the biography's final
              // line (this section's last line, with no continuation row) ragged so a short tail
              // is not stretched into sparse gaps. pre-wrap keeps spaces while allowing justify;
              // the break-time slack guarantees these measured lines never wrap here.
              const isSectionTail = index === measuredLines.length - 1 && !row.hasContinuation;
              return (
                <span
                  key={`${row.key}-line-${index}`}
                  className="block overflow-hidden"
                  style={{
                    whiteSpace: "pre-wrap",
                    textAlignLast: isSectionTail ? "auto" : "justify",
                  }}
                >
                  {line}
                </span>
              );
            })
          : row.text}
      </p>
    </div>
  );
}

function ModernBlankRowView({ row }: { row: Extract<ModernTableRow, { kind: "blank" }> }) {
  return (
    <div
      className="grid min-h-0 border-b"
      style={{
        ...MODERN_TABLE_COLUMN_STYLE,
        borderColor: PAPER_LINE.soft,
      }}
      data-testid={`paper-modern-blank-${row.key}`}
      aria-hidden="true"
    >
      <div className="border-r" style={{ borderColor: PAPER_LINE.soft }} />
      <div className="border-r" style={{ borderColor: PAPER_LINE.soft }} />
      <div />
    </div>
  );
}

function ModernTableRowView({ row, t }: { row: ModernTableRow; t: TranslateFn }) {
  if (row.kind === "generation") return <ModernGenerationRowView row={row} t={t} />;
  if (row.kind === "person") return <ModernPersonRowView row={row} t={t} />;
  return <ModernBlankRowView row={row} />;
}

function ModernPage({
  rows,
  side,
  chartIndex,
  spreadIndex,
  t,
}: {
  rows: ModernTableRow[];
  side: "left" | "right";
  chartIndex: number;
  spreadIndex: number;
  t: TranslateFn;
}) {
  return (
    <div
      className="h-[872px] overflow-hidden"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-modern-${side}-${chartIndex}-${spreadIndex}`}
    >
      <div
        className="grid h-full"
        style={{
          gridTemplateRows: `38px repeat(${MODERN_PAGE_ROW_CAPACITY}, minmax(0, 1fr))`,
        }}
      >
        <ModernTableHeader t={t} />
        {rows.map((row) => (
          <ModernTableRowView
            key={`${side}-${chartIndex}-${spreadIndex}-${row.key}`}
            row={row}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

export function ModernBookRenderer({
  generations,
  t,
  spineTitleOverride,
  paperVars,
  hallName,
  fontScale,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
  spineTitleOverride?: string;
  paperVars?: CSSProperties;
  hallName?: string;
  fontScale?: number;
}) {
  const spreadRef = useRef<HTMLDivElement | null>(null);
  const [spreadWidth, setSpreadWidth] = useState(0);
  useLayoutEffect(() => {
    const el = spreadRef.current;
    if (!el) return;
    const measure = () => setSpreadWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const recordBudget = useMemo(() => computeModernRecordBudget(spreadWidth), [spreadWidth]);
  const book = useMemo(
    () => buildModernPaperBookWithPageRefs({ generations, t, recordBudget }),
    [generations, t, recordBudget],
  );
  const spreadItems = useMemo(
    () =>
      book.charts.flatMap((chart) =>
        chart.spreads.map((spread) => ({
          chart,
          spread,
        })),
      ),
    [book],
  );
  const autoSpineTitle = useMemo(() => getPaperSpineTitle(generations, t), [generations, t]);
  const spineTitle = spineTitleOverride?.trim() || autoSpineTitle;

  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-4 md:p-6"
      style={paperVars ?? PAPER_VARS}
      data-testid="paper-modern"
    >
      <PaperZoomViewport
        fontScale={fontScale}
        className="flex min-h-full min-w-min flex-col"
        style={{
          color: "var(--df-paper-ink)",
          fontFamily: "var(--df-paper-font-body)",
        }}
      >
        {spreadItems.length ? (
          <section
            className="border p-[var(--df-paper-leaf-margin)] shadow-sm"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-modern-chart"
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: PAPER_LINE.soft }}
            >
              <h2 className="tracking-normal" style={{ ...PAPER_TEXT.sectionTitle }}>
                {t("genealogyBook.styles.modern", "Modern Ledger")}
              </h2>
              <span style={{ ...PAPER_TEXT.sectionRule }}>
                {t(
                  "genealogyBook.modernTableRule",
                  "Five generations per chart, with facing ledger pages for relation, name, and biography.",
                )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {spreadItems.map(({ chart, spread }) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  ref={chart.index === 1 && spread.index === 1 ? spreadRef : undefined}
                  className="relative grid h-[872px] min-w-[1180px] shrink-0 overflow-hidden border"
                  style={{
                    borderColor: PAPER_LINE.strong,
                    borderWidth: "var(--df-paper-frame-outer)",
                    background: "var(--df-paper-sheet)",
                    paddingBlock: "var(--df-paper-frame-pad-tb)",
                    paddingInline: "var(--df-paper-frame-pad-lr)",
                    gridTemplateColumns: `1fr ${MODERN_SPINE_WIDTH}px 1fr`,
                  }}
                  data-testid={
                    chart.index === 1 && spread.index === 1
                      ? "paper-modern-page"
                      : `paper-modern-spread-${chart.index}-${spread.index}`
                  }
                  data-paper-spread=""
                >
                  <PaperFrameOverlay />
                  <ModernPage
                    rows={spread.leftRows}
                    side="left"
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    t={t}
                  />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    hallName={hallName}
                    t={t}
                    testIdPrefix="paper-modern-spine"
                    pageOrder="ltr"
                  />
                  <ModernPage
                    rows={spread.rightRows}
                    side="right"
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    t={t}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </PaperZoomViewport>
    </div>
  );
}
