import type { NodeId } from "../../../../../shared/model";
import { computeTreeLayout } from "../../layout/treeLayout";
import type { TreeGraphData } from "../../../selectors";
import {
  PAPER_GENEALOGY_STYLE,
  type PaperGeneration,
  type PaperGenealogyStyle,
  type PaperPerson,
} from "../paperData";

export type SvgPaperNode = PaperPerson & {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SvgPaperEdge = {
  from: NodeId;
  to: NodeId;
};

export type SvgDepthGuide = {
  depth: number;
  x: number;
  y: number;
};

export type SvgPaperLayout = {
  nodes: SvgPaperNode[];
  edges: SvgPaperEdge[];
  guides: SvgDepthGuide[];
  width: number;
  height: number;
};

function buildPersonMap(generations: PaperGeneration[]): Map<NodeId, PaperPerson> {
  const out = new Map<NodeId, PaperPerson>();
  for (const generation of generations) {
    for (const person of generation.people) out.set(person.id, person);
  }
  return out;
}

function buildTreeBackedLayout(
  graph: TreeGraphData,
  rootId: NodeId | null,
  generations: PaperGeneration[],
): SvgPaperLayout {
  const cfg = {
    nodeW: 122,
    nodeH: 132,
    gapX: 42,
    gapY: 178,
    marginX: 70,
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

function buildEmptySvgPaperLayout(): SvgPaperLayout {
  return { nodes: [], edges: [], guides: [], width: 0, height: 0 };
}

type SvgPaperLayoutBuilder = (
  graph: TreeGraphData,
  rootId: NodeId | null,
  generations: PaperGeneration[],
) => SvgPaperLayout;

const SVG_PAPER_LAYOUT_BUILDERS = {
  [PAPER_GENEALOGY_STYLE.OU]: buildEmptySvgPaperLayout,
  [PAPER_GENEALOGY_STYLE.SU]: buildEmptySvgPaperLayout,
  [PAPER_GENEALOGY_STYLE.DIEJI]: buildTreeBackedLayout,
  [PAPER_GENEALOGY_STYLE.LINEAGE]: buildEmptySvgPaperLayout,
  [PAPER_GENEALOGY_STYLE.MODERN]: buildEmptySvgPaperLayout,
} satisfies Record<PaperGenealogyStyle, SvgPaperLayoutBuilder>;

export function buildSvgPaperLayout(params: {
  style: PaperGenealogyStyle;
  graph: TreeGraphData;
  rootId: NodeId | null;
  generations: PaperGeneration[];
}): SvgPaperLayout {
  const { style, graph, rootId, generations } = params;
  return SVG_PAPER_LAYOUT_BUILDERS[style](graph, rootId, generations);
}
