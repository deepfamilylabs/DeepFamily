import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import GraphViewport from "../../GraphViewport";
import useZoom from "../../useZoom";
import {
  buildSvgPaperLayout,
  type SvgPaperEdge,
  type SvgPaperLayout,
  type SvgPaperNode,
} from "../layout/svgPaperLayout";
import {
  PAPER_GENEALOGY_STYLE,
  type PaperGeneration,
  type PaperGenealogyStyle,
} from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import { clipText } from "../paperText";

type SvgGuideConfig = {
  orientation: "vertical" | "horizontal";
  showVolumeLabel: boolean;
};

const SVG_GUIDE_CONFIG = {
  [PAPER_GENEALOGY_STYLE.OU]: { orientation: "vertical", showVolumeLabel: true },
  [PAPER_GENEALOGY_STYLE.DIEJI]: { orientation: "horizontal", showVolumeLabel: false },
  [PAPER_GENEALOGY_STYLE.PAGODA]: { orientation: "horizontal", showVolumeLabel: false },
  [PAPER_GENEALOGY_STYLE.LINEAGE]: { orientation: "horizontal", showVolumeLabel: false },
  [PAPER_GENEALOGY_STYLE.MODERN]: { orientation: "horizontal", showVolumeLabel: false },
} satisfies Record<PaperGenealogyStyle, SvgGuideConfig>;

type SvgEdgeConfig =
  | { route: "side" }
  | {
      route: "down";
      minMidY: number;
    };

const SVG_EDGE_CONFIG = {
  [PAPER_GENEALOGY_STYLE.OU]: { route: "side" },
  [PAPER_GENEALOGY_STYLE.DIEJI]: { route: "down", minMidY: 24 },
  [PAPER_GENEALOGY_STYLE.PAGODA]: { route: "down", minMidY: 18 },
  [PAPER_GENEALOGY_STYLE.LINEAGE]: { route: "down", minMidY: 18 },
  [PAPER_GENEALOGY_STYLE.MODERN]: { route: "down", minMidY: 18 },
} satisfies Record<PaperGenealogyStyle, SvgEdgeConfig>;

type SvgNodeConfig = {
  titleMaxLength: number;
  detailLineCount: number;
  lineHeight: number;
  titleY: number;
  rectRx: number;
  titleFontSize: number;
  verticalText: boolean;
  showTopStem: boolean;
  detailY: number;
  detailTextAnchor: "start" | "middle";
  detailMaxLength: number;
  stackDetailColumns: boolean;
  getDetailTextX: (node: SvgPaperNode) => number;
  getDetailLineX: (node: SvgPaperNode, index: number) => number;
};

const SVG_NODE_CONFIG = {
  [PAPER_GENEALOGY_STYLE.OU]: {
    titleMaxLength: 16,
    detailLineCount: 5,
    lineHeight: 16,
    titleY: 24,
    rectRx: 2,
    titleFontSize: 16,
    verticalText: false,
    showTopStem: false,
    detailY: 48,
    detailTextAnchor: "start",
    detailMaxLength: 22,
    stackDetailColumns: false,
    getDetailTextX: () => 14,
    getDetailLineX: () => 14,
  },
  [PAPER_GENEALOGY_STYLE.DIEJI]: {
    titleMaxLength: 10,
    detailLineCount: 4,
    lineHeight: 17,
    titleY: 32,
    rectRx: 10,
    titleFontSize: 15,
    verticalText: true,
    showTopStem: true,
    detailY: 58,
    detailTextAnchor: "middle",
    detailMaxLength: 14,
    stackDetailColumns: true,
    getDetailTextX: (node) => node.w / 2 + 28,
    getDetailLineX: (node, index) => node.w / 2 + 28 - index * 15,
  },
  [PAPER_GENEALOGY_STYLE.PAGODA]: {
    titleMaxLength: 16,
    detailLineCount: 3,
    lineHeight: 16,
    titleY: 30,
    rectRx: 2,
    titleFontSize: 16,
    verticalText: false,
    showTopStem: false,
    detailY: 54,
    detailTextAnchor: "middle",
    detailMaxLength: 14,
    stackDetailColumns: false,
    getDetailTextX: (node) => node.w / 2,
    getDetailLineX: (node) => node.w / 2,
  },
  [PAPER_GENEALOGY_STYLE.LINEAGE]: {
    titleMaxLength: 16,
    detailLineCount: 5,
    lineHeight: 16,
    titleY: 24,
    rectRx: 2,
    titleFontSize: 16,
    verticalText: false,
    showTopStem: false,
    detailY: 48,
    detailTextAnchor: "middle",
    detailMaxLength: 14,
    stackDetailColumns: false,
    getDetailTextX: (node) => node.w / 2,
    getDetailLineX: (node) => node.w / 2,
  },
  [PAPER_GENEALOGY_STYLE.MODERN]: {
    titleMaxLength: 16,
    detailLineCount: 5,
    lineHeight: 16,
    titleY: 24,
    rectRx: 2,
    titleFontSize: 16,
    verticalText: false,
    showTopStem: false,
    detailY: 48,
    detailTextAnchor: "middle",
    detailMaxLength: 14,
    stackDetailColumns: false,
    getDetailTextX: (node) => node.w / 2,
    getDetailLineX: (node) => node.w / 2,
  },
} satisfies Record<PaperGenealogyStyle, SvgNodeConfig>;

