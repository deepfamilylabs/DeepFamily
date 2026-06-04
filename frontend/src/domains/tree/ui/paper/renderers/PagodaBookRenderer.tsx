import { useMemo } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildPagodaPaperBook,
  getPagodaGenerationMark,
  PAGODA_NODE_NAME_MAX_LENGTH,
  PAGODA_NODE_NAME_Y,
  type PagodaBranchPage,
  type PagodaConnector,
  type PagodaNode,
} from "../layout/pagodaPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_LINE,
  PAPER_MARK_BG,
  PAPER_SHEET_STYLE,
  PAPER_TEXT,
  PAPER_VARS,
  paperSvgTextStyle,
} from "../paperStyles";
import { clipText, getChildRankWord } from "../paperText";

// Right-hand generation (世次) column, matching the Ou-style generation column exactly: a tinted
// band (54px) with a left rail and centered black 世 tabs (32x64), divided by horizontal rules.
const PAGODA_GENERATION_BAND_WIDTH = 54;
const PAGODA_GENERATION_MARK_OFFSET_Y = -16;
const PAGODA_GENERATION_SEPARATOR_RATIO = 0.62;
const PAGODA_GENERATION_MARK_WIDTH = 32;
const PAGODA_GENERATION_MARK_HEIGHT = 64;
const PAGODA_NODE_RELATION_GAP = 12;
const PAGODA_CHILD_STEM_NAME_GAP = 8;

// One continuous horizontal rule per generation boundary, spanning the body and the generation
// column (like the Ou band border-b), so the 世次 column reads as stacked cells.
function PagodaGenerationSeparators({ page }: { page: PagodaBranchPage }) {
  const x1 = 48;
  const x2 = page.width;
  const separators = page.guides.slice(1).map((guide, index) => {
    const previous = page.guides[index];
    return {
      depth: guide.depth,
      y: previous.y + (guide.y - previous.y) * PAGODA_GENERATION_SEPARATOR_RATIO,
    };
  });

  return (
    <g pointerEvents="none">
      {separators.map((separator) => (
        <line
          key={separator.depth}
          x1={x1}
          y1={separator.y}
          x2={x2}
          y2={separator.y}
          stroke={PAPER_LINE.soft}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          data-testid={`paper-pagoda-generation-separator-${separator.depth}`}
        />
      ))}
    </g>
  );
}

// The tinted background wash for the 世次 column; rendered first so the separators above read as
// cell dividers across it.
function PagodaGenerationBand({ page }: { page: PagodaBranchPage }) {
  const bandLeftX = page.width - PAGODA_GENERATION_BAND_WIDTH;
  return (
    <rect
      x={bandLeftX}
      y={0}
      width={PAGODA_GENERATION_BAND_WIDTH}
      height={page.height}
      fill={PAPER_LINE.tint}
      data-testid="paper-pagoda-generation-band-bg"
    />
  );
}

