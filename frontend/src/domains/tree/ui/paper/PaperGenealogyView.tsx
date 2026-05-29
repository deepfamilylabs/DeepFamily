import React, { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NodeData, NodeId } from "../../../../shared/model";
import type { TreeGraphData } from "../../selectors";
import GraphViewport from "../GraphViewport";
import useZoom from "../useZoom";
import { computeTreeLayout } from "../layout/treeLayout";
import {
  buildPaperGenerations,
  type PaperGeneration,
  type PaperGenealogyStyle,
  type PaperPerson,
  type TranslateFn,
} from "./paperData";
import {
  buildOuPaperBook,
  getOuGenerationMark,
  getOuFullRecordText,
  OU_PERSON_SLOT_WIDTH,
  splitOuRowEntries,
  type OuChartWindow,
  type OuGenerationRow,
  type OuPersonRecordEntry,
  type OuPageSide,
  type OuPageSpread,
} from "./ouPagination";
import {
  buildSuPaperBook,
  getSuFullRecordText,
  getSuGenerationMark,
  splitSuSpreadColumns,
  SU_GENERATION_MARK_WIDTH,
  SU_PERSON_LANE_WIDTH,
  type SuChartWindow,
  type SuPageSide,
  type SuPageSpread,
  type SuTableLane,
} from "./suPagination";

const PAPER_BODY_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", "PMingLiU", Georgia, serif';
const PAPER_TITLE_FONT_STACK =
  '"STKaiti", "KaiTi", "Kaiti SC", "Songti SC", "STSong", "Noto Serif CJK SC", serif';
const PAPER_NOTE_FONT_STACK =
  '"FangSong", "STFangsong", "FangSong_GB2312", "Songti SC", "SimSun", serif';

const PAPER_VARS = {
  "--df-paper-bg": "#e6d6ad",
  "--df-paper-sheet": "#f7efd8",
  "--df-paper-panel": "#fbf6e8",
  "--df-paper-line": "#8a6a3b",
  "--df-paper-line-soft": "rgba(138, 106, 59, 0.32)",
  "--df-paper-ink": "#332414",
  "--df-paper-muted": "#755f3c",
  "--df-paper-red": "#9b2f25",
} as React.CSSProperties;

const PAPER_SHEET_STYLE: React.CSSProperties = {
  backgroundColor: "var(--df-paper-sheet)",
  backgroundImage:
    "linear-gradient(90deg, rgba(138, 106, 59, 0.045) 1px, transparent 1px), linear-gradient(0deg, rgba(138, 106, 59, 0.035) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
};
const SU_LANE_GRID_ROWS = "64px 96px 1fr";

type SvgPaperNode = PaperPerson & {
  x: number;
  y: number;
  w: number;
  h: number;
};

type SvgPaperEdge = {
  from: NodeId;
  to: NodeId;
};

type SvgDepthGuide = {
  depth: number;
  x: number;
  y: number;
};

type SvgPaperLayout = {
  nodes: SvgPaperNode[];
  edges: SvgPaperEdge[];
  guides: SvgDepthGuide[];
  width: number;
  height: number;
};

export interface PaperGenealogyViewProps {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  nodesData: Record<string, NodeData>;
  hasRoot: boolean;
  loading?: boolean;
  contractMessage?: string;
}

function clipText(value: string | undefined, max = 18): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function buildPersonMap(generations: PaperGeneration[]): Map<NodeId, PaperPerson> {
  const out = new Map<NodeId, PaperPerson>();
  for (const generation of generations) {
    for (const person of generation.people) out.set(person.id, person);
  }
  return out;
}

