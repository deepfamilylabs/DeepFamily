import { useMemo } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildPagodaPaperBook,
  getPagodaGenerationMark,
  toChineseNumeral,
  type PagodaBranchPage,
  type PagodaConnector,
  type PagodaNode,
} from "../layout/pagodaPagination";
import type { PaperGeneration, TranslateFn } from "../paperData";
import {
  PAPER_BODY_FONT_STACK,
  PAPER_NOTE_FONT_STACK,
  PAPER_SHEET_STYLE,
  PAPER_TITLE_FONT_STACK,
  PAPER_VARS,
} from "../paperStyles";
import { clipText } from "../paperText";

const PAGODA_INK = "var(--df-paper-ink)";
const PAGODA_MUTED = "var(--df-paper-muted)";
const PAGODA_RED = "var(--df-paper-red)";
const PAGODA_LINE = "var(--df-paper-line)";
const PAGODA_LINE_SOFT = "var(--df-paper-line-soft)";
const PAGODA_GENERATION_MARK_BG = "#1f1a14";
const PAGODA_GENERATION_MARK_FG = "#f7efd8";
const PAGODA_GENERATION_MARK_OFFSET_RIGHT = 58;
const PAGODA_GENERATION_MARK_WIDTH = 24;
const PAGODA_GENERATION_MARK_HEIGHT = 68;
const PAGODA_NODE_NAME_FONT_SIZE = 19;
const PAGODA_NODE_RELATION_FONT_SIZE = 11;
const PAGODA_NODE_RELATION_GAP = 20;

function PagodaGenerationSeparators({ page }: { page: PagodaBranchPage }) {
  const railX = page.width - PAGODA_GENERATION_MARK_OFFSET_RIGHT;
  const x1 = 48;
  const x2 = railX - 24;
  const separators = page.guides.slice(1).map((guide, index) => {
    const previous = page.guides[index];
    return {
      depth: guide.depth,
      y: (previous.y + guide.y) / 2,
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
          stroke={PAGODA_LINE_SOFT}
          strokeWidth={0.6}
          strokeOpacity={0.35}
          data-testid={`paper-pagoda-generation-separator-${separator.depth}`}
        />
      ))}
    </g>
  );
}

function PagodaGuides({ page, t }: { page: PagodaBranchPage; t: TranslateFn }) {
  const railX = page.width - PAGODA_GENERATION_MARK_OFFSET_RIGHT;
  const textX = railX + 12;

  return (
    <g pointerEvents="none">
      {page.guides.map((guide) => (
        <g key={guide.depth} data-testid={`paper-pagoda-generation-${guide.depth}`}>
          <rect
            x={railX}
            y={guide.y}
            width={PAGODA_GENERATION_MARK_WIDTH}
            height={PAGODA_GENERATION_MARK_HEIGHT}
            fill={PAGODA_GENERATION_MARK_BG}
            data-testid={`paper-pagoda-generation-mark-bg-${guide.depth}`}
          />
          <text
            x={textX}
            y={guide.y + 11}
            textAnchor="start"
            style={{
              fill: PAGODA_GENERATION_MARK_FG,
              fontFamily: PAPER_TITLE_FONT_STACK,
              fontSize: 15,
              fontWeight: 700,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
            data-testid={`paper-pagoda-generation-mark-${guide.depth}`}
          >
            {getPagodaGenerationMark(guide.depth, t)}
          </text>
        </g>
      ))}
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
      stroke={PAGODA_LINE}
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
            y2={child.y}
          />
        );
      })}
    </g>
  );
}

function getPagodaRelationLabel(node: PagodaNode, t: TranslateFn): string {
  if (node.branchRoot) return "";
  if (node.relation?.kind !== "child") return "";

  const number = node.relation.siblingIndex + 1;
  const han = toChineseNumeral(number);
  const gender = node.nodeData?.gender ?? node.ui.gender;
  if (gender === 2) {
    if (number === 1) return t("genealogyBook.suFirstDaughter", "长女");
    if (number === 2) return t("genealogyBook.suSecondDaughter", "次女");
    return t("genealogyBook.suNthDaughter", "{{han}}女", { han, number });
  }
  if (number === 1) return t("genealogyBook.suFirstSon", "长子");
  if (number === 2) return t("genealogyBook.suSecondSon", "次子");
  return t("genealogyBook.suNthSon", "{{han}}子", { han, number });
}

