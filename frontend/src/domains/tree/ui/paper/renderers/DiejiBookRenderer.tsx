import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  buildDiejiPaperBook,
  getDiejiFullRecordText,
  getDiejiGenerationMark,
  splitDiejiSpreadColumns,
  DIEJI_RECORD_UNITS_PER_LANE,
  type DiejiChartWindow,
  type DiejiPageSide,
  type DiejiPageSpread,
  type DiejiTableLane,
} from "../layout/diejiPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_LEAF_STYLE,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
} from "../paperStyles";
import { PaperZoomViewport } from "../PaperZoomViewport";
import { getPaperSpineTitle, measureRecordUnits } from "../paperText";
import { PaperFrameOverlay } from "./PaperFrameOverlay";
import { PaperSpine } from "./PaperSpine";

const DIEJI_RELATION_ROW_PX = 64;
const DIEJI_NAME_ROW_PX = 96;
const DIEJI_LANE_GRID_ROWS = `${DIEJI_RELATION_ROW_PX}px ${DIEJI_NAME_ROW_PX}px 1fr`;
const DIEJI_RELATION_COLUMN_UNIT_CAPACITY = 10;
// A long title/name (e.g. "西乡哀侯曹赞奉车都尉郎") in vertical-rl can overflow the fixed
// name-row height and wrap into a ragged second column, breaking the lane grid. Show the full
// name, but scale the font down so long names remain in one column.
const DIEJI_NAME_CELL_USABLE_PX = DIEJI_NAME_ROW_PX - 16 - 2; // − py-2 (16px) − glyph-advance safety
const DIEJI_NAME_MIN_FONT_PX = 8;

function getDiejiNameFontSize(nameLength: number): number {
  const fit = Math.floor(DIEJI_NAME_CELL_USABLE_PX / Math.max(1, nameLength));
  return Math.min(PAPER_TEXT.name.fontSize, Math.max(DIEJI_NAME_MIN_FONT_PX, fit));
}

function DiejiRelationLabel({ label }: { label: string }) {
  const columns = label.split("\n").filter(Boolean);
  const shouldWrapAsPhrase = columns.some(
    (column) => measureRecordUnits(column) > DIEJI_RELATION_COLUMN_UNIT_CAPACITY,
  );

  if (shouldWrapAsPhrase) {
    return (
      <span
        style={{
          display: "inline-block",
          height: "100%",
          lineHeight: 1,
          maxHeight: "100%",
          overflowWrap: "anywhere",
          textOrientation: "mixed",
          whiteSpace: "normal",
          wordBreak: "break-all",
          writingMode: "vertical-rl",
        }}
      >
        {columns.join("")}
      </span>
    );
  }

  return (
    <span
      style={{
        columnGap: 0,
        display: "inline-flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
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

// Each lane biography is a single vertical column (long records spill into continuation lanes,
// never a 2nd column), so plain `text-align: justify` — which never touches the last/only line —
// leaves the column ragged. Justify the last line too *only* when the column is substantially
// filled, so a near-full bio reaches the bottom edge while a short tail (e.g. "早卒，谥X。") is
// left to flow naturally instead of being stretched into sparse, oversized character gaps.
//
// This threshold is the single dial of an unavoidable trade-off: a fixed column height + uniform
// character pitch is only bottom-aligned when every column holds the same character count, which
// distinct-length bios never do. Lower it → more columns reach the bottom but pitch varies more;
// raise it → pitch stays uniform but more short columns end ragged. 0.82 caps the justified
// stretch at ~1/0.82 ≈ 1.22×, small enough that the spacing difference is barely perceptible.
const DIEJI_BODY_FILL_JUSTIFY_THRESHOLD = 0.82;
const DIEJI_EQUAL_LANE_STYLE: CSSProperties = {
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  width: 0,
};

function DiejiPersonLane({
  lane,
  t,
}: {
  lane: Extract<DiejiTableLane, { kind: "person" }>;
  t: TranslateFn;
}) {
  const { person } = lane;
  const fullRecord = getDiejiFullRecordText(person, t);
  const title = lane.name;
  const nameFontSize = getDiejiNameFontSize(Array.from(title).length);
  const bodyFillsColumn =
    measureRecordUnits(lane.text) >=
    DIEJI_RECORD_UNITS_PER_LANE * DIEJI_BODY_FILL_JUSTIFY_THRESHOLD;

  return (
    <article
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        direction: "ltr",
        ...DIEJI_EQUAL_LANE_STYLE,
        gridTemplateRows: DIEJI_LANE_GRID_ROWS,
      }}
      data-testid={`paper-row-${person.id}`}
      data-dieji-lane={lane.key}
      data-continued={lane.continued ? "true" : "false"}
      title={fullRecord}
    >
      <div
        className="flex items-center justify-center border-b px-1 py-1 leading-tight"
        style={{
          ...PAPER_TEXT.relation,
          borderColor: PAPER_LINE.soft,
        }}
        data-testid={`paper-dieji-relation-${person.id}`}
      >
        <DiejiRelationLabel label={lane.relationLabel} />
      </div>
      <div
        className="flex min-h-0 items-center justify-center border-b px-1.5 py-2"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        <strong
          className="leading-6 tracking-normal"
          style={{
            ...PAPER_TEXT.name,
            fontSize: nameFontSize,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            textAlign: "right",
          }}
          data-testid={`paper-dieji-name-${person.id}`}
        >
          {title}
        </strong>
      </div>
      <div
        className="relative flex min-h-0 justify-center px-1.5 py-2"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        <p
          className="m-0 h-full w-fit max-w-full"
          style={{
            ...PAPER_TEXT.body,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            // Justify along the inline (vertical) axis so characters spread evenly top-to-bottom.
            // A Dieji bio is a single column, so the bottom only reaches the edge when the last
            // line is justified too — gated on `bodyFillsColumn` to avoid stretching short tails.
            textAlign: "justify",
            textAlignLast: bodyFillsColumn ? "justify" : "auto",
            textJustify: "inter-character",
            overflowWrap: "anywhere",
            wordBreak: "break-all",
          }}
          data-testid={`paper-dieji-detail-${person.id}`}
        >
          {lane.text}
        </p>
      </div>
    </article>
  );
}

function DiejiGenerationLane({
  lane,
  t,
}: {
  lane: Extract<DiejiTableLane, { kind: "generation" }>;
  t: TranslateFn;
}) {
  return (
    <div
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        ...DIEJI_EQUAL_LANE_STYLE,
        gridTemplateRows: DIEJI_LANE_GRID_ROWS,
      }}
      data-testid={`paper-dieji-generation-${lane.depth}`}
      data-dieji-lane={lane.key}
      aria-label={lane.label}
    >
      <div aria-hidden="true" />
      <span
        className="flex h-full w-full items-center justify-center px-1.5 py-2 shadow-xs"
        style={{
          ...PAPER_TEXT.generationMark,
          backgroundColor: PAPER_MARK_BG,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid={`paper-dieji-generation-mark-${lane.depth}`}
      >
        {getDiejiGenerationMark(lane.depth, t)}
      </span>
      {lane.repeated || lane.continued ? (
        <span
          className="flex items-center justify-center"
          style={{
            ...PAPER_TEXT.tag,
            writingMode: "vertical-rl",
          }}
        >
          {lane.repeated
            ? t("genealogyBook.repeatedGeneration", "repeated")
            : t("genealogyBook.diejiContinuedGeneration", "continued")}
        </span>
      ) : null}
    </div>
  );
}

function DiejiBlankLane({ lane }: { lane: Extract<DiejiTableLane, { kind: "blank" }> }) {
  return (
    <div
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        ...DIEJI_EQUAL_LANE_STYLE,
        gridTemplateRows: DIEJI_LANE_GRID_ROWS,
      }}
      data-testid={`paper-dieji-blank-${lane.key}`}
      data-dieji-lane={lane.key}
      aria-hidden="true"
    >
      <div className="border-b" style={{ borderColor: PAPER_LINE.soft }} />
      <div className="border-b" style={{ borderColor: PAPER_LINE.soft }} />
      <div />
    </div>
  );
}