function buildTreeBackedLayout(
  style: Exclude<PaperGenealogyStyle, "ou" | "dieji" | "modern">,
  graph: TreeGraphData,
  rootId: NodeId | null,
  generations: PaperGeneration[],
): SvgPaperLayout {
  const cfg =
    style === "su"
      ? {
          nodeW: 122,
          nodeH: 132,
          gapX: 42,
          gapY: 178,
          marginX: 70,
          marginY: 72,
        }
      : {
          nodeW: 154,
          nodeH: 88,
          gapX: 58,
          gapY: 146,
          marginX: 72,
          marginY: 72,
        };
  const personById = buildPersonMap(generations);
  const positioned = computeTreeLayout(graph, rootId, {
    baseNodeWidth: cfg.nodeW,
    nodeHeight: cfg.nodeH,
    gapX: cfg.gapX,
    gapY: cfg.gapY,
    marginX: cfg.marginX,
    marginY: cfg.marginY,
  });
  const nodes: SvgPaperNode[] = positioned.nodes
    .map((node) => {
      const person = personById.get(node.id);
      if (!person) return null;
      return { ...person, x: node.x, y: node.y, w: cfg.nodeW, h: cfg.nodeH };
    })
    .filter(Boolean) as SvgPaperNode[];
  const guides = generations.map((generation) => ({
    depth: generation.depth,
    x: 26,
    y: cfg.marginY + generation.depth * cfg.gapY + cfg.nodeH / 2,
  }));

  return {
    nodes,
    edges: positioned.edges,
    guides,
    width: Math.max(positioned.width + 48, 760),
    height: Math.max(positioned.height + 48, 560),
  };
}

function buildSvgPaperLayout(params: {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
}): SvgPaperLayout {
  const { style, graph, rootId, generations } = params;
  if (style === "su" || style === "pagoda")
    return buildTreeBackedLayout(style, graph, rootId, generations);
  return { nodes: [], edges: [], guides: [], width: 0, height: 0 };
}

function getChineseSurname(value: string | undefined): string | null {
  const first = Array.from((value || "").trim())[0];
  return first && /\p{Script=Han}/u.test(first) ? first : null;
}

function getPaperSpineTitle(generations: PaperGeneration[], t: TranslateFn): string {
  const root = generations[0]?.people[0]?.ui;
  const surname = getChineseSurname(root?.fullName || root?.titleText);
  return surname
    ? t("genealogyBook.ouSpineTitleWithSurname", "{{surname}}氏族谱", { surname })
    : t("genealogyBook.ouSpineTitle", "Genealogy");
}

