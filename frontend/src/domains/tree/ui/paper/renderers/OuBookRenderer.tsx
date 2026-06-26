import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildOuPaperBook,
  getOuRecordText,
  getOuGenerationMark,
  OU_NAME_LANE_WIDTH,
  OU_PAGE_EDGE_PADDING,
  OU_PERSON_MIN_WIDTH,
  OU_RECORD_DETAIL_END_PADDING,
  splitOuRowEntries,
  type OuChartWindow,
  type OuGenerationRow,
  type OuPageBodyWidths,
  type OuPageSide,
  type OuPageSpread,
  type OuPersonRecordEntry,
} from "../layout/ouPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_RECORD_INLINE_PADDING,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
} from "../paperStyles";
import { clipText, getPaperSpineTitle } from "../paperText";
import { PaperSpine } from "./PaperSpine";

const OU_GENERATION_MARK_WIDTH = 54;
const OU_SPINE_WIDTH = 72;
const OU_MIN_SPREAD_WIDTH = 1180;

function getMeasuredOuPageBodyWidths(spreadWidth: number): OuPageBodyWidths {
  const pageWidth = Math.max(0, (spreadWidth - OU_SPINE_WIDTH) / 2);
  return {
    right: Math.max(OU_PERSON_MIN_WIDTH, pageWidth - OU_GENERATION_MARK_WIDTH),
    left: Math.max(OU_PERSON_MIN_WIDTH, pageWidth - OU_PAGE_EDGE_PADDING),
  };
}