function PagodaPersonNode({ node, t }: { node: PagodaNode; t: TranslateFn }) {
  const name = clipText(node.ui.fullName || node.ui.titleText || node.ui.shortHashText, 10);
  const relationLabel = getPagodaRelationLabel(node, t);
  const centerX = node.w / 2;

  return (
    <g transform={`translate(${node.x}, ${node.y})`} data-testid={`paper-node-${node.id}`}>
      <title>{node.ui.personHash}</title>
      {relationLabel ? (
        <text
          x={centerX - PAGODA_NODE_RELATION_GAP}
          y={6}
          textAnchor="start"
          style={{
            fill: PAGODA_MUTED,
            fontFamily: PAPER_NOTE_FONT_STACK,
            fontSize: PAGODA_NODE_RELATION_FONT_SIZE,
            fontWeight: 700,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          data-testid={`paper-pagoda-relation-${node.id}`}
        >
          {relationLabel}
        </text>
      ) : null}
      <text
        x={centerX}
        y={6}
        textAnchor="start"
        style={{
          fill: PAGODA_INK,
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: PAGODA_NODE_NAME_FONT_SIZE,
          fontWeight: 700,
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

function PagodaPageSvg({ page, t }: { page: PagodaBranchPage; t: TranslateFn }) {
  const nodeById = useMemo(() => new Map(page.nodes.map((node) => [node.id, node])), [page.nodes]);
  const branchLabel =
    page.kind === "branch"
      ? t("genealogyBook.pagodaBranchPage", "第 {{number}} 支", {
          number: page.branchIndex,
        })
      : "";

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      className="block h-full w-full max-w-none shrink-0"
      data-testid={`paper-pagoda-page-${page.chartIndex}-${page.index}`}
      role="img"
      aria-label={`${page.title} ${branchLabel}`}
    >
      <text
        x={page.width / 2}
        y={72}
        textAnchor="middle"
        style={{
          fill: PAGODA_INK,
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: 21,
          fontWeight: 400,
        }}
      >
        {page.title}
      </text>
      {branchLabel ? (
        <text
          x={page.width - 68}
          y={50}
          textAnchor="middle"
          style={{
            fill: PAGODA_RED,
            fontFamily: PAPER_NOTE_FONT_STACK,
            fontSize: 12,
          }}
        >
          {branchLabel}
        </text>
      ) : null}
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
          <PagodaPersonNode key={node.id} node={node} t={t} />
        ))}
      </g>
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

  return (
    <div
      className="h-full overflow-auto p-4 md:p-6"
      style={PAPER_VARS}
      data-testid="paper-svg-pagoda"
    >
      <div
        className="mx-auto flex min-h-full max-w-[1320px] flex-col gap-7"
        style={{ color: "var(--df-paper-ink)", fontFamily: PAPER_BODY_FONT_STACK }}
        data-testid="paper-pagoda"
      >
        {book.charts.map((chart) => (
          <section
            key={chart.index}
            className="border p-3 shadow-sm md:p-5"
            style={{
              ...PAPER_SHEET_STYLE,
              borderColor: "var(--df-paper-line)",
            }}
            data-testid={`paper-pagoda-chart-${chart.index}`}
          >
            <div
              className="mb-3 flex items-center justify-between gap-4 border-b pb-3"
              style={{ borderColor: "var(--df-paper-line-soft)" }}
            >
              <h2
                className="text-xl font-bold tracking-normal"
                style={{ fontFamily: PAPER_TITLE_FONT_STACK }}
              >
                {t("genealogyBook.styles.pagoda", "Pagoda")}
              </h2>
              <span className="text-sm font-bold" style={{ color: "var(--df-paper-red)" }}>
                {chart.repeatedDepth !== undefined
                  ? t(
                      "genealogyBook.pagodaOverlapNote",
                      "This chart repeats the previous chart's boundary generation.",
                    )
                  : t(
                      "genealogyBook.pagodaTableRule",
                      "Six generations per chart, ancestor above, branches descend by level.",
                    )}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {chart.pages.map((page) => (
                <div
                  key={`${page.chartIndex}-${page.index}`}
                  className="h-[872px] min-w-[1180px] shrink-0 border"
                  style={{
                    borderColor: "var(--df-paper-line)",
                    background: "var(--df-paper-sheet)",
                  }}
                  data-testid={`paper-pagoda-frame-${page.chartIndex}-${page.index}`}
                >
                  <PagodaPageSvg page={page} t={t} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
