import { useMemo } from "react";
import type { NodeId } from "../../../../../shared/model";
import type { TreeGraphData } from "../../../selectors";
import {
  buildPagodaPaperBook,
  getPagodaGenerationMark,
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

const PAGODA_INK = "#1f1f1f";
const PAGODA_LINE = "#8c8c8c";
const PAGODA_RAIL = "#dedede";
const PAGODA_RAIL_LINE = "#c7c7c7";

function PagodaGuides({ page, t }: { page: PagodaBranchPage; t: TranslateFn }) {
  const railTop = page.guides[0]?.y ?? 120;
  const railBottom = (page.guides[page.guides.length - 1]?.y ?? railTop) + 68;
  const railX = page.width - 82;
  const textX = railX + 12;

  return (
    <g pointerEvents="none">
      <rect
        x={railX}
        y={railTop - 10}
        width={24}
        height={railBottom - railTop + 20}
        fill={PAGODA_RAIL}
        stroke={PAGODA_RAIL_LINE}
        strokeWidth={0.8}
      />
      {page.guides.map((guide) => (
        <g key={guide.depth} data-testid={`paper-pagoda-generation-${guide.depth}`}>
          <text
            x={textX}
            y={guide.y + 11}
            textAnchor="start"
            style={{
              fill: PAGODA_INK,
              fontFamily: PAPER_TITLE_FONT_STACK,
              fontSize: 15,
              fontWeight: 700,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
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
      strokeWidth={1}
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
  const gender = node.nodeData?.gender ?? node.ui.gender;
  if (gender === 2) {
    if (number === 1) return t("genealogyBook.suFirstDaughter", "长女");
    if (number === 2) return t("genealogyBook.suSecondDaughter", "次女");
    return t("genealogyBook.suNthDaughter", "{{number}}女", { number });
  }
  if (number === 1) return t("genealogyBook.suFirstSon", "长子");
  if (number === 2) return t("genealogyBook.suSecondSon", "次子");
  return t("genealogyBook.suNthSon", "{{number}}子", { number });
}

function PagodaPersonNode({ node, t }: { node: PagodaNode; t: TranslateFn }) {
  const name = clipText(node.ui.fullName || node.ui.titleText || node.ui.shortHashText, 7);
  const relationLabel = getPagodaRelationLabel(node, t);

  return (
    <g transform={`translate(${node.x}, ${node.y})`} data-testid={`paper-node-${node.id}`}>
      <title>{node.ui.personHash}</title>
      {relationLabel ? (
        <text
          x={3}
          y={8}
          textAnchor="start"
          style={{
            fill: PAGODA_INK,
            fontFamily: PAPER_NOTE_FONT_STACK,
            fontSize: 8,
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
        >
          {relationLabel}
        </text>
      ) : null}
      <text
        x={node.w / 2 + 6}
        y={6}
        textAnchor="start"
        style={{
          fill: PAGODA_INK,
          fontFamily: PAPER_TITLE_FONT_STACK,
          fontSize: 15,
          fontWeight: 500,
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
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
      <rect
        x={8}
        y={8}
        width={page.width - 16}
        height={page.height - 16}
        fill="none"
        stroke={PAGODA_INK}
        strokeWidth={3}
      />
      <rect
        x={14}
        y={14}
        width={page.width - 28}
        height={page.height - 28}
        fill="none"
        stroke={PAGODA_INK}
        strokeWidth={1}
      />
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
            fill: PAGODA_INK,
            fontFamily: PAPER_NOTE_FONT_STACK,
            fontSize: 12,
          }}
        >
          {branchLabel}
        </text>
      ) : null}
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