function OuRelationLabel({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  const columns = label.split("\n").filter(Boolean);

  return (
    <span
      className="leading-tight"
      style={{
        ...PAPER_TEXT.relation,
        columnGap: 0,
        display: "inline-flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
      data-testid={testId}
    >
      {columns.map((column, index) => (
        <span
          key={`${column}-${index}`}
          style={{
            lineHeight: 1,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
        >
          {column}
        </span>
      ))}
    </span>
  );
}

function OuPersonEntry({ entry, t }: { entry: OuPersonRecordEntry; t: TranslateFn }) {
  const { person } = entry;
  const fullRecord = getOuRecordText(person, t);
  const isFemale = person.ui.gender === 2 && !entry.continued;
  const continuesAfter = entry.partIndex < entry.totalPartCount;
  const title = entry.continued ? "" : clipText(person.ui.titleText || person.ui.shortHashText, 10);
  const nameLaneClassName = entry.continued
    ? "flex w-0 shrink-0 overflow-hidden p-0"
    : "flex shrink-0 flex-col items-center gap-1 px-0.5";

  return (
    <article
      className="relative flex h-full shrink-0 flex-row-reverse py-3"
      style={{
        borderColor: PAPER_LINE.soft,
        direction: "ltr",
        flex: `0 0 ${entry.widthPx}px`,
        minWidth: entry.widthPx,
        paddingInline: PAPER_RECORD_INLINE_PADDING,
        width: entry.widthPx,
      }}
      data-testid={`paper-row-${person.id}`}
      data-slot-span={entry.slotSpan}
      data-continued={entry.continued ? "true" : "false"}
      data-continues-after={continuesAfter ? "true" : "false"}
      data-part-index={entry.partIndex}
      title={fullRecord}
    >
      <div
        className={nameLaneClassName}
        style={{
          borderColor: PAPER_LINE.soft,
          width: entry.continued ? undefined : OU_NAME_LANE_WIDTH,
        }}
      >
        {entry.relationLabel ? (
          <OuRelationLabel
            label={entry.relationLabel}
            testId={`paper-ou-relation-${person.id}`}
          />
        ) : null}
        <strong
          className="leading-6 tracking-normal"
          style={{
            ...PAPER_TEXT.name,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            textAlign: "right",
          }}
          data-testid={`paper-ou-name-${person.id}`}
        >
          {title}
          {isFemale ? (
            <span
              style={{ ...PAPER_TEXT.femaleMark }}
              data-testid={`paper-ou-female-${person.id}`}
            >
              {"　"}
              {t("genealogyBook.ouFemaleMark", "女")}
            </span>
          ) : null}
        </strong>
      </div>
      <p
        className="m-0 h-full flex-1"
        style={{
          ...PAPER_TEXT.body,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          // Justify along the inline (vertical) axis so every filled column stretches
          // top-to-bottom. If this entry continues across the spine, its last visible
          // column is not the true record tail and should be filled like Su records.
          textAlign: "justify",
          textAlignLast: continuesAfter ? "justify" : "auto",
          textJustify: "inter-character",
          overflowWrap: "anywhere",
          paddingRight: OU_RECORD_DETAIL_END_PADDING,
          wordBreak: "break-all",
        }}
        data-testid={`paper-ou-detail-${person.id}`}
      >
        {entry.text}
      </p>
    </article>
  );
}

function mergeOuSideEntries(entries: OuPersonRecordEntry[]): OuPersonRecordEntry[] {
  const merged: OuPersonRecordEntry[] = [];

  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.person.id !== entry.person.id) {
      merged.push({ ...entry });
      continue;
    }

    previous.key = `${previous.key}+${entry.key}`;
    previous.text += entry.text;
    previous.widthPx += entry.widthPx;
    previous.slotSpan = Math.max(previous.slotSpan, entry.slotSpan);
    previous.partIndex = entry.partIndex;
    previous.totalPartCount = entry.totalPartCount;
  }

  return merged;
}

function OuGenerationBand({
  row,
  side,
  chartIndex,
  spreadIndex,
  t,
}: {
  row: OuGenerationRow;
  side: OuPageSide;
  chartIndex: number;
  spreadIndex: number;
  t: TranslateFn;
}) {
  const entries = mergeOuSideEntries(splitOuRowEntries(row, side));
  const entryLaneStyle =
    side === "left"
      ? { direction: "ltr" as const, paddingLeft: OU_PAGE_EDGE_PADDING }
      : { direction: "ltr" as const };

  return (
    <div
      className={
        side === "right"
          ? "grid h-full grid-cols-[1fr_54px] border-b last:border-b-0"
          : "h-full border-b last:border-b-0"
      }
      style={{ borderColor: PAPER_LINE.soft }}
      data-testid={
        side === "right" ? `paper-ou-generation-${row.depth}` : `paper-ou-left-generation-${row.depth}`
      }
      data-ou-row={`paper-ou-row-${chartIndex}-${spreadIndex}-${side}-${row.depth}`}
      aria-label={row.label}
    >
      <div
        className="flex h-full flex-row-reverse justify-start overflow-hidden"
        style={entryLaneStyle}
        data-testid={`paper-ou-entry-lane-${chartIndex}-${spreadIndex}-${side}-${row.depth}`}
      >
        {entries.map((entry) => (
          <OuPersonEntry
            key={`${side}-${chartIndex}-${spreadIndex}-${entry.key}`}
            entry={entry}
            t={t}
          />
        ))}
      </div>
      {side === "right" ? (
        <div
          className="flex h-full flex-col items-center justify-center border-l px-2"
          style={{
            borderColor: PAPER_LINE.soft,
            background: PAPER_LINE.tint,
          }}
        >
          <span
            className="flex min-h-16 w-8 items-center justify-center px-1.5 py-2 shadow-sm"
            style={{
              ...PAPER_TEXT.generationMark,
              backgroundColor: PAPER_MARK_BG,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
            data-testid={`paper-ou-generation-mark-${row.depth}`}
          >
            {getOuGenerationMark(row.depth, t)}
          </span>
          {row.repeated ? (
            <span
              className="mt-2"
              style={{
                ...PAPER_TEXT.tag,
                writingMode: "vertical-rl",
              }}
            >
              {t("genealogyBook.repeatedGeneration", "repeated")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OuPage({
  side,
  chart,
  spread,
  t,
}: {
  side: OuPageSide;
  chart: OuChartWindow;
  spread: OuPageSpread;
  t: TranslateFn;
}) {
  return (
    <div
      className="h-[872px]"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-ou-${side}-${chart.index}-${spread.index}`}
    >
      <div className="grid h-full grid-rows-5">
        {spread.rows.map((row) => (
          <OuGenerationBand
            key={`${side}-${chart.index}-${spread.index}-${row.depth}`}
            row={row}
            side={side}
            chartIndex={chart.index}
            spreadIndex={spread.index}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

export function OuBookRenderer({
  generations,
  t,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  const spreadsRef = useRef<HTMLDivElement | null>(null);
  const [spreadWidth, setSpreadWidth] = useState<number | null>(null);
  const pageBodyWidths = useMemo(
    () => (spreadWidth ? getMeasuredOuPageBodyWidths(spreadWidth) : undefined),
    [spreadWidth],
  );
  const book = useMemo(
    () => buildOuPaperBook({ generations, t, pageBodyWidths }),
    [generations, pageBodyWidths, t],
  );
  const spineTitle = useMemo(
    () => getPaperSpineTitle(generations, t),
    [generations, t],
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

  useEffect(() => {
    const element = spreadsRef.current;
    if (!element || typeof window === "undefined") return undefined;

    let frame = 0;
    const updateSpreadWidth = () => {
      const nextWidth = Math.max(OU_MIN_SPREAD_WIDTH, element.getBoundingClientRect().width);
      setSpreadWidth((currentWidth) =>
        currentWidth !== null && Math.abs(currentWidth - nextWidth) < 1
          ? currentWidth
          : nextWidth,
      );
    };

    updateSpreadWidth();
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateSpreadWidth);
    };
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleUpdate) : null;

    resizeObserver?.observe(element);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-ou">
      <div
        className="mx-auto flex min-h-full w-full min-w-min max-w-[1320px] flex-col"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
      >
        {spreadItems.length ? (
          <section
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-ou-table-1"
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: PAPER_LINE.soft }}
            >
              <h2 className="tracking-normal" style={{ ...PAPER_TEXT.sectionTitle }}>
                {t("genealogyBook.styles.ou", "Ou-style")}
              </h2>
              <span style={{ ...PAPER_TEXT.sectionRule }}>
                {t("genealogyBook.ouTableRule", "Five generations per table.")}
              </span>
            </div>

            <div ref={spreadsRef} className="flex flex-col gap-5">
              {spreadItems.map(({ chart, spread }) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
                  style={{
                    borderColor: PAPER_LINE.strong,
                    background: "var(--df-paper-sheet)",
                  }}
                  data-paper-spread=""
                  data-testid={`paper-ou-spread-${chart.index}-${spread.index}`}
                >
                  <OuPage side="left" chart={chart} spread={spread} t={t} />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    t={t}
                    testIdPrefix="paper-ou-spine"
                    pageOrder="rtl"
                  />
                  <OuPage side="right" chart={chart} spread={spread} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