function PaperEmptyState({
  loading,
  contractMessage,
}: {
  loading?: boolean;
  contractMessage?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-[520px] items-center justify-center p-6"
      style={PAPER_VARS}
      data-testid="paper-genealogy-empty"
    >
      <div
        className="max-w-md border px-6 py-5 text-center shadow-sm"
        style={{
          background: "var(--df-paper-sheet)",
          borderColor: "var(--df-paper-line-soft)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="text-lg font-semibold">
          {loading
            ? t("genealogyBook.empty.loading", "Loading genealogy data")
            : t("genealogyBook.empty.title", "No genealogy root available")}
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--df-paper-muted)" }}>
          {contractMessage || t("genealogyBook.empty.description", "Configure a root first.")}
        </div>
      </div>
    </div>
  );
}

function PaperSvgGuides({
  style,
  layout,
}: {
  style: PaperGenealogyStyle;
  layout: SvgPaperLayout;
}) {
  const { t } = useTranslation();
  return (
    <g pointerEvents="none">
      {layout.guides.map((guide) => {
        const generationText = t("genealogyBook.generationLabel", "Generation {{number}}", {
          number: guide.depth + 1,
        });
        const volumeText =
          style === "ou" && guide.depth % 5 === 0
            ? t("genealogyBook.volumeLabel", "Volume {{number}}", {
                number: Math.floor(guide.depth / 5) + 1,
              })
            : "";
        if (style === "ou") {
          return (
            <g key={guide.depth}>
              <line
                x1={guide.x}
                y1={54}
                x2={guide.x}
                y2={layout.height - 36}
                stroke="var(--df-paper-line-soft)"
                strokeDasharray={guide.depth % 5 === 0 ? "0" : "4 8"}
              />
              <text
                x={guide.x}
                y={30}
                textAnchor="middle"
                style={{
                  fill: "var(--df-paper-muted)",
                  fontFamily: PAPER_NOTE_FONT_STACK,
                  fontSize: 13,
                }}
              >
                {generationText}
              </text>
              {volumeText ? (
                <text
                  x={guide.x}
                  y={50}
                  textAnchor="middle"
                  style={{
                    fill: "var(--df-paper-red)",
                    fontFamily: PAPER_TITLE_FONT_STACK,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {volumeText}
                </text>
              ) : null}
            </g>
          );
        }
        return (
          <g key={guide.depth}>
            <line
              x1={48}
              y1={guide.y}
              x2={layout.width - 48}
              y2={guide.y}
              stroke="var(--df-paper-line-soft)"
              strokeDasharray="4 8"
            />
            <text
              x={24}
              y={guide.y + 4}
              textAnchor="middle"
              style={{
                fill: "var(--df-paper-muted)",
                fontFamily: PAPER_NOTE_FONT_STACK,
                fontSize: 12,
                writingMode: "vertical-rl",
              }}
            >
              {generationText}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PaperSvgEdges({
  style,
  nodes,
  edges,
}: {
  style: PaperGenealogyStyle;
  nodes: SvgPaperNode[];
  edges: SvgPaperEdge[];
}) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  return (
    <g fill="none" stroke="var(--df-paper-line)" strokeWidth={1.4} strokeOpacity={0.78}>
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        if (style === "ou") {
          const x1 = from.x;
          const y1 = from.y + from.h / 2;
          const x2 = to.x + to.w;
          const y2 = to.y + to.h / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`}
            />
          );
        }
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h;
        const x2 = to.x + to.w / 2;
        const y2 = to.y;
        if (style === "su") {
          const midY = y1 + Math.max(24, (y2 - y1) / 2);
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
              strokeLinecap="square"
            />
          );
        }
        const midY = y1 + Math.max(18, (y2 - y1) / 2);
        return (
          <path
            key={`${edge.from}->${edge.to}`}
            d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
            strokeLinecap="square"
          />
        );
      })}
    </g>
  );
}

function SvgPaperPersonNode({
  node,
  style,
}: {
  node: SvgPaperNode;
  style: PaperGenealogyStyle;
}) {
  const title = clipText(node.ui.titleText || node.ui.shortHashText, style === "su" ? 10 : 16);
  const details = node.classicalLines.slice(0, style === "pagoda" ? 3 : style === "su" ? 4 : 5);
  const lineHeight = style === "su" ? 17 : 16;
  const titleY = style === "pagoda" ? 30 : style === "su" ? 32 : 24;
  const rectRx = style === "pagoda" ? 2 : style === "su" ? 10 : 2;

  return (
    <g transform={`translate(${node.x}, ${node.y})`} data-testid={`paper-node-${node.id}`}>
      <title>{node.ui.personHash}</title>
      {style === "su" ? (
        <>
          <line
            x1={node.w / 2}
            y1={-28}
            x2={node.w / 2}
            y2={0}
            stroke="var(--df-paper-line)"
            strokeWidth={1.2}
          />
          <circle
            cx={node.w / 2}
            cy={0}
            r={5}
            fill="var(--df-paper-red)"
            stroke="var(--df-paper-line)"
            strokeWidth={0.8}
          />
        </>
      ) : null}
      <rect
        width={node.w}
        height={node.h}
        rx={rectRx}
        ry={rectRx}
        fill="var(--df-paper-panel)"
        stroke="var(--df-paper-line)"
        strokeWidth={1.2}
      />
      <rect
        x={6}
        y={6}
        width={node.w - 12}
        height={node.h - 12}
        rx={Math.max(1, rectRx - 1)}
        ry={Math.max(1, rectRx - 1)}
        fill="none"
        stroke="var(--df-paper-line-soft)"
        strokeWidth={0.8}
      />
      <text
        x={node.w / 2}
        y={titleY}
        textAnchor="middle"
        style={{
          fill: "var(--df-paper-ink)",
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: style === "su" ? 15 : 16,
          fontWeight: 700,
          writingMode: style === "su" ? "vertical-rl" : undefined,
          textOrientation: style === "su" ? "mixed" : undefined,
        }}
      >
        {title}
      </text>
      <text
        x={style === "ou" ? 14 : style === "su" ? node.w / 2 + 28 : node.w / 2}
        y={style === "pagoda" ? 54 : style === "su" ? 58 : 48}
        textAnchor={style === "ou" ? "start" : "middle"}
        style={{
          fill: "var(--df-paper-muted)",
          fontFamily: PAPER_NOTE_FONT_STACK,
          fontSize: 12,
          writingMode: style === "su" ? "vertical-rl" : undefined,
          textOrientation: style === "su" ? "mixed" : undefined,
        }}
      >
        {details.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={style === "ou" ? 14 : style === "su" ? node.w / 2 + 28 - index * 15 : node.w / 2}
            dy={style === "su" || index === 0 ? 0 : lineHeight}
          >
            {clipText(line, style === "ou" ? 22 : 14)}
          </tspan>
        ))}
      </text>
      <text
        x={node.w - 10}
        y={node.h - 10}
        textAnchor="end"
        style={{
          fill: "var(--df-paper-red)",
          fontFamily: PAPER_BODY_FONT_STACK,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {node.depth + 1}.{node.sequence}
      </text>
    </g>
  );
}

function PaperSvgBook({
  style,
  graph,
  rootId,
  generations,
}: {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
}) {
  const layout = useMemo(
    () => buildSvgPaperLayout({ style, graph, rootId, generations }),
    [style, graph, rootId, generations],
  );
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } =
    useZoom({ min: 0.25, max: 4, initialScale: 1 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const miniMapNodes = useMemo(
    () => layout.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h })),
    [layout.nodes],
  );
  const width = Math.max(layout.width, 820);
  const height = Math.max(layout.height, 560);

  return (
    <div className="h-full" style={PAPER_VARS} data-testid={`paper-svg-${style}`}>
      <GraphViewport
        containerRef={containerRef}
        height="100%"
        containerClassName="relative h-full w-full overflow-hidden overscroll-contain"
        svgClassName="block min-h-full min-w-full select-none touch-none"
        viewBox={`0 0 ${width} ${height}`}
        svgRef={svgRef}
        transform={transform}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        setZoom={setZoom}
        kToNorm={kToNorm}
        normToK={normToK}
        centerOn={centerOn}
        miniMapNodes={miniMapNodes}
        miniMapOptions={{ width: 128, height: 92 }}
      >
        <g ref={innerRef as React.RefObject<SVGGElement>}>
          <defs>
            <pattern id={`paper-fiber-${style}`} width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(138, 106, 59, 0.08)" strokeWidth="0.7" />
              <circle cx="7" cy="19" r="0.7" fill="rgba(117, 95, 60, 0.12)" />
              <circle cx="21" cy="8" r="0.5" fill="rgba(117, 95, 60, 0.1)" />
            </pattern>
          </defs>
          <rect width={width} height={height} fill="var(--df-paper-bg)" />
          <rect
            x={26}
            y={24}
            width={width - 52}
            height={height - 48}
            fill="var(--df-paper-sheet)"
            stroke="var(--df-paper-line)"
            strokeWidth={1.4}
          />
          <rect
            x={26}
            y={24}
            width={width - 52}
            height={height - 48}
            fill={`url(#paper-fiber-${style})`}
          />
          <PaperSvgGuides style={style} layout={{ ...layout, width, height }} />
          <PaperSvgEdges style={style} nodes={layout.nodes} edges={layout.edges} />
          {layout.nodes.map((node) => (
            <SvgPaperPersonNode key={node.id} node={node} style={style} />
          ))}
        </g>
      </GraphViewport>
    </div>
  );
}

function OuPersonEntry({ entry, t }: { entry: OuPersonRecordEntry; t: TranslateFn }) {
  const { person } = entry;
  const fullRecord = getOuFullRecordText(person);
  const isFemale = person.ui.gender === 2;

  return (
    <article
      className="relative flex h-full shrink-0 flex-row-reverse border-l px-2.5 py-3 last:border-l-0"
      style={{
        borderColor: "var(--df-paper-line-soft)",
        direction: "ltr",
        width: entry.slotSpan * OU_PERSON_SLOT_WIDTH,
      }}
      data-testid={`paper-row-${person.id}`}
      data-slot-span={entry.slotSpan}
      title={fullRecord}
    >
      <div
        className="flex w-10 shrink-0 items-start justify-end border-l pl-1 pr-1"
        style={{ borderColor: "var(--df-paper-line-soft)" }}
      >
        <strong
          className="text-[17px] font-bold leading-6 tracking-normal"
          style={{
            color: "var(--df-paper-ink)",
            fontFamily: PAPER_TITLE_FONT_STACK,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            textAlign: "right",
          }}
          data-testid={`paper-ou-name-${person.id}`}
        >
          {clipText(person.ui.titleText || person.ui.shortHashText, 10)}
          {isFemale ? (
            <span
              className="text-[11px] font-normal"
              style={{ color: "var(--df-paper-ink)" }}
              data-testid={`paper-ou-female-${person.id}`}
            >
              {"　"}
              {t("genealogyBook.ouFemaleMark", "女")}
            </span>
          ) : null}
        </strong>
      </div>
      <p
        className="m-0 h-full flex-1 overflow-hidden pr-2 text-[11px] leading-[1.5]"
        style={{
          color: "var(--df-paper-muted)",
          fontFamily: PAPER_NOTE_FONT_STACK,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {entry.text}
      </p>
    </article>
  );
}

function OuPageHeader({
  chartIndex,
  spread,
  side,
  t,
}: {
  chartIndex: number;
  spread: OuPageSpread;
  side: OuPageSide;
  t: TranslateFn;
}) {
  const spreadLabel =
    spread.kind === "main"
      ? t("genealogyBook.ouMainSpread", "Main chart")
      : t("genealogyBook.ouContinuationPage", "Continuation {{number}}", {
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
  const entries = splitOuRowEntries(row, side);

  return (
    <div
      className={
        side === "right"
          ? "grid h-full grid-cols-[1fr_54px] border-b last:border-b-0"
          : "h-full border-b last:border-b-0"
      }
      style={{ borderColor: "var(--df-paper-line)" }}
      data-testid={
        side === "right" ? `paper-ou-generation-${row.depth}` : `paper-ou-left-generation-${row.depth}`
      }
      data-ou-row={`paper-ou-row-${chartIndex}-${spreadIndex}-${side}-${row.depth}`}
      aria-label={row.label}
    >
      <div
        className="flex h-full flex-row-reverse justify-start overflow-hidden"
        style={{ direction: "ltr" }}
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
            borderColor: "var(--df-paper-line-soft)",
            background: "rgba(138, 106, 59, 0.07)",
          }}
        >
          <span
            className="flex min-h-16 w-8 items-center justify-center bg-[#1f1a14] px-1.5 py-2 text-[15px] font-bold text-[#f7efd8] shadow-sm"
            style={{
              fontFamily: PAPER_TITLE_FONT_STACK,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
            data-testid={`paper-ou-generation-mark-${row.depth}`}
          >
            {getOuGenerationMark(row.depth, t)}
          </span>
          {row.repeated ? (
            <span
              className="mt-2 text-[11px] font-bold"
              style={{
                color: "var(--df-paper-red)",
                fontFamily: PAPER_NOTE_FONT_STACK,
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
      <OuPageHeader chartIndex={chart.index} spread={spread} side={side} t={t} />
      <div className="grid h-[840px] grid-rows-5">
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

function OuSpine({
  chartIndex,
  spread,
  title,
  t,
}: {
  chartIndex: number;
  spread: OuPageSpread;
  title: string;
  t: TranslateFn;
}) {
  const spreadLabel =
    spread.kind === "main"
      ? t("genealogyBook.ouMainSpread", "Main chart")
      : t("genealogyBook.ouContinuationPage", "Continuation {{number}}", {
          number: spread.index,
        });

  return (
    <aside
      className="relative flex h-[872px] flex-col items-center border-x bg-[#f3e8cc] px-1 py-3"
      style={{
        borderColor: "var(--df-paper-line)",
        color: "var(--df-paper-ink)",
      }}
      data-testid={`paper-ou-spine-${chartIndex}-${spread.index}`}
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

function OuBook({ generations }: { generations: PaperGeneration[] }) {
  const { t } = useTranslation();
  const translate = useCallback<TranslateFn>(
    (key, fallback, options) =>
      t(key, {
        defaultValue: fallback,
        ...(options || {}),
      }),
    [t],
  );
  const book = useMemo(
    () => buildOuPaperBook({ generations, t: translate }),
    [generations, translate],
  );
  const spineTitle = useMemo(
    () => getPaperSpineTitle(generations, translate),
    [generations, translate],
  );

  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-ou">
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
            data-testid={`paper-ou-table-${chart.index}`}
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <h2
                className="text-xl font-bold tracking-normal"
                style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
              >
                {translate("genealogyBook.styles.ou", "Ou-style")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {chart.repeatedDepth !== undefined
                  ? translate(
                      "genealogyBook.ouOverlapNote",
                      "This table repeats the previous table's fifth generation.",
                    )
                  : translate("genealogyBook.ouTableRule", "Five generations per table.")}
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
                  data-testid={`paper-ou-spread-${chart.index}-${spread.index}`}
                >
                  <OuPage side="left" chart={chart} spread={spread} t={translate} />
                  <OuSpine
                    chartIndex={chart.index}
                    spread={spread}
                    title={spineTitle}
                    t={translate}
                  />
                  <OuPage side="right" chart={chart} spread={spread} t={translate} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SuPersonLane({ lane }: { lane: Extract<SuTableLane, { kind: "person" }> }) {
  const { person } = lane;
  const fullRecord = getSuFullRecordText(person);
  const title = clipText(lane.name, lane.continued ? 8 : 10);

  return (
    <article
      className="grid h-full shrink-0 border-l last:border-l-0"
      style={{
        borderColor: "var(--df-paper-line-soft)",
        direction: "ltr",
        width: SU_PERSON_LANE_WIDTH,
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
        className="relative min-h-0 px-1.5 py-3"
        style={{ borderColor: "var(--df-paper-line-soft)" }}
      >
        <p
          className="m-0 h-full text-[13px] leading-[1.55]"
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

function SuGenerationLane({ lane, t }: { lane: Extract<SuTableLane, { kind: "generation" }>; t: TranslateFn }) {
  return (
    <div
      className="grid h-full shrink-0 border-l last:border-l-0"
      style={{
        borderColor: "var(--df-paper-line)",
        width: SU_GENERATION_MARK_WIDTH,
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
          className="flex items-start justify-center pt-3 text-[11px] font-bold"
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
      className="h-full shrink-0 border-l last:border-l-0"
      style={{
        borderColor: "var(--df-paper-line-soft)",
        width: SU_PERSON_LANE_WIDTH,
      }}
      data-su-lane={lane.key}
      aria-hidden="true"
    />
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

function SuBook({ generations }: { generations: PaperGeneration[] }) {
  const { t } = useTranslation();
  const translate = useCallback<TranslateFn>(
    (key, fallback, options) =>
      t(key, {
        defaultValue: fallback,
        ...(options || {}),
      }),
    [t],
  );
  const book = useMemo(
    () => buildSuPaperBook({ generations, t: translate }),
    [generations, translate],
  );
  const spineTitle = useMemo(
    () => getPaperSpineTitle(generations, translate),
    [generations, translate],
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
                {translate("genealogyBook.styles.su", "Su-style")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {chart.repeatedDepth !== undefined
                  ? translate(
                      "genealogyBook.suOverlapNote",
                      "This chart repeats the previous chart's fifth generation.",
                    )
                  : translate(
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
                  <SuPage side="left" chart={chart} spread={spread} t={translate} />
                  <SuSpine
                    chartIndex={chart.index}
                    spread={spread}
                    title={spineTitle}
                    t={translate}
                  />
                  <SuPage side="right" chart={chart} spread={spread} t={translate} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DiejiBook({ generations }: { generations: PaperGeneration[] }) {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-dieji">
      <div
        className="mx-auto min-h-full max-w-6xl border px-5 py-6 shadow-sm md:px-10 md:py-8"
        style={{
          ...PAPER_SHEET_STYLE,
          borderColor: "var(--df-paper-line)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="mb-6 flex items-end justify-between gap-4 border-b pb-3" style={{ borderColor: "var(--df-paper-line-soft)" }}>
          <h2
            className="text-2xl font-bold tracking-normal"
            style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
          >
            {t("genealogyBook.styles.dieji", "Register")}
          </h2>
          <span className="text-sm" style={{ color: "var(--df-paper-muted)" }}>
            {t("genealogyBook.recordCount", "{{count}} records", {
              count: generations.reduce((sum, generation) => sum + generation.people.length, 0),
            })}
          </span>
        </div>
        <div className="space-y-7">
          {generations.map((generation) => (
            <section key={generation.depth}>
              <h3
                className="mb-3 border-l-4 pl-3 text-lg font-bold tracking-normal"
                style={{ borderColor: "var(--df-paper-red)" }}
              >
                {generation.label}
              </h3>
              <div className="divide-y" style={{ borderColor: "var(--df-paper-line-soft)" }}>
                {generation.people.map((person) => (
                  <article
                    key={person.id}
                    className="grid gap-2 py-3 md:grid-cols-[9rem_1fr]"
                    data-testid={`paper-row-${person.id}`}
                  >
                    <div className="font-bold" style={{ fontFamily: PAPER_TITLE_FONT_STACK }}>
                      {person.depth + 1}.{person.sequence} {person.ui.titleText}
                    </div>
                    <p
                      className="text-sm leading-7"
                      style={{ color: "var(--df-paper-muted)", fontFamily: PAPER_NOTE_FONT_STACK }}
                    >
                      {person.classicalLines.join(" · ") || person.ui.shortHashText}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModernBook({ generations }: { generations: PaperGeneration[] }) {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto p-4 md:p-6" style={PAPER_VARS} data-testid="paper-modern">
      <div
        className="min-h-full min-w-max border p-5 shadow-sm"
        style={{
          ...PAPER_SHEET_STYLE,
          borderColor: "var(--df-paper-line)",
          color: "var(--df-paper-ink)",
          fontFamily: PAPER_BODY_FONT_STACK,
        }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold tracking-normal">
            {t("genealogyBook.styles.modern", "Modern Ledger")}
          </h2>
          <span className="text-sm" style={{ color: "var(--df-paper-muted)" }}>
            {t("genealogyBook.realtime", "Realtime preview")}
          </span>
        </div>
        <div className="flex items-stretch gap-4">
          {generations.map((generation) => (
            <section
              key={generation.depth}
              className="w-72 shrink-0 border"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <div
                className="border-b px-3 py-2 text-sm font-bold"
                style={{
                  borderColor: "var(--df-paper-line-soft)",
                  background: "rgba(138, 106, 59, 0.08)",
                }}
              >
                {generation.label}
              </div>
              <div className="divide-y" style={{ borderColor: "var(--df-paper-line-soft)" }}>
                {generation.people.map((person) => (
                  <article key={person.id} className="px-3 py-3" data-testid={`paper-row-${person.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="min-w-0 truncate" style={{ fontFamily: PAPER_TITLE_FONT_STACK }}>
                        {person.ui.titleText}
                      </strong>
                      <span className="text-xs" style={{ color: "var(--df-paper-red)" }}>
                        {person.depth + 1}.{person.sequence}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-xs leading-5"
                      style={{ color: "var(--df-paper-muted)", fontFamily: PAPER_NOTE_FONT_STACK }}
                    >
                      {person.classicalLines.slice(0, 4).join(" · ") || person.ui.shortHashText}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PaperGenealogyView({
  style,
  graph,
  rootId,
  nodesData,
  hasRoot,
  loading,
  contractMessage,
}: PaperGenealogyViewProps) {
  const { t } = useTranslation();
  const translate = useCallback<TranslateFn>(
    (key, fallback, options) =>
      t(key, {
        defaultValue: fallback,
        ...(options || {}),
      }),
    [t],
  );
  const generations = useMemo(
    () => buildPaperGenerations({ graph, nodesData, t: translate }),
    [graph, nodesData, translate],
  );

  if (!hasRoot || generations.length === 0) {
    return <PaperEmptyState loading={loading} contractMessage={contractMessage} />;
  }

  return (
    <div className="h-full w-full" data-testid="paper-genealogy-view" data-style={style}>
      {style === "ou" ? (
        <OuBook generations={generations} />
      ) : style === "su" ? (
        <SuBook generations={generations} />
      ) : style === "dieji" ? (
        <DiejiBook generations={generations} />
      ) : style === "modern" ? (
        <ModernBook generations={generations} />
      ) : (
        <PaperSvgBook style={style} graph={graph} rootId={rootId} generations={generations} />
      )}
    </div>
  );
}

export default PaperGenealogyView;
