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
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import { clipText, getPaperSpineTitle } from "../paperText";

const SU_LANE_GRID_ROWS = "64px 96px 1fr";
const SU_EQUAL_LANE_STYLE: CSSProperties = {
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  width: 0,
};

function SuPersonLane({ lane }: { lane: Extract<SuTableLane, { kind: "person" }> }) {
  const { person } = lane;
  const fullRecord = getSuFullRecordText(person);
  const title = clipText(lane.name, lane.continued ? 8 : 10);

  return (
    <article
      className="grid h-full border-l last:border-l-0"
      style={{
        borderColor: "var(--df-paper-line-soft)",
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
        className="flex items-center justify-center border-b px-1 py-1 text-[11px] font-bold"
        style={{
          borderColor: "var(--df-paper-line-soft)",
          color: "var(--df-paper-muted)",
          fontFamily: PAPER_NOTE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid={`paper-su-relation-${person.id}`}
      >
        {lane.relationLabel}
      </div>
      <div
        className="flex min-h-0 items-center justify-center border-b px-1.5 py-2"
        style={{ borderColor: "var(--df-paper-line-soft)" }}
      >
        <strong
          className="text-[19px] font-bold leading-6 tracking-normal"
          style={{
            color: "var(--df-paper-ink)",
            fontFamily: PAPER_TITLE_FONT_STACK,
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
        style={{ borderColor: "var(--df-paper-line-soft)" }}
      >
        <p
          className="m-0 h-full w-fit max-w-full text-[13px] leading-[1.55]"
          style={{
            color: "var(--df-paper-muted)",
            fontFamily: PAPER_NOTE_FONT_STACK,
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
        borderColor: "var(--df-paper-line)",
        ...SU_EQUAL_LANE_STYLE,
        gridTemplateRows: SU_LANE_GRID_ROWS,
      }}
      data-testid={`paper-su-generation-${lane.depth}`}
      data-su-lane={lane.key}
      aria-label={lane.label}
    >
      <div aria-hidden="true" />
      <span
        className="flex h-full w-full items-center justify-center bg-[#1f1a14] px-1.5 py-2 text-[15px] font-bold text-[#f7efd8] shadow-sm"
        style={{
          fontFamily: PAPER_TITLE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
        data-testid={`paper-su-generation-mark-${lane.depth}`}
      >
        {getSuGenerationMark(lane.depth, t)}
      </span>
      {lane.repeated || lane.continued ? (
        <span
          className="flex items-center justify-center text-[11px] font-bold"
          style={{
            color: "var(--df-paper-red)",
            fontFamily: PAPER_NOTE_FONT_STACK,
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
        borderColor: "var(--df-paper-line-soft)",
        ...SU_EQUAL_LANE_STYLE,
        gridTemplateRows: SU_LANE_GRID_ROWS,
      }}
      data-testid={`paper-su-blank-${lane.key}`}
      data-su-lane={lane.key}
      aria-hidden="true"
    >
      <div className="border-b" style={{ borderColor: "var(--df-paper-line-soft)" }} />
      <div className="border-b" style={{ borderColor: "var(--df-paper-line-soft)" }} />
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
  if (lane.kind === "person") return <SuPersonLane lane={lane} />;
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
        style={{ borderColor: "var(--df-paper-line)" }}
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

function SuSpine({
  chartIndex,
  spread,
  title,
  t,
}: {
  chartIndex: number;
  spread: SuPageSpread;
  title: string;
  t: TranslateFn;
}) {
  const spreadLabel =
    spread.kind === "main"
      ? t("genealogyBook.suMainSpread", "Main chart")
      : t("genealogyBook.suContinuationPage", "Continuation {{number}}", {
          number: spread.index,
        });

  return (
    <aside
      className="relative flex h-[872px] flex-col items-center border-x bg-[#f3e8cc] px-1 py-3"
      style={{
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
      }}
      data-testid={`paper-su-spine-${chartIndex}-${spread.index}`}
    >
      <div
        className="text-[31px] font-black leading-none tracking-normal"
        style={{
          fontFamily: PAPER_TITLE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {title}
      </div>
      <div className="my-3 h-10 w-10 bg-[#1f1a14]" aria-hidden="true" />
      <div
        className="grid grid-cols-2 gap-1 border-y py-2 text-[12px] font-bold"
        style={{
          borderColor: "var(--df-paper-line-soft)",
          fontFamily: PAPER_NOTE_FONT_STACK,
        }}
      >
        <span style={{ writingMode: "vertical-rl" }}>
          {t("genealogyBook.volumeLabel", "Volume {{number}}", { number: chartIndex })}
        </span>
        <span style={{ writingMode: "vertical-rl" }}>
          {spreadLabel}
        </span>
      </div>
      <div
        className="mt-auto text-[30px] font-black leading-none tracking-normal"
        style={{
          fontFamily: PAPER_TITLE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {t("genealogyBook.ouHallName", "DeepFamily")}
      </div>
    </aside>
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

  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-su">
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col gap-7"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
      >
        {book.charts.map((chart) => (
          <section
            key={chart.index}
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: "var(--df-paper-line)",
            }}
            data-testid={`paper-su-table-${chart.index}`}
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <h2
                className="text-xl font-bold tracking-normal"
                style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
              >
                {t("genealogyBook.styles.su", "Su-style")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {chart.repeatedDepth !== undefined
                  ? t(
                      "genealogyBook.suOverlapNote",
                      "This chart repeats the previous chart's fifth generation.",
                    )
                  : t(
                      "genealogyBook.suTableRule",
                      "Five vertical generations per chart, right-to-left.",
                    )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {chart.spreads.map((spread) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
                  style={{
                    borderColor: "var(--df-paper-line)",
                    background: "var(--df-paper-sheet)",
                  }}
                  data-testid={`paper-su-spread-${chart.index}-${spread.index}`}
                >
                  <SuPage side="left" chart={chart} spread={spread} t={t} />
                  <SuSpine
                    chartIndex={chart.index}
                    spread={spread}
                    title={spineTitle}
                    t={t}
                  />
                  <SuPage side="right" chart={chart} spread={spread} t={t} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
