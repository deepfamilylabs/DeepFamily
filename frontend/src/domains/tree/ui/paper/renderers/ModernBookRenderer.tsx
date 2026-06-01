import { useMemo, type CSSProperties } from "react";
import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import { clipText, getPaperSpineTitle } from "../paperText";
import { OuSpine } from "./OuBookRenderer";

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
      continued: boolean;
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
const MODERN_CHART_STEP = 4;
const MODERN_PAGE_ROW_CAPACITY = 15;
const MODERN_SPREAD_ROW_CAPACITY = MODERN_PAGE_ROW_CAPACITY * 2;
const MODERN_RECORD_CHARS_PER_ROW = 42;
const MODERN_SPINE_WIDTH = 72;
const MODERN_MIN_SPREAD_WIDTH = 1180;
const MODERN_TABLE_COLUMNS = "64px 112px minmax(0, 1fr)";
const MODERN_TABLE_COLUMN_STYLE: CSSProperties = {
  gridTemplateColumns: MODERN_TABLE_COLUMNS,
};

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

function splitTextByLength(text: string, maxLength: number): string[] {
  const chars = Array.from(text.trim());
  if (chars.length <= maxLength) return [text];

  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += maxLength) {
    chunks.push(chars.slice(start, start + maxLength).join("").trim());
  }

  return chunks.filter(Boolean);
}

function formatModernRecordLine(line: string): string {
  return line.replace(/^([\p{Script=Han}]{1,4}):\s*/u, "$1");
}

function getModernGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.suGenerationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

function getModernFullRecordText(person: PaperPerson, t: TranslateFn): string {
  const baseLines = person.classicalLines.length ? person.classicalLines : person.detailLines;
  const descendantsLabel = t("genealogyBook.fields.descendants", "Children");
  const descendantsLine =
    person.childCount > 0
      ? person.detailLines.find((line) =>
          line.toLocaleLowerCase().includes(descendantsLabel.toLocaleLowerCase()),
        ) || `${descendantsLabel}: ${person.childCount}`
      : undefined;
  const lines = compactUnique([...baseLines, descendantsLine]);

  return lines.map(formatModernRecordLine).join("，") || person.ui.shortHashText;
}

function getChildRankLabel(person: PaperPerson, t: TranslateFn): string {
  if (person.relation?.kind !== "child") return "";

  const childNumber = person.relation.siblingIndex + 1;
  const gender = person.nodeData?.gender ?? person.ui.gender;
  if (gender === 1) {
    if (childNumber === 1) return t("genealogyBook.suFirstSon", "first son");
    if (childNumber === 2) return t("genealogyBook.suSecondSon", "second son");
    return t("genealogyBook.suNthSon", "{{number}} son", {
      han: toChineseNumeral(childNumber),
      number: childNumber,
    });
  }
  if (gender === 2) {
    if (childNumber === 1) return t("genealogyBook.suFirstDaughter", "first daughter");
    if (childNumber === 2) return t("genealogyBook.suSecondDaughter", "second daughter");
    return t("genealogyBook.suNthDaughter", "{{number}} daughter", {
      han: toChineseNumeral(childNumber),
      number: childNumber,
    });
  }

  if (childNumber === 1) return t("genealogyBook.modernFirstChild", "first child");
  if (childNumber === 2) return t("genealogyBook.modernSecondChild", "second child");
  return t("genealogyBook.modernNthChild", "{{number}} child", {
    han: toChineseNumeral(childNumber),
    number: childNumber,
  });
}

function getModernRelationLabel(
  person: PaperPerson,
  peopleById: Map<string, PaperPerson>,
  t: TranslateFn,
): string {
  if (person.relation?.kind === "root") return t("genealogyBook.suRootLabel", "ancestor");
  if (person.relation?.kind !== "child") return "";

  const parent = peopleById.get(person.relation.parentId);
  const parentName = clipText(parent?.ui.fullName || parent?.ui.titleText, 4);
  const rank = getChildRankLabel(person, t);
  return parentName ? `${parentName}\n${rank}` : rank;
}

