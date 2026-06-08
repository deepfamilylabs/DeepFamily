import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildSuPaperBook,
  getSuGenerationMark,
  getSuPageMetrics,
  getSuPageWidth,
  splitSuRowEntries,
  SU_BODY_COLUMN_WIDTH,
  SU_BODY_LINE_HEIGHT,
  SU_BODY_PADDING_X,
  SU_COLUMN_UNIT_CAPACITY,
  SU_GENERATION_MARK_WIDTH,
  SU_NAME_LANE_WIDTH,
  SU_NAME_MAX_LENGTH,
  SU_RECORD_BOTTOM_PADDING,
  SU_RECORD_TOP_PADDING,
  type SuChartWindow,
  type SuConnector,
  type SuGenerationRow,
  type SuPageMetrics,
  type SuPageSide,
  type SuPageSpread,
  type SuPersonEntry,
} from "../layout/suPagination";
import {
  OU_LEFT_PAGE_BODY_WIDTH,
  OU_RIGHT_PAGE_BODY_WIDTH,
  type OuPageBodyWidths,
} from "../layout/ouPagination";
import type { PaperGeneration, PaperPerson, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
} from "../paperStyles";
import { clipText, getPaperSpineTitle, measureRecordUnits } from "../paperText";
import { PaperSpine } from "./PaperSpine";

const SU_SPINE_WIDTH = 72;
const SU_MIN_SPREAD_WIDTH = 1180;

function getMeasuredSuPageBodyWidths(spreadWidth: number): OuPageBodyWidths {
  const pageWidth = Math.max(0, (spreadWidth - SU_SPINE_WIDTH) / 2);
  return {
    right: Math.max(OU_RIGHT_PAGE_BODY_WIDTH, pageWidth - SU_GENERATION_MARK_WIDTH),
    left: Math.max(OU_LEFT_PAGE_BODY_WIDTH, pageWidth),
  };
}

function SuRowRules({
  side,
  metrics,
}: {
  side: SuPageSide;
  metrics: SuPageMetrics;
}) {
  const width = side === "right" ? metrics.rightBodyWidth : metrics.leftBodyWidth;
  return (
    <g pointerEvents="none">
      {Array.from({ length: 4 }, (_value, index) => {
        const y = (index + 1) * metrics.rowHeight;
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
            data-testid={`paper-su-row-rule-${index + 1}`}
          />
        );
      })}
    </g>
  );
}