function DiejiTableLaneView({ lane, t }: { lane: DiejiTableLane; t: TranslateFn }) {
  if (lane.kind === "generation") return <DiejiGenerationLane lane={lane} t={t} />;
  if (lane.kind === "person") return <DiejiPersonLane lane={lane} t={t} />;
  return <DiejiBlankLane lane={lane} />;
}

function DiejiPage({
  side,
  chart,
  spread,
  t,
}: {
  side: DiejiPageSide;
  chart: DiejiChartWindow;
  spread: DiejiPageSpread;
  t: TranslateFn;
}) {
  const lanes = splitDiejiSpreadColumns(spread, side);

  return (
    <div
      className="h-[872px]"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-dieji-${side}-${chart.index}-${spread.index}`}
    >
      <div
        className="flex h-full flex-row-reverse justify-start overflow-hidden"
        style={{ borderColor: PAPER_LINE.strong }}
      >
        {lanes.map((lane, index) => (
          <DiejiTableLaneView
            key={`${side}-${chart.index}-${spread.index}-${lane.key}-${index}`}
            lane={lane}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

export function DiejiBookRenderer({
  generations,
  t,
  spineTitleOverride,
  paperVars,
  hallName,
  fontScale,
  coverSlot,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
  spineTitleOverride?: string;
  paperVars?: CSSProperties;
  hallName?: string;
  fontScale?: number;
  coverSlot?: (volumeCount: number) => ReactNode;
}) {
  const book = useMemo(() => buildDiejiPaperBook({ generations, t }), [generations, t]);
  const autoSpineTitle = useMemo(() => getPaperSpineTitle(generations, t), [generations, t]);
  const spineTitle = spineTitleOverride?.trim() || autoSpineTitle;
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

  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-4 md:p-6"
      style={paperVars ?? PAPER_VARS}
      data-testid="paper-dieji"
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
            className="border p-(--df-paper-leaf-margin) shadow-xs"
            style={{
              ...PAPER_LEAF_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-dieji-table-1"
          >
            <div className="flex flex-col gap-5">
              {coverSlot?.(book.charts.length)}
              {spreadItems.map(({ chart, spread }) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="relative grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
                  style={{
                    borderColor: PAPER_LINE.strong,
                    borderWidth: "var(--df-paper-frame-outer)",
                    background: "var(--df-paper-sheet)",
                    paddingBlock: "var(--df-paper-frame-pad-tb)",
                    paddingInline: "var(--df-paper-frame-pad-lr)",
                  }}
                  data-testid={`paper-dieji-spread-${chart.index}-${spread.index}`}
                  data-paper-spread=""
                >
                  <PaperFrameOverlay />
                  <DiejiPage side="left" chart={chart} spread={spread} t={t} />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    hallName={hallName}
                    t={t}
                    testIdPrefix="paper-dieji-spine"
                    pageOrder="rtl"
                  />
                  <DiejiPage side="right" chart={chart} spread={spread} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </PaperZoomViewport>
    </div>
  );
}