function getModernPersonName(person: PaperPerson): string {
  return clipText(person.ui.fullName || person.ui.titleText || person.ui.shortHashText, 12);
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
  peopleById: Map<string, PaperPerson>;
  t: TranslateFn;
}): ModernTableRow[] {
  const { person, peopleById, t } = params;
  const fullRecord = getModernFullRecordText(person, t);
  const chunks = splitTextByLength(fullRecord, MODERN_RECORD_CHARS_PER_ROW);
  const relationLabel = getModernRelationLabel(person, peopleById, t);
  const name = getModernPersonName(person);

  return chunks.map((text, index) => ({
    kind: "person",
    key: `person:${person.id}:${index}`,
    person,
    relationLabel: index === 0 ? relationLabel : "",
    name: index === 0 ? name : "",
    fullRecord,
    text,
    continued: index > 0,
    partIndex: index + 1,
  }));
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
}): ModernPaperBook {
  const { generations, t } = params;
  if (!generations.length) return { charts: [] };

  const generationsByDepth = new Map(
    generations.map((generation) => [generation.depth, generation]),
  );
  const peopleById = new Map(
    generations.flatMap((generation) => generation.people.map((person) => [person.id, person])),
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
    const repeatedDepth = chartIndex > 1 ? startDepth : undefined;
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
        rows.push(...makePersonRows({ person, peopleById, t }));
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

function ModernTableHeader({ t }: { t: TranslateFn }) {
  return (
    <div
      className="grid border-b text-center text-[18px] font-black leading-none tracking-normal"
      style={{
        ...MODERN_TABLE_COLUMN_STYLE,
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
        fontFamily: PAPER_TITLE_FONT_STACK,
      }}
    >
      <div
        className="flex min-w-0 items-center justify-center border-r px-1"
        style={{ borderColor: "var(--df-paper-line)" }}
      >
        {t("genealogyBook.modernHeaderRelation", "Relation")}
      </div>
      <div
        className="flex min-w-0 items-center justify-center border-r px-1"
        style={{ borderColor: "var(--df-paper-line)" }}
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
      className="relative flex min-h-0 items-center justify-center border-b px-3 text-[24px] font-black leading-none tracking-normal"
      style={{
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
        fontFamily: PAPER_TITLE_FONT_STACK,
      }}
      data-testid={`paper-modern-generation-${row.depth}`}
      aria-label={row.label}
    >
      <span data-testid={`paper-modern-generation-mark-${row.depth}`}>
        {getModernGenerationMark(row.depth, t)}
      </span>
      {row.repeated ? (
        <span
          className="absolute right-3 text-[11px] font-bold"
          style={{ color: "var(--df-paper-red)", fontFamily: PAPER_NOTE_FONT_STACK }}
        >
          {t("genealogyBook.repeatedGeneration", "repeated")}
        </span>
      ) : null}
    </div>
  );
}

function ModernPersonRowView({
  row,
  t,
}: {
  row: Extract<ModernTableRow, { kind: "person" }>;
  t: TranslateFn;
}) {
  const firstPartTestId =
    row.partIndex === 1
      ? `paper-modern-row-${row.person.id}`
      : `paper-modern-row-${row.person.id}-${row.partIndex}`;
  const continuedMark = row.continued ? t("genealogyBook.ouRecordContinuedMark", "cont.") : "";

  return (
    <div
      className="grid min-h-0 border-b"
      style={{
        ...MODERN_TABLE_COLUMN_STYLE,
        borderColor: "var(--df-paper-line)",
      }}
      data-testid={firstPartTestId}
      data-continued={row.continued ? "true" : "false"}
      data-part-index={row.partIndex}
      title={row.fullRecord}
    >
      <div
        className="flex h-full min-h-0 min-w-0 items-center justify-center whitespace-pre-line border-r px-1 text-center text-[14px] font-bold leading-5"
        style={{
          borderColor: "var(--df-paper-line)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_NOTE_FONT_STACK,
        }}
        data-testid={row.partIndex === 1 ? `paper-modern-relation-${row.person.id}` : undefined}
      >
        {row.relationLabel}
      </div>
      <div
        className="flex h-full min-h-0 min-w-0 items-center justify-center border-r px-2 text-center"
        style={{ borderColor: "var(--df-paper-line)" }}
      >
        {row.name ? (
          <strong
            className="block max-w-full text-[19px] font-black leading-tight tracking-normal"
            style={{
              color: "var(--df-paper-ink)",
              fontFamily: PAPER_TITLE_FONT_STACK,
              overflowWrap: "anywhere",
            }}
            data-testid={row.partIndex === 1 ? `paper-modern-name-${row.person.id}` : undefined}
          >
            {row.name}
          </strong>
        ) : continuedMark ? (
          <span
            className="text-[12px] font-bold tracking-normal"
            style={{ color: "var(--df-paper-red)", fontFamily: PAPER_NOTE_FONT_STACK }}
            data-testid={`paper-modern-continued-${row.person.id}-${row.partIndex}`}
          >
            {continuedMark}
          </span>
        ) : null}
      </div>
      <p
        className="m-0 flex h-full min-h-0 min-w-0 items-start overflow-hidden px-3 py-1 text-[14px] leading-[1.35]"
        style={{
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_NOTE_FONT_STACK,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
        data-testid={`paper-modern-detail-${row.person.id}`}
      >
        {row.text}
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
        borderColor: "var(--df-paper-line)",
      }}
      data-testid={`paper-modern-blank-${row.key}`}
      aria-hidden="true"
    >
      <div className="border-r" style={{ borderColor: "var(--df-paper-line)" }} />
      <div className="border-r" style={{ borderColor: "var(--df-paper-line)" }} />
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
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  const book = useMemo(() => buildModernPaperBook({ generations, t }), [generations, t]);
  const spineTitle = useMemo(() => getPaperSpineTitle(generations, t), [generations, t]);

  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-modern">
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col gap-7"
        style={{
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        {book.charts.map((chart) => (
          <section
            key={chart.index}
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: "var(--df-paper-line)",
            }}
            data-testid={
              chart.index === 1 ? "paper-modern-chart" : `paper-modern-chart-${chart.index}`
            }
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <h2
                className="text-xl font-bold tracking-normal"
                style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
              >
                {t("genealogyBook.styles.modern", "Modern Ledger")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {chart.repeatedDepth !== undefined
                  ? t(
                      "genealogyBook.modernOverlapNote",
                      "This chart repeats the previous chart's fifth generation.",
                    )
                  : t(
                      "genealogyBook.modernTableRule",
                      "Five generations per chart, with facing ledger pages for relation, name, and biography.",
                    )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {chart.spreads.map((spread) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="grid h-[872px] min-w-[1180px] shrink-0 overflow-hidden border"
                  style={{
                    borderColor: "var(--df-paper-line)",
                    background: "var(--df-paper-sheet)",
                    gridTemplateColumns: `minmax(0, 1fr) ${MODERN_SPINE_WIDTH}px minmax(0, 1fr)`,
                    minWidth: MODERN_MIN_SPREAD_WIDTH,
                  }}
                  data-testid={
                    chart.index === 1 && spread.index === 1
                      ? "paper-modern-page"
                      : `paper-modern-spread-${chart.index}-${spread.index}`
                  }
                >
                  <ModernPage
                    rows={spread.leftRows}
                    side="left"
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    t={t}
                  />
                  <OuSpine
                    chartIndex={chart.index}
                    spread={{ index: spread.index, kind: spread.kind, rows: [] }}
                    title={spineTitle}
                    t={t}
                    testIdPrefix="paper-modern-spine"
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
        ))}
      </div>
    </div>
  );
}
