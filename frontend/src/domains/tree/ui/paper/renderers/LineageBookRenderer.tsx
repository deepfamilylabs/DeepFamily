import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildLineagePaperBook,
  getLineageGenerationMark,
  getLineagePageMetrics,
  getLineagePageWidth,
  LINEAGE_GENERATION_MARK_WIDTH,
  LINEAGE_PAGE_BODY_HEIGHT,
  LINEAGE_ROW_HEIGHT,
  splitLineageRowEntries,
  type LineageChartWindow,
  type LineageConnector,
  type LineageEntry,
  type LineageGenerationRow,
  type LineagePageMetrics,
  type LineagePageSide,
  type LineagePageSpread,
} from "../layout/lineagePagination";
import {
  OU_LEFT_PAGE_BODY_WIDTH,
  OU_RIGHT_PAGE_BODY_WIDTH,
  type OuPageBodyWidths,
} from "../layout/ouPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import {
  clipText,
  getChildRankWord,
  getPaperSpineTitle,
} from "../paperText";
import { PaperSpine } from "./PaperSpine";

const LINEAGE_SPINE_WIDTH = 72;
const LINEAGE_MIN_SPREAD_WIDTH = 1180;
const LINEAGE_INK = "var(--df-paper-ink)";
const LINEAGE_MUTED = "var(--df-paper-muted)";
const LINEAGE_RED = "var(--df-paper-red)";
const LINEAGE_LINE = "var(--df-paper-line)";
const LINEAGE_MARK_BG = "#1f1a14";
const LINEAGE_MARK_FG = "#f7efd8";
const LINEAGE_MARK_WIDTH = 24;
const LINEAGE_MARK_HEIGHT = 68;
const LINEAGE_NODE_NAME_FONT_SIZE = 20;
const LINEAGE_NODE_RELATION_FONT_SIZE = 11;
const LINEAGE_NODE_RELATION_GAP = 18;
const LINEAGE_ROOT_STEM_TOP_GAP = 18;
const LINEAGE_ROOT_STEM_BOTTOM_GAP = 14;

function getMeasuredLineagePageBodyWidths(spreadWidth: number): OuPageBodyWidths {
  const pageWidth = Math.max(0, (spreadWidth - LINEAGE_SPINE_WIDTH) / 2);
  return {
    right: Math.max(OU_RIGHT_PAGE_BODY_WIDTH, pageWidth - LINEAGE_GENERATION_MARK_WIDTH),
    left: Math.max(OU_LEFT_PAGE_BODY_WIDTH, pageWidth),
  };
}

function getLineageRelationLabel(entry: LineageEntry, t: TranslateFn): string {
  const { person } = entry;
  if (person.relation?.kind === "root") return t("genealogyBook.suRootLabel", "ancestor");
  if (entry.rowIndex === 0) return "";
  // The lineage chart already shows parentage via the connecting lines, so the rank word
  // (之子/之女, 长子/次子…) is enough — no father name needed.
  return getChildRankWord(person, t);
}