function PaperSvgGuides({
  style,
  layout,
}: {
  style: PaperGenealogyStyle;
  layout: SvgPaperLayout;
}) {
  const { t } = useTranslation();
  const guideConfig = SVG_GUIDE_CONFIG[style];
  return (
    <g pointerEvents="none">
      {layout.guides.map((guide) => {
        const generationText = t("genealogyBook.generationLabel", "Generation {{number}}", {
          number: guide.depth + 1,
        });
        const isVolumeBoundary = guideConfig.showVolumeLabel && guide.depth % 5 === 0;
        const volumeText = isVolumeBoundary
          ? t("genealogyBook.volumeLabel", "Volume {{number}}", {
              number: Math.floor(guide.depth / 5) + 1,
            })
          : "";
        if (guideConfig.orientation === "vertical") {
          return (
            <g key={guide.depth}>
              <line
                x1={guide.x}
                y1={54}
                x2={guide.x}
                y2={layout.height - 36}
                stroke="var(--df-paper-line-soft)"
                strokeDasharray={isVolumeBoundary ? "0" : "4 8"}
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
  const edgeConfig = SVG_EDGE_CONFIG[style];
  return (
    <g fill="none" stroke="var(--df-paper-line)" strokeWidth={1.4} strokeOpacity={0.78}>
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        if (edgeConfig.route === "side") {
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
        const midY = y1 + Math.max(edgeConfig.minMidY, (y2 - y1) / 2);
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
  const nodeConfig = SVG_NODE_CONFIG[style];
  const title = clipText(node.ui.titleText || node.ui.shortHashText, nodeConfig.titleMaxLength);
  const details = node.classicalLines.slice(0, nodeConfig.detailLineCount);

  return (
    <g transform={`translate(${node.x}, ${node.y})`} data-testid={`paper-node-${node.id}`}>
      <title>{node.ui.personHash}</title>
      {nodeConfig.showTopStem ? (
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
        rx={nodeConfig.rectRx}
        ry={nodeConfig.rectRx}
        fill="var(--df-paper-panel)"
        stroke="var(--df-paper-line)"
        strokeWidth={1.2}
      />
      <rect
        x={6}
        y={6}
        width={node.w - 12}
        height={node.h - 12}
        rx={Math.max(1, nodeConfig.rectRx - 1)}
        ry={Math.max(1, nodeConfig.rectRx - 1)}
        fill="none"
        stroke="var(--df-paper-line-soft)"
        strokeWidth={0.8}
      />
      <text
        x={node.w / 2}
        y={nodeConfig.titleY}
        textAnchor="middle"
        style={{
          fill: "var(--df-paper-ink)",
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: nodeConfig.titleFontSize,
          fontWeight: 700,
          writingMode: nodeConfig.verticalText ? "vertical-rl" : undefined,
          textOrientation: nodeConfig.verticalText ? "mixed" : undefined,
        }}
      >
        {title}
      </text>
      <text
        x={nodeConfig.getDetailTextX(node)}
        y={nodeConfig.detailY}
        textAnchor={nodeConfig.detailTextAnchor}
        style={{
          fill: "var(--df-paper-muted)",
          fontFamily: PAPER_NOTE_FONT_STACK,
          fontSize: 12,
          writingMode: nodeConfig.verticalText ? "vertical-rl" : undefined,
          textOrientation: nodeConfig.verticalText ? "mixed" : undefined,
        }}
      >
        {details.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={nodeConfig.getDetailLineX(node, index)}
            dy={nodeConfig.stackDetailColumns || index === 0 ? 0 : nodeConfig.lineHeight}
          >
            {clipText(line, nodeConfig.detailMaxLength)}
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

export function SvgPaperRenderer({
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
