import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildLineagePaperBook,
  getLineageGenerationMark,
  getLineagePageMetrics,
  getLineagePageWidth,
  LINEAGE_GENERATION_MARK_WIDTH,
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
  PAPER_LEAF_STYLE,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
  paperSvgTextStyle,
} from "../paperStyles";
import { PaperZoomViewport } from "../PaperZoomViewport";
import { clipText, getChildRankWord, getPaperSpineTitle } from "../paperText";
import { PaperFrameOverlay } from "./PaperFrameOverlay";
import { PaperSpine } from "./PaperSpine";

const LINEAGE_SPINE_WIDTH = 72;
const LINEAGE_MIN_SPREAD_WIDTH = 1180;
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
  if (person.relation?.kind === "root") return t("genealogyBook.rootLabel", "ancestor");
  if (entry.rowIndex === 0) return "";
  // The lineage chart already shows parentage via the connecting lines, so the rank word
  // (之子/之女, 长子/次子…) is enough — no father name needed.
  return getChildRankWord(person, t);
}

function LineagePersonMark({ entry, t }: { entry: LineageEntry; t: TranslateFn }) {
  const name = clipText(
    entry.person.ui.fullName || entry.person.ui.titleText || entry.person.ui.shortHashText,
    10,
  );
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
          stroke={PAPER_LINE.strong}
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
          stroke={PAPER_LINE.strong}
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
            ...paperSvgTextStyle("relation"),
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
          ...paperSvgTextStyle("name"),
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
  const children = connector.childIds
    .map((childId) => entryById.get(childId))
    .filter(Boolean) as LineageEntry[];
  const showParentStem =
    connector.parentCenterX !== undefined && connector.parentBottomY !== undefined;

  return (
    <g
      data-testid={`paper-lineage-connector-${connector.parentId}`}
      data-connector-kind={connector.kind}
      data-connector-side={connector.side}
      fill="none"
      stroke={PAPER_LINE.strong}
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

function mergeLineagePageConnectors(connectors: LineageConnector[]): LineageConnector[] {
  const merged = new Map<string, LineageConnector>();

  for (const connector of connectors) {
    const groupKey = [connector.parentId, connector.side, connector.horizontalY.toFixed(4)].join(
      ":",
    );
    const current = merged.get(groupKey);
    if (!current) {
      merged.set(groupKey, {
        ...connector,
        key: `merged:${groupKey}`,
        childIds: Array.from(new Set(connector.childIds)),
      });
      continue;
    }

    current.horizontalStartX = Math.min(current.horizontalStartX, connector.horizontalStartX);
    current.horizontalEndX = Math.max(current.horizontalEndX, connector.horizontalEndX);
    current.childCircleY = Math.min(current.childCircleY, connector.childCircleY);
    current.parentCenterX ??= connector.parentCenterX;
    current.parentBottomY ??= connector.parentBottomY;
    current.childIds = Array.from(new Set([...current.childIds, ...connector.childIds]));
    if (connector.kind === "local") current.kind = "local";
  }

  return Array.from(merged.values());
}

// The 世次 column is rendered as HTML (not SVG) so its rail, cell dividers, tint and tabs are the
// exact same CSS as the Ou-style generation column (SVG strokes can't pixel-match a CSS border
// under non-uniform viewBox scaling). It overlays the right edge of the page; its width is the
// generation column's fraction of the page so it lines up with the SVG body to its left.
function LineageGenerationColumn({
  rows,
  metrics,
  t,
}: {
  rows: LineageGenerationRow[];
  metrics: LineagePageMetrics;
  t: TranslateFn;
}) {
  const widthPct =
    (metrics.generationMarkWidth / (metrics.rightBodyWidth + metrics.generationMarkWidth)) * 100;

  return (
    <div
      className="absolute right-0 top-0 grid h-full grid-rows-5"
      style={{ width: `${widthPct}%` }}
    >
      {rows.map((row) => (
        <div
          key={row.depth}
          className="flex flex-col items-center justify-center border-b border-l px-2 last:border-b-0"
          style={{ borderColor: PAPER_LINE.soft, background: PAPER_LINE.tint }}
          data-testid={`paper-lineage-generation-${row.depth}`}
        >
          <span
            className="flex min-h-16 w-8 items-center justify-center px-1.5 py-2 shadow-sm"
            style={{
              ...PAPER_TEXT.generationMark,
              backgroundColor: PAPER_MARK_BG,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
            data-testid={`paper-lineage-generation-mark-${row.depth}`}
          >
            {getLineageGenerationMark(row.depth, t)}
          </span>
          {row.repeated ? (
            <span className="mt-2" style={{ ...PAPER_TEXT.tag, writingMode: "vertical-rl" }}>
              {t("genealogyBook.repeatedGeneration", "repeated")}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LineageRowRules({ width }: { width: number }) {
  return (
    <g pointerEvents="none">
      {Array.from({ length: 4 }, (_value, index) => {
        const y = (index + 1) * LINEAGE_ROW_HEIGHT;
        return (
          <line
            key={y}
            x1={0}
            y1={y}
            x2={width}
            y2={y}
            stroke={PAPER_LINE.soft}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
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
  const connectors = useMemo(
    () =>
      mergeLineagePageConnectors(spread.connectors.filter((connector) => connector.side === side)),
    [side, spread.connectors],
  );
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.person.id, entry])),
    [entries],
  );
  const pageWidth = getLineagePageWidth(side, metrics);
  // Row rules cover only the body; the right page's generation column is HTML (see LineagePage).
  const bodyWidth = side === "right" ? metrics.rightBodyWidth : pageWidth;

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
      <LineageRowRules width={bodyWidth} />
      <g>
        {connectors.map((connector) => (
          <LineageConnectorLines key={connector.key} connector={connector} entryById={entryById} />
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
      className="relative h-[872px]"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-lineage-${side}-${chart.index}-${spread.index}`}
    >
      <div className="h-full">
        <LineagePageSvg
          side={side}
          chartIndex={chart.index}
          spread={spread}
          metrics={metrics}
          t={t}
        />
      </div>
      {side === "right" ? (
        <LineageGenerationColumn rows={spread.rows} metrics={metrics} t={t} />
      ) : null}
    </div>
  );
}

export function LineageBookRenderer({
  graph,
  rootId,
  generations,
  t,
  spineTitleOverride,
  paperVars,
  hallName,
  fontScale,
  coverSlot,
}: {
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
  t: TranslateFn;
  spineTitleOverride?: string;
  paperVars?: CSSProperties;
  hallName?: string;
  fontScale?: number;
  coverSlot?: (volumeCount: number) => ReactNode;
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

  useEffect(() => {
    const element = spreadsRef.current;
    if (!element || typeof window === "undefined") return undefined;

    let frame = 0;
    const updateSpreadWidth = () => {
      // getBoundingClientRect includes the content-layer `zoom` (unlike client*/offset*), but
      // pagination runs on the base (unzoomed) layout, so divide the zoom back out here.
      const nextWidth = Math.max(
        LINEAGE_MIN_SPREAD_WIDTH,
        element.getBoundingClientRect().width / (fontScale ?? 1),
      );
      setSpreadWidth((currentWidth) =>
        currentWidth !== null && Math.abs(currentWidth - nextWidth) < 1 ? currentWidth : nextWidth,
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
  }, [fontScale]);

  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-4 md:p-6"
      style={paperVars ?? PAPER_VARS}
      data-testid="paper-lineage"
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
              ...PAPER_LEAF_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-lineage-table-1"
          >
            <div ref={spreadsRef} className="flex flex-col gap-5">
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
                  data-testid={`paper-lineage-spread-${chart.index}-${spread.index}`}
                  data-paper-spread=""
                >
                  <PaperFrameOverlay />
                  <LineagePage side="left" chart={chart} spread={spread} metrics={metrics} t={t} />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    hallName={hallName}
                    t={t}
                    testIdPrefix="paper-lineage-spine"
                    pageOrder="rtl"
                  />
                  <LineagePage side="right" chart={chart} spread={spread} metrics={metrics} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </PaperZoomViewport>
    </div>
  );
}
