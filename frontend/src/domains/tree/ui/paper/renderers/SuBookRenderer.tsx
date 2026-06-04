import { useMemo, type CSSProperties } from "react";
import {
  buildSuPaperBook,
  getSuFullRecordText,
  getSuGenerationMark,
  splitSuSpreadColumns,
  type SuChartWindow,
  type SuPageSide,
  type SuPageSpread,
  type SuTableLane,
} from "../layout/suPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
} from "../paperStyles";
import { clipText, getPaperSpineTitle } from "../paperText";
import { PaperSpine } from "./PaperSpine";

const SU_LANE_GRID_ROWS = "64px 96px 1fr";
const SU_EQUAL_LANE_STYLE: CSSProperties = {
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  width: 0,
};

function SuPersonLane({
  lane,
  t,
}: {
  lane: Extract<SuTableLane, { kind: "person" }>;
  t: TranslateFn;
}) {
  const { person } = lane;
  const fullRecord = getSuFullRecordText(person, t);
  const title = clipText(lane.name, lane.continued ? 8 : 10);

  return (
    <article
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        direction: "ltr",
        ...SU_EQUAL_LANE_STYLE,
        gridTemplateRows: SU_LANE_GRID_ROWS,
      }}
      data-testid={`paper-row-${person.id}`}
      data-su-lane={lane.key}
      data-continued={lane.continued ? "true" : "false"}
      title={fullRecord}
    >
      <div
        className="flex items-center justify-center border-b px-1 py-1 leading-tight"
        style={{
          ...PAPER_TEXT.relation,
          borderColor: PAPER_LINE.soft,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          // Father name and rank word arrive "\n"-joined; pre-line turns the break into a natural
          // adjacent column (parent right, rank left) at normal line spacing rather than a wide gap.
          whiteSpace: "pre-line",
        }}
        data-testid={`paper-su-relation-${person.id}`}
      >
        {lane.relationLabel}
      </div>
      <div
        className="flex min-h-0 items-center justify-center border-b px-1.5 py-2"
        style={{ borderColor: PAPER_LINE.soft }}
      >
        <strong
          className="leading-6 tracking-normal"
          style={{
            ...PAPER_TEXT.name,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            textAlign: "right",
          }}
          data-testid={`paper-su-name-${person.id}`}
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
            overflowWrap: "anywhere",
            wordBreak: "break-all",
          }}
          data-testid={`paper-su-detail-${person.id}`}
        >
          {lane.text}
        </p>
      </div>
    </article>
  );
}

function SuGenerationLane({
  lane,
  t,
}: {
  lane: Extract<SuTableLane, { kind: "generation" }>;
  t: TranslateFn;
}) {
  return (
    <div
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        ...SU_EQUAL_LANE_STYLE,
        gridTemplateRows: SU_LANE_GRID_ROWS,
      }}
      data-testid={`paper-su-generation-${lane.depth}`}
      data-su-lane={lane.key}
      aria-label={lane.label}
    >
      <div aria-hidden="true" />
      <span
        className="flex h-full w-full items-center justify-center px-1.5 py-2 shadow-sm"
        style={{
          ...PAPER_TEXT.generationMark,
          backgroundColor: PAPER_MARK_BG,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid={`paper-su-generation-mark-${lane.depth}`}
      >
        {getSuGenerationMark(lane.depth, t)}
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
            : t("genealogyBook.suContinuedGeneration", "continued")}
        </span>
      ) : null}
    </div>
  );
}

function SuBlankLane({ lane }: { lane: Extract<SuTableLane, { kind: "blank" }> }) {
  return (
    <div
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: PAPER_LINE.soft,
        ...SU_EQUAL_LANE_STYLE,
        gridTemplateRows: SU_LANE_GRID_ROWS,
      }}
      data-testid={`paper-su-blank-${lane.key}`}
      data-su-lane={lane.key}
      aria-hidden="true"
    >
      <div className="border-b" style={{ borderColor: PAPER_LINE.soft }} />
      <div className="border-b" style={{ borderColor: PAPER_LINE.soft }} />
      <div />
    </div>
  );
}

function SuTableLaneView({
  lane,
  t,
}: {
  lane: SuTableLane;
  t: TranslateFn;
}) {
  if (lane.kind === "generation") return <SuGenerationLane lane={lane} t={t} />;
  if (lane.kind === "person") return <SuPersonLane lane={lane} t={t} />;
  return <SuBlankLane lane={lane} />;
}

function SuPage({
  side,
  chart,
  spread,
  t,
}: {
  side: SuPageSide;
  chart: SuChartWindow;
  spread: SuPageSpread;
  t: TranslateFn;
}) {
  const lanes = splitSuSpreadColumns(spread, side);

  return (
    <div
      className="h-[872px]"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-su-${side}-${chart.index}-${spread.index}`}
    >
      <div
        className="flex h-full flex-row-reverse justify-start overflow-hidden"
        style={{ borderColor: PAPER_LINE.strong }}
      >
        {lanes.map((lane, index) => (
          <SuTableLaneView
            key={`${side}-${chart.index}-${spread.index}-${lane.key}-${index}`}
            lane={lane}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

export function SuBookRenderer({
  generations,
  t,
}: {
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  const book = useMemo(
    () => buildSuPaperBook({ generations, t }),
    [generations, t],
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

  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-su">
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
      >
        {spreadItems.length ? (
          <section
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-su-table-1"
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: PAPER_LINE.soft }}
            >
              <h2 className="tracking-normal" style={{ ...PAPER_TEXT.sectionTitle }}>
                {t("genealogyBook.styles.su", "Su-style")}
              </h2>
              <span style={{ ...PAPER_TEXT.sectionRule }}>
                {t(
                  "genealogyBook.suTableRule",
                  "Five vertical generations per chart, right-to-left.",
                )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {spreadItems.map(({ chart, spread }) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
                  style={{
                    borderColor: PAPER_LINE.strong,
                    background: "var(--df-paper-sheet)",
                  }}
                  data-testid={`paper-su-spread-${chart.index}-${spread.index}`}
                >
                  <SuPage side="left" chart={chart} spread={spread} t={t} />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    t={t}
                    testIdPrefix="paper-su-spine"
                    pageOrder="rtl"
                  />
                  <SuPage side="right" chart={chart} spread={spread} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