function SuConnectorLines({
  connector,
  entryById,
}: {
  connector: SuConnector;
  entryById: Map<NodeId, SuPersonEntry>;
}) {
  const children = connector.childIds
    .map((childId) => entryById.get(childId))
    .filter(Boolean) as SuPersonEntry[];
  const showParentStem =
    (connector.kind === "local" || connector.kind === "outgoing") &&
    connector.parentCenterX !== undefined &&
    connector.parentBottomY !== undefined;

  return (
    <g
      data-testid={`paper-su-connector-${connector.parentId}`}
      data-connector-kind={connector.kind}
      data-connector-side={connector.side}
      fill="none"
      stroke={PAPER_LINE.accent}
      strokeWidth={1.15}
      strokeLinecap="square"
    >
      {showParentStem ? (
        <line
          x1={connector.parentCenterX}
          y1={connector.parentBottomY}
          x2={connector.parentCenterX}
          y2={connector.horizontalY}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <line
        x1={connector.horizontalStartX}
        y1={connector.horizontalY}
        x2={connector.horizontalEndX}
        y2={connector.horizontalY}
        vectorEffect="non-scaling-stroke"
      />
      {children.map((child) => (
        <line
          key={child.person.id}
          x1={child.centerX}
          y1={connector.horizontalY}
          x2={child.centerX}
          y2={child.topY}
          vectorEffect="non-scaling-stroke"
          data-testid={`paper-su-child-stem-${child.person.id}`}
        />
      ))}
    </g>
  );
}

function mergeSuPageConnectors(connectors: SuConnector[]): SuConnector[] {
  const merged = new Map<string, SuConnector>();

  for (const connector of connectors) {
    const groupKey = [
      connector.parentId,
      connector.side,
      connector.horizontalY.toFixed(4),
    ].join(":");
    const current = merged.get(groupKey);
    if (!current) {
      merged.set(groupKey, {
        ...connector,
        key: `merged:${groupKey}`,
        childIds: [...connector.childIds],
      });
      continue;
    }

    current.horizontalStartX = Math.min(
      current.horizontalStartX,
      connector.horizontalStartX,
    );
    current.horizontalEndX = Math.max(current.horizontalEndX, connector.horizontalEndX);
    current.childTopY = Math.min(current.childTopY, connector.childTopY);
    current.parentCenterX ??= connector.parentCenterX;
    current.parentBottomY ??= connector.parentBottomY;
    current.childIds = Array.from(new Set([...current.childIds, ...connector.childIds]));
  }

  return Array.from(merged.values());
}

function SuPageSvg({
  side,
  chartIndex,
  spread,
  metrics,
}: {
  side: SuPageSide;
  chartIndex: number;
  spread: SuPageSpread;
  metrics: SuPageMetrics;
}) {
  const rows = spread.rows;
  const entries = rows.flatMap((row) => splitSuRowEntries(row, side));
  const connectors = useMemo(
    () =>
      mergeSuPageConnectors(
        spread.connectors.filter((connector) => connector.side === side),
      ),
    [side, spread.connectors],
  );
  const entryById = useMemo(
    () =>
      new Map(
        entries
          .filter((entry) => !entry.continued)
          .map((entry) => [entry.person.id, entry] as const),
      ),
    [entries],
  );
  const pageWidth = getSuPageWidth(side, metrics);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${pageWidth} ${metrics.bodyHeight}`}
      preserveAspectRatio="none"
      className="absolute inset-0 block h-full w-full max-w-none shrink-0"
      data-testid={`paper-su-page-${side}-${chartIndex}-${spread.index}`}
      role="img"
    >
      <SuRowRules side={side} metrics={metrics} />
      <g>
        {connectors.map((connector) => (
          <SuConnectorLines
            key={connector.key}
            connector={connector}
            entryById={entryById}
          />
        ))}
      </g>
    </svg>
  );
}

type SuRenderRecord = Pick<
  SuPersonEntry,
  "key" | "person" | "text" | "x" | "y" | "widthPx" | "continued" | "partIndex"
>;

// A person's biography is split into fixed-width slot chunks for tree placement, but rendering
// each chunk as its own vertical-rl block reopens a wide aisle at every slot boundary (a slot is
// wider than the columns it holds). Merging a person's chunks on one page side into a single
// continuous block lets CSS wrap the columns uniformly — every inter-column gap is just the tight
// body line-height — and sizing the block to its natural column count keeps the reclaimed slot
// slack out of the text (it lands as ordinary spacing before the next record, not mid-biography).
function mergeSuSideRecords(
  entries: SuPersonEntry[],
  metrics: SuPageMetrics,
): SuRenderRecord[] {
  const byPerson = new Map<NodeId, SuPersonEntry[]>();
  for (const entry of entries) {
    const group = byPerson.get(entry.person.id);
    if (group) group.push(entry);
    else byPerson.set(entry.person.id, [entry]);
  }

  const records: SuRenderRecord[] = [];
  for (const group of byPerson.values()) {
    group.sort((a, b) => a.slotIndex - b.slotIndex);
    const head = group[0];
    const continued = group.every((entry) => entry.continued);
    const text = group.map((entry) => entry.text).join("");
    const allottedWidth = group.reduce((sum, entry) => sum + entry.slotWidth, 0);
    const rightEdge = head.x + head.slotWidth;
    const nameLane = continued ? 0 : SU_NAME_LANE_WIDTH;
    const columns = Math.max(1, Math.ceil(measureRecordUnits(text) / SU_COLUMN_UNIT_CAPACITY));
    const widthPx = Math.min(
      allottedWidth,
      columns * SU_BODY_COLUMN_WIDTH + nameLane + SU_BODY_PADDING_X,
    );
    records.push({
      key: `${head.person.id}:${head.spreadIndex}:${head.side}`,
      person: head.person,
      text,
      x: rightEdge - widthPx,
      y: head.y,
      widthPx,
      continued,
      partIndex: head.partIndex,
    });
  }
  return records;
}

function SuPersonRecord({
  entry,
  pageWidth,
  metrics,
  t,
}: {
  entry: SuRenderRecord;
  pageWidth: number;
  metrics: SuPageMetrics;
  t: TranslateFn;
}) {
  const person = entry.person;
  const name = entry.continued
    ? ""
    : clipText(
        person.ui.fullName || person.ui.titleText || person.ui.shortHashText,
        SU_NAME_MAX_LENGTH,
      );
  const isFemale = person.ui.gender === 2 && !entry.continued;
  const height = Math.max(0, metrics.rowHeight - SU_RECORD_TOP_PADDING - SU_RECORD_BOTTOM_PADDING);

  return (
    <article
      className="absolute z-10 flex flex-row-reverse justify-start overflow-visible"
      style={{
        left: `${(entry.x / pageWidth) * 100}%`,
        top: `${((entry.y + SU_RECORD_TOP_PADDING) / metrics.bodyHeight) * 100}%`,
        width: `${(entry.widthPx / pageWidth) * 100}%`,
        height,
        direction: "ltr",
      }}
      data-testid={`paper-su-entry-${entry.key}`}
      data-person-id={person.id}
      data-continued={entry.continued ? "true" : "false"}
      data-part-index={entry.partIndex}
    >
      {entry.continued ? null : (
        <div
          className="flex shrink-0 flex-col items-center px-0.5"
          style={{ width: SU_NAME_LANE_WIDTH }}
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
            {name}
            {isFemale ? (
              <span
                style={{ ...PAPER_TEXT.femaleMark }}
                data-testid={`paper-su-female-${person.id}`}
              >
                {"　"}
                {t("genealogyBook.ouFemaleMark", "女")}
              </span>
            ) : null}
          </strong>
        </div>
      )}
      <p
        className="m-0 h-full min-w-0 flex-1 px-1"
        style={{
          ...PAPER_TEXT.body,
          // In vertical-rl, line-height is the column-to-column gap; the shared 1.55 body leading
          // leaves wide aisles between columns, so Su tightens it to keep columns close-packed.
          lineHeight: SU_BODY_LINE_HEIGHT,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          overflowWrap: "anywhere",
          wordBreak: "break-all",
        }}
        data-testid={`paper-su-detail-${person.id}`}
      >
        {entry.text}
      </p>
    </article>
  );
}

function SuGenerationColumn({
  rows,
  metrics,
  t,
}: {
  rows: SuGenerationRow[];
  metrics: SuPageMetrics;
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
          data-testid={`paper-su-generation-${row.depth}`}
          aria-label={row.label}
        >
          <span
            className="flex min-h-16 w-8 items-center justify-center px-1.5 py-2 shadow-sm"
            style={{
              ...PAPER_TEXT.generationMark,
              backgroundColor: PAPER_MARK_BG,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
            data-testid={`paper-su-generation-mark-${row.depth}`}
          >
            {getSuGenerationMark(row.depth, t)}
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
      ))}
    </div>
  );
}

function SuPage({
  side,
  chart,
  spread,
  metrics,
  t,
}: {
  side: SuPageSide;
  chart: SuChartWindow;
  spread: SuPageSpread;
  metrics: SuPageMetrics;
  t: TranslateFn;
}) {
  const chunkEntries = spread.rows.flatMap((row) => splitSuRowEntries(row, side));
  const records = mergeSuSideRecords(chunkEntries, metrics);
  const pageWidth = getSuPageWidth(side, metrics);

  return (
    <div
      className="relative h-[872px] overflow-hidden"
      style={PAPER_SHEET_STYLE}
      data-testid={`paper-su-${side}-${chart.index}-${spread.index}`}
    >
      <SuPageSvg side={side} chartIndex={chart.index} spread={spread} metrics={metrics} />
      {records.map((record) => (
        <SuPersonRecord
          key={record.key}
          entry={record}
          pageWidth={pageWidth}
          metrics={metrics}
          t={t}
        />
      ))}
      {side === "right" ? (
        <SuGenerationColumn rows={spread.rows} metrics={metrics} t={t} />
      ) : null}
    </div>
  );
}

export function SuBookRenderer({
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
    () => (spreadWidth ? getMeasuredSuPageBodyWidths(spreadWidth) : undefined),
    [spreadWidth],
  );
  const metrics = useMemo(() => getSuPageMetrics(pageBodyWidths), [pageBodyWidths]);
  const book = useMemo(
    () => buildSuPaperBook({ graph, rootId, generations, t, pageBodyWidths }),
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
      const nextWidth = Math.max(SU_MIN_SPREAD_WIDTH, element.getBoundingClientRect().width);
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
                  "Five generations per chart, fathers descend vertically and siblings branch horizontally.",
                )}
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
                  data-testid={`paper-su-spread-${chart.index}-${spread.index}`}
                >
                  <SuPage side="left" chart={chart} spread={spread} metrics={metrics} t={t} />
                  <PaperSpine
                    chartIndex={chart.index}
                    spreadIndex={spread.index}
                    title={spineTitle}
                    t={t}
                    testIdPrefix="paper-su-spine"
                    pageOrder="rtl"
                  />
                  <SuPage side="right" chart={chart} spread={spread} metrics={metrics} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