function LineagePersonMark({ entry, t }: { entry: LineageEntry; t: TranslateFn }) {
  const name = clipText(entry.person.ui.fullName || entry.person.ui.titleText || entry.person.ui.shortHashText, 10);
  const relationLabel = getLineageRelationLabel(entry, t);
  const showRootStem = entry.person.relation?.kind === "root";
  const showCircle = entry.person.relation?.kind === "child" && entry.rowIndex > 0;

  return (
    <g data-testid={`paper-node-${entry.person.id}`}>
      <title>{entry.person.ui.personHash}</title>
      {showRootStem ? (
        <line
          x1={entry.centerX}
          y1={entry.y + LINEAGE_ROOT_STEM_TOP_GAP}
          x2={entry.centerX}
          y2={entry.nameY - LINEAGE_ROOT_STEM_BOTTOM_GAP}
          stroke={LINEAGE_LINE}
          strokeWidth={1.15}
          strokeLinecap="square"
          data-testid={`paper-lineage-root-stem-${entry.person.id}`}
        />
      ) : null}
      {showCircle ? (
        <circle
          cx={entry.centerX}
          cy={entry.circleY}
          r={4}
          fill="var(--df-paper-sheet)"
          stroke={LINEAGE_LINE}
          strokeWidth={1.05}
          data-testid={`paper-lineage-circle-${entry.person.id}`}
        />
      ) : null}
      {relationLabel ? (
        <text
          x={entry.centerX - LINEAGE_NODE_RELATION_GAP}
          y={entry.y + 13}
          textAnchor="start"
          style={{
            fill: LINEAGE_MUTED,
            fontFamily: PAPER_NOTE_FONT_STACK,
            fontSize: LINEAGE_NODE_RELATION_FONT_SIZE,
            fontWeight: 400,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid={`paper-lineage-relation-${entry.person.id}`}
        >
          {relationLabel}
        </text>
      ) : null}
      <text
        x={entry.centerX}
        y={entry.nameY}
        textAnchor="start"
        style={{
          fill: LINEAGE_INK,
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: LINEAGE_NODE_NAME_FONT_SIZE,
          fontWeight: 700,
          letterSpacing: 0,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          textAlign: "right",
        }}
        data-testid={`paper-lineage-name-${entry.person.id}`}
      >
        {name}
      </text>
    </g>
  );
}

function LineageConnectorLines({
  connector,
  entryById,
}: {
  connector: LineageConnector;
  entryById: Map<NodeId, LineageEntry>;
}) {
  const children =
    connector.kind === "outgoing"
      ? []
      : (connector.childIds
          .map((childId) => entryById.get(childId))
          .filter(Boolean) as LineageEntry[]);
  const showParentStem =
    connector.kind !== "incoming" &&
    connector.parentCenterX !== undefined &&
    connector.parentBottomY !== undefined;

  return (
    <g
      data-testid={`paper-lineage-connector-${connector.parentId}`}
      data-connector-kind={connector.kind}
      data-connector-side={connector.side}
      fill="none"
      stroke={LINEAGE_LINE}
      strokeWidth={1.15}
      strokeLinecap="square"
    >
      {showParentStem ? (
        <line
          x1={connector.parentCenterX}
          y1={connector.parentBottomY}
          x2={connector.parentCenterX}
          y2={connector.horizontalY}
        />
      ) : null}
      <line
        x1={connector.horizontalStartX}
        y1={connector.horizontalY}
        x2={connector.horizontalEndX}
        y2={connector.horizontalY}
      />
      {children.map((child) => (
        <line
          key={child.person.id}
          x1={child.centerX}
          y1={connector.horizontalY}
          x2={child.centerX}
          y2={child.circleY}
        />
      ))}
    </g>
  );
}

function LineageGenerationMarks({
  rows,
  metrics,
  t,
}: {
  rows: LineageGenerationRow[];
  metrics: LineagePageMetrics;
  t: TranslateFn;
}) {
  const markX = metrics.rightBodyWidth + (metrics.generationMarkWidth - LINEAGE_MARK_WIDTH) / 2;
  const textX = markX + 12;

  return (
    <g pointerEvents="none">
      <line
        x1={metrics.rightBodyWidth}
        y1={0}
        x2={metrics.rightBodyWidth}
        y2={metrics.bodyHeight}
        stroke={LINEAGE_LINE}
        strokeWidth={0.8}
        data-testid="paper-lineage-generation-rail"
      />
      {rows.map((row, rowIndex) => {
        const markY = rowIndex * metrics.rowHeight + (metrics.rowHeight - LINEAGE_MARK_HEIGHT) / 2;
        return (
          <g key={row.depth} data-testid={`paper-lineage-generation-${row.depth}`}>
            <rect
              x={markX}
              y={markY}
              width={LINEAGE_MARK_WIDTH}
              height={LINEAGE_MARK_HEIGHT}
              fill={LINEAGE_MARK_BG}
              data-testid={`paper-lineage-generation-mark-bg-${row.depth}`}
            />
            <text
              x={textX}
              y={markY + 11}
              textAnchor="start"
              style={{
                fill: LINEAGE_MARK_FG,
                fontFamily: PAPER_TITLE_FONT_STACK,
                fontSize: 15,
                fontWeight: 700,
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
              data-testid={`paper-lineage-generation-mark-${row.depth}`}
            >
              {getLineageGenerationMark(row.depth, t)}
            </text>
            {row.repeated ? (
              <text
                x={markX - 10}
                y={markY + 14}
                textAnchor="start"
                style={{
                  fill: LINEAGE_RED,
                  fontFamily: PAPER_NOTE_FONT_STACK,
                  fontSize: 11,
                  fontWeight: 700,
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                }}
              >
                {t("genealogyBook.repeatedGeneration", "repeated")}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function LineageRowRules({ pageWidth, metrics }: { pageWidth: number; metrics: LineagePageMetrics }) {
  return (
    <g pointerEvents="none">
      {Array.from({ length: 4 }, (_value, index) => {
        const y = (index + 1) * LINEAGE_ROW_HEIGHT;
        return (
          <line
            key={y}
            x1={0}
            y1={y}
            x2={pageWidth}
            y2={y}
            stroke={LINEAGE_LINE}
            strokeWidth={0.8}
            data-testid={`paper-lineage-row-rule-${index + 1}`}
          />
        );
      })}
    </g>
  );
}

function LineagePageSvg({
  side,
  chartIndex,
  spread,
  metrics,
  t,
}: {
  side: LineagePageSide;
  chartIndex: number;
  spread: LineagePageSpread;
  metrics: LineagePageMetrics;
  t: TranslateFn;
}) {
  const rows = spread.rows;
  const entries = rows.flatMap((row) => splitLineageRowEntries(row, side));
  const connectors = spread.connectors.filter((connector) => connector.side === side);
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.person.id, entry])),
    [entries],
  );
  const pageWidth = getLineagePageWidth(side, metrics);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${pageWidth} ${metrics.bodyHeight}`}
      preserveAspectRatio="none"
      className="block h-full w-full max-w-none shrink-0"
      data-testid={`paper-lineage-page-${side}-${chartIndex}-${spread.index}`}
      role="img"
    >
      <LineageRowRules pageWidth={pageWidth} metrics={metrics} />
      {side === "right" ? <LineageGenerationMarks rows={rows} metrics={metrics} t={t} /> : null}
      <g>
        {connectors.map((connector) => (
          <LineageConnectorLines
            key={connector.key}
            connector={connector}
            entryById={entryById}
          />
        ))}
      </g>
      <g>
        {entries.map((entry) => (
          <LineagePersonMark key={entry.key} entry={entry} t={t} />
        ))}
      </g>
    </svg>
  );
}

function LineagePageHeader({
  chartIndex,
  spread,
  side,
  t,
}: {
  chartIndex: number;
  spread: LineagePageSpread;
  side: LineagePageSide;
  t: TranslateFn;
}) {
  const spreadLabel =
    spread.kind === "main"
      ? t("genealogyBook.lineageMainSpread", "Main chart")
      : t("genealogyBook.lineageContinuationPage", "Continuation {{number}}", {
          number: spread.index,
        });

  return (
    <div
      className="flex h-8 items-center justify-center border-b px-3 text-center text-[12px] font-bold tracking-normal"
      style={{
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
        fontFamily: PAPER_TITLE_FONT_STACK,
      }}
      data-testid={`paper-lineage-header-${chartIndex}-${spread.index}-${side}`}
    >
      <span>
        {t("genealogyBook.ouPageTitle", "Genealogy lineage --- five generations")}
        <span className="mx-2" style={{ color: "var(--df-paper-muted)" }}>
          /
        </span>
        {spreadLabel}
        <span className="mx-2" style={{ color: "var(--df-paper-muted)" }}>
          /
        </span>
        {t(side === "right" ? "genealogyBook.ouRightPage" : "genealogyBook.ouLeftPage", side)}
        <span className="mx-2" style={{ color: "var(--df-paper-muted)" }}>
          /
        </span>
        {t("genealogyBook.volumeLabel", "Volume {{number}}", { number: chartIndex })}
      </span>
    </div>
  );
}

function LineagePage({
  side,
  chart,
  spread,
  metrics,
  t,
}: {
  side: LineagePageSide;
  chart: LineageChartWindow;
  spread: LineagePageSpread;
  metrics: LineagePageMetrics;
  t: TranslateFn;
}) {
  return (
    <div
      className="h-[872px]"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-lineage-${side}-${chart.index}-${spread.index}`}
    >
      <LineagePageHeader chartIndex={chart.index} spread={spread} side={side} t={t} />
      <div className="h-[840px]">
        <LineagePageSvg
          side={side}
          chartIndex={chart.index}
          spread={spread}
          metrics={metrics}
          t={t}
        />
      </div>
    </div>
  );
}

export function LineageBookRenderer({
  graph,
  rootId,
  generations,
  t,
}: {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  t: TranslateFn;
}) {
  const spreadsRef = useRef<HTMLDivElement | null>(null);
  const [spreadWidth, setSpreadWidth] = useState<number | null>(null);
  const pageBodyWidths = useMemo(
    () => (spreadWidth ? getMeasuredLineagePageBodyWidths(spreadWidth) : undefined),
    [spreadWidth],
  );
  const metrics = useMemo(() => getLineagePageMetrics(pageBodyWidths), [pageBodyWidths]);
  const book = useMemo(
    () => buildLineagePaperBook({ graph, rootId, generations, t, pageBodyWidths }),
    [graph, rootId, generations, t, pageBodyWidths],
  );
  const spineTitle = useMemo(() => getPaperSpineTitle(generations, t), [generations, t]);
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
      const nextWidth = Math.max(LINEAGE_MIN_SPREAD_WIDTH, element.getBoundingClientRect().width);
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
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-lineage">
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
      >
        {spreadItems.length ? (
          <section
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: "var(--df-paper-line)",
            }}
            data-testid="paper-lineage-table-1"
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <h2
                className="text-xl font-bold tracking-normal"
                style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
              >
                {t("genealogyBook.styles.lineage", "Lineage")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {t(
                  "genealogyBook.lineageTableRule",
                  "Five generations per chart, using the Ou-style frame with person relationships.",
                )}
              </span>
            </div>

            <div ref={spreadsRef} className="flex flex-col gap-5">
              {spreadItems.map(({ chart, spread }) => (
                <div
                  key={`${chart.index}-${spread.index}`}
                  className="grid min-w-[1180px] grid-cols-[1fr_72px_1fr] border"
                  style={{
                    borderColor: "var(--df-paper-line)",
                    background: "var(--df-paper-sheet)",
                  }}
                  data-testid={`paper-lineage-spread-${chart.index}-${spread.index}`}
                >
                  <LineagePage
                    side="left"
                    chart={chart}
                    spread={spread}
                    metrics={metrics}
                    t={t}
                  />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    t={t}
                    testIdPrefix="paper-lineage-spine"
                    pageOrder="rtl"
                  />
                  <LineagePage
                    side="right"
                    chart={chart}
                    spread={spread}
                    metrics={metrics}
                    t={t}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