function PagodaGuides({ page, t }: { page: PagodaBranchPage; t: TranslateFn }) {
  const bandLeftX = page.width - PAGODA_GENERATION_BAND_WIDTH;
  const markX = bandLeftX + (PAGODA_GENERATION_BAND_WIDTH - PAGODA_GENERATION_MARK_WIDTH) / 2;
  const textX = markX + PAGODA_GENERATION_MARK_WIDTH / 2;

  return (
    <g pointerEvents="none">
      <line
        x1={bandLeftX}
        y1={0}
        x2={bandLeftX}
        y2={page.height}
        stroke={PAPER_LINE.soft}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        data-testid="paper-pagoda-generation-rail"
      />
      {page.guides.map((guide) => {
        const markY = guide.y + PAGODA_GENERATION_MARK_OFFSET_Y;
        return (
          <g key={guide.depth} data-testid={`paper-pagoda-generation-${guide.depth}`}>
            <rect
              x={markX}
              y={markY}
              width={PAGODA_GENERATION_MARK_WIDTH}
              height={PAGODA_GENERATION_MARK_HEIGHT}
              fill={PAPER_MARK_BG}
              data-testid={`paper-pagoda-generation-mark-bg-${guide.depth}`}
            />
            <text
              x={textX}
              y={markY + 11}
              textAnchor="start"
              style={{
                ...paperSvgTextStyle("generationMark"),
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
              data-testid={`paper-pagoda-generation-mark-${guide.depth}`}
            >
              {getPagodaGenerationMark(guide.depth, t)}
            </text>
            {guide.repeated ? (
              <text
                x={textX}
                y={markY + PAGODA_GENERATION_MARK_HEIGHT + 4}
                textAnchor="start"
                style={{
                  ...paperSvgTextStyle("tag"),
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                }}
                data-testid={`paper-pagoda-repeated-${guide.depth}`}
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

function PagodaConnectorLines({
  connector,
  nodeById,
}: {
  connector: PagodaConnector;
  nodeById: Map<NodeId, PagodaNode>;
}) {
  const children = connector.childIds
    .map((childId) => nodeById.get(childId))
    .filter(Boolean) as PagodaNode[];

  return (
    <g
      data-testid={`paper-pagoda-connector-${connector.parentId}`}
      fill="none"
      stroke={PAPER_LINE.strong}
      strokeWidth={1.1}
      strokeLinecap="square"
    >
      <line
        x1={connector.parentCenterX}
        y1={connector.parentBottomY}
        x2={connector.parentCenterX}
        y2={connector.horizontalY}
      />
      <line
        x1={connector.horizontalStartX}
        y1={connector.horizontalY}
        x2={connector.horizontalEndX}
        y2={connector.horizontalY}
      />
      {children.map((child) => {
        const childCenterX = child.x + child.w / 2;
        return (
          <line
            key={child.id}
            x1={childCenterX}
            y1={connector.horizontalY}
            x2={childCenterX}
            y2={child.y + PAGODA_NODE_NAME_Y - PAGODA_CHILD_STEM_NAME_GAP}
            data-testid={`paper-pagoda-child-stem-${child.id}`}
          />
        );
      })}
    </g>
  );
}

function getPagodaRelationLabel(node: PagodaNode, t: TranslateFn): string {
  if (node.branchRoot) return "";
  // The pagoda tree shows parentage structurally, so only the rank word is needed (no name).
  return getChildRankWord(node, t);
}

function PagodaPersonNode({ node }: { node: PagodaNode }) {
  const name = clipText(
    node.ui.fullName || node.ui.titleText || node.ui.shortHashText,
    PAGODA_NODE_NAME_MAX_LENGTH,
  );
  const centerX = node.w / 2;

  return (
    <g transform={`translate(${node.x}, ${node.y})`} data-testid={`paper-node-${node.id}`}>
      <title>{node.ui.personHash}</title>
      <text
        x={centerX}
        y={PAGODA_NODE_NAME_Y}
        textAnchor="start"
        style={{
          ...paperSvgTextStyle("name"),
          letterSpacing: 0,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          textAlign: "right",
        }}
        data-testid={`paper-pagoda-name-${node.id}`}
      >
        {name}
      </text>
    </g>
  );
}

function PagodaRelationLabels({
  connectors,
  nodeById,
  t,
}: {
  connectors: PagodaConnector[];
  nodeById: Map<NodeId, PagodaNode>;
  t: TranslateFn;
}) {
  return (
    <g data-testid="paper-pagoda-relation-layer" pointerEvents="none">
      {connectors.flatMap((connector) =>
        connector.childIds.flatMap((childId) => {
          const child = nodeById.get(childId);
          if (!child) return [];

          const relationLabel = getPagodaRelationLabel(child, t);
          if (!relationLabel) return [];

          const childCenterX = child.x + child.w / 2;
          const stemEndY = child.y + PAGODA_NODE_NAME_Y - PAGODA_CHILD_STEM_NAME_GAP;
          const relationX = childCenterX - PAGODA_NODE_RELATION_GAP;
          const relationY = connector.horizontalY + (stemEndY - connector.horizontalY) / 2 - 10;
          return (
            <g
              key={`${connector.parentId}-${child.id}`}
              transform={`translate(${relationX}, ${relationY})`}
              data-testid={`paper-pagoda-relation-position-${child.id}`}
            >
              <text
                x={0}
                y={0}
                textAnchor="start"
                style={{
                  ...paperSvgTextStyle("relation"),
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                }}
                data-testid={`paper-pagoda-relation-${child.id}`}
              >
                {relationLabel}
              </text>
            </g>
          );
        }),
      )}
    </g>
  );
}

function PagodaPageSvg({ page, t }: { page: PagodaBranchPage; t: TranslateFn }) {
  const nodeById = useMemo(() => new Map(page.nodes.map((node) => [node.id, node])), [page.nodes]);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      className="block h-full w-full max-w-none shrink-0"
      data-testid={`paper-pagoda-page-${page.chartIndex}-${page.index}`}
      role="img"
      aria-label={page.title}
    >
      <PagodaGenerationBand page={page} />
      <PagodaGenerationSeparators page={page} />
      <PagodaGuides page={page} t={t} />
      <g>
        {page.connectors.map((connector) => (
          <PagodaConnectorLines
            key={`${connector.parentId}-${connector.childIds.join(":")}`}
            connector={connector}
            nodeById={nodeById}
          />
        ))}
      </g>
      <g>
        {page.nodes.map((node) => (
          <PagodaPersonNode key={node.id} node={node} />
        ))}
      </g>
      <PagodaRelationLabels connectors={page.connectors} nodeById={nodeById} t={t} />
    </svg>
  );
}

export function PagodaBookRenderer({
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
  const book = useMemo(
    () => buildPagodaPaperBook({ graph, rootId, generations, t }),
    [graph, rootId, generations, t],
  );
  const pageItems = useMemo(
    () => book.charts.flatMap((chart) => chart.pages),
    [book],
  );

  return (
    <div
      className="h-full overflow-auto p-4 md:p-6"
      style={PAPER_VARS}
      data-testid="paper-svg-pagoda"
    >
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
        data-testid="paper-pagoda"
      >
        {pageItems.length ? (
          <section
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: PAPER_LINE.strong,
            }}
            data-testid="paper-pagoda-chart-1"
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: PAPER_LINE.soft }}
            >
              <h2 className="tracking-normal" style={{ ...PAPER_TEXT.sectionTitle }}>
                {t("genealogyBook.styles.pagoda", "Pagoda")}
              </h2>
              <span style={{ ...PAPER_TEXT.sectionRule }}>
                {t(
                  "genealogyBook.pagodaTableRule",
                  "Five generations per chart, ancestor above, branches descend by level.",
                )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {pageItems.map((page) => (
                <div
                  key={`${page.chartIndex}-${page.index}`}
                  className="h-[872px] min-w-[1180px] shrink-0 border"
                  style={{
                    borderColor: PAPER_LINE.strong,
                    background: "var(--df-paper-sheet)",
                  }}
                  data-testid={`paper-pagoda-frame-${page.chartIndex}-${page.index}`}
                >
                  <PagodaPageSvg page={page} t={t} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
