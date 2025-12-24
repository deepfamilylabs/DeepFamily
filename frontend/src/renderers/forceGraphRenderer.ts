import * as d3 from "d3";
import type { ForceLink, ForceNode } from "../types/familyTreeTypes";
import type { TreeGraphData } from "../utils/treeData";
import type { NodeUi } from "../utils/familyTreeNodeUi";
import { getGenderColorHex } from "../constants/genderColors";
import { getFamilyTreeNodeTheme } from "../utils/familyTreeTheme";
import { createFamilyTreeForceSimulation, DEFAULT_FORCE_LAYOUT } from "../layout/forceLayout";

function buildStarPath(cx: number, cy: number, spikes = 5, outerR = 4, innerR = 2): string {
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  let path = "";
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(rot) * r;
    const y = cy + Math.sin(rot) * r;
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    rot += step;
  }
  path += " Z";
  return path;
}

export function buildForceGraphSimData(graph: TreeGraphData): {
  nodes: ForceNode[];
  links: ForceLink[];
} {
  const nodes: ForceNode[] = graph.nodes.map((n) => ({
    id: n.id,
    personHash: n.personHash,
    versionIndex: n.versionIndex,
    depth: n.depth,
  }));
  const links: ForceLink[] = graph.edges.map((e) => ({
    from: e.from,
    to: e.to,
    source: e.from,
    target: e.to,
  }));
  return { nodes, links };
}

export function buildForceGraphStructureKey(graph: TreeGraphData) {
  const n = graph.nodes.map((x) => x.id).join("|");
  const e = graph.edges.map((x) => `${x.from}>${x.to}`).join("|");
  return `${n}::${e}`;
}

export type ForceGraphMiniNode = { id: string; x: number; y: number };

export type ForceGraphScene = {
  stop: () => void;
  updateUi: (nodeUiById: Record<string, NodeUi>, selectedId: string | null) => void;
  getMiniMapNodes: () => ForceGraphMiniNode[];
  getNodePosition: (id: string) => { x: number; y: number } | null;
  simulation: d3.Simulation<ForceNode, ForceLink>;
};

export function mountForceGraphScene(params: {
  svgEl: SVGSVGElement;
  rootEl: SVGGElement;
  graph: TreeGraphData;
  nodeUiById: Record<string, NodeUi>;
  selectedId: string | null;
  drawNodeR: number;
  collideNodeR: number;
  height: number;
  actions: {
    openNodeById: (id: any) => void;
    openEndorseById: (id: any) => void;
    copyHash: (personHash: string) => void;
  };
  prevNodes?: ForceNode[];
  onTick?: () => void;
}): ForceGraphScene {
  const {
    svgEl,
    rootEl,
    graph,
    nodeUiById,
    selectedId,
    actions,
    drawNodeR,
    collideNodeR,
    height,
    prevNodes,
    onTick,
  } = params;
  const data = buildForceGraphSimData(graph);
  const svg = d3.select(svgEl);
  const root = d3.select(rootEl);

  // Ensure marker defs exist once
  let defs = svg.select<SVGDefsElement>("defs");
  if (defs.empty()) defs = svg.append("defs");
  const markerSel = defs.select("#fd-arrow");
  if (markerSel.empty()) {
    const m = defs
      .append("marker")
      .attr("id", "fd-arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 10)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse");
    m.append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("fill", "#60a5fa");
  }

  const linkLayer = (() => {
    const sel = root.select<SVGGElement>('g[data-ft-layer="links"]');
    return sel.empty() ? root.append("g").attr("data-ft-layer", "links") : sel;
  })();
  linkLayer.attr("stroke", "#93c5fd").attr("stroke-width", 2).attr("stroke-opacity", 0.7);

  const linkKey = (d: any) => `${(d as ForceLink).from}->${(d as ForceLink).to}`;
  const linkSel = linkLayer
    .selectAll<SVGLineElement, ForceLink>("line")
    .data(data.links, linkKey as any);
  linkSel.exit().remove();
  const link = (linkSel.enter().append("line").attr("marker-end", "url(#fd-arrow)") as any).merge(
    linkSel as any,
  );

  const nodeLayer = (() => {
    const sel = root.select<SVGGElement>('g[data-ft-layer="nodes"]');
    return sel.empty() ? root.append("g").attr("data-ft-layer", "nodes") : sel;
  })();

  const nodeSel = nodeLayer
    .selectAll<SVGGElement, ForceNode>('g[data-ft-node="1"]')
    .data(data.nodes, (d: any) => (d as ForceNode).id);
  nodeSel.exit().remove();

  const nodeEnter = nodeSel
    .enter()
    .append("g")
    .attr("class", "cursor-pointer")
    .attr("data-ft-node", "1");
  const node = (nodeEnter as any).merge(nodeSel as any);

  const depthAccentColor = d3.scaleOrdinal(d3.schemeTableau10);

  nodeEnter.append("circle").attr("r", drawNodeR).attr("data-ft", "base").attr("opacity", 0.95);
  nodeEnter
    .append("circle")
    .attr("data-ft", "depth")
    .attr("stroke", "none")
    .style("pointer-events", "none");
  nodeEnter
    .append("circle")
    .attr("r", 3)
    .attr("cx", drawNodeR - 5)
    .attr("cy", -(drawNodeR - 5))
    .attr("data-ft", "genderDot")
    .attr("class", "stroke-white dark:stroke-slate-50")
    .attr("stroke-width", 0.5);

  nodeEnter.append("title").text((d: any) => (d as ForceNode).personHash);

  const lbl = nodeEnter.append("text").attr("class", "font-mono");
  lbl.each(function (d: any) {
    const gtxt = d3.select(this);
    const sim = d as ForceNode;
    const width = 60;
    gtxt
      .append("tspan")
      .attr("data-ft", "shortHash")
      .attr("x", 12)
      .attr("y", -3)
      .attr("font-size", 11);
    gtxt
      .append("tspan")
      .attr("data-ft", "version")
      .attr("x", 25 + width)
      .attr("y", -3)
      .attr("text-anchor", "end")
      .attr("font-size", 11);
    gtxt
      .append("tspan")
      .attr("data-ft", "fullName")
      .attr("x", 12)
      .attr("y", 12)
      .attr("font-size", 11);
  });

  nodeEnter.on("click", (_e: any, d: any) => {
    actions.openNodeById((d as ForceNode).id as any);
  });
  nodeEnter.on("dblclick", (_e: any, d: any) => {
    actions.copyHash((d as ForceNode).personHash);
  });

  // Preserve positions across rebuilds to avoid "jump".
  if (Array.isArray(prevNodes) && prevNodes.length) {
    const byId = new Map<string, any>();
    for (const pn of prevNodes) if ((pn as any)?.id) byId.set(String((pn as any).id), pn);
    for (const n of data.nodes as any[]) {
      const pn = byId.get(String(n.id));
      if (!pn) continue;
      if (typeof pn.x === "number") n.x = pn.x;
      if (typeof pn.y === "number") n.y = pn.y;
      if (typeof pn.vx === "number") n.vx = pn.vx;
      if (typeof pn.vy === "number") n.vy = pn.vy;
    }
  }

  const simulation = createFamilyTreeForceSimulation({
    nodes: data.nodes,
    links: data.links,
    height,
    nodeRadius: collideNodeR,
    config: DEFAULT_FORCE_LAYOUT,
  });

  const drag = d3
    .drag<SVGGElement, ForceNode>()
    .on("start", (event: any, d: ForceNode) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      (d as any).fx = d.x;
      (d as any).fy = d.y;
    })
    .on("drag", (event: any, d: ForceNode) => {
      (d as any).fx = event.x;
      (d as any).fy = event.y;
    })
    .on("end", (_event: any, d: ForceNode) => {
      (d as any).fx = null;
      (d as any).fy = null;
      simulation.alphaTarget(0);
    });

  nodeEnter.call(drag);

  simulation.on("tick", () => {
    link
      .attr("x1", (d: any) => (d.source as any).x)
      .attr("y1", (d: any) => (d.source as any).y)
      .attr("x2", (d: any) => (d.target as any).x)
      .attr("y2", (d: any) => (d.target as any).y);
    node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    onTick?.();
  });

  const updateUi = (uiById: Record<string, NodeUi>, selId: string | null) => {
    const nodeGroups = root.selectAll<SVGGElement, ForceNode>('g[data-ft-node="1"]');
    nodeGroups.each(function (d: any) {
      const sim = d as ForceNode;
      const id = sim.id as any;
      const ui = uiById[id];
      if (!ui) return;
      const theme = getFamilyTreeNodeTheme({ minted: Boolean(ui.minted), selected: id === selId });
      const g = d3.select(this);

      g.select<SVGCircleElement>('circle[data-ft="base"]')
        .attr("class", theme.baseShapeClass)
        .attr("stroke-width", theme.baseShapeStrokeWidth);

      g.select<SVGCircleElement>('circle[data-ft="depth"]')
        .attr("r", Math.max(1, drawNodeR - theme.baseShapeStrokeWidth / 2 - 0.6))
        .attr("fill", depthAccentColor(String(sim.depth)) as string)
        .attr("fill-opacity", id === selId ? 0.12 : 0.18);

      g.select<SVGCircleElement>('circle[data-ft="genderDot"]').attr(
        "fill",
        getGenderColorHex(ui.gender),
      );

      g.select<SVGTSpanElement>('tspan[data-ft="shortHash"]')
        .attr("class", theme.shortHashText.svg)
        .text(ui.shortHashText || "");

      g.select<SVGTSpanElement>('tspan[data-ft="version"]')
        .attr("class", theme.versionText.svg)
        .text(ui.versionTextWithTotal || "");

      g.select<SVGTSpanElement>('tspan[data-ft="fullName"]')
        .attr("class", theme.titleText.svg)
        .text(ui.fullName || "")
        .style("display", ui.fullName ? "inline" : "none");

      const endorsementCount = ui.endorsementCount;
      const shouldShowEndorse = typeof endorsementCount === "number" && Boolean(ui.fullName);
      const existingBadge = g.select<SVGGElement>('g[data-ft="endorse"]');

      if (!shouldShowEndorse) {
        if (!existingBadge.empty()) existingBadge.remove();
        return;
      }

      const txt = String(endorsementCount);
      const badgeW = Math.max(20, 8 + txt.length * 5);
      const width = 60;
      const x = 25 + width - badgeW;
      const y = 1;
      const cx = x + 6;
      const cy = y + 6;
      const starPath = buildStarPath(cx, cy);

      const badge = existingBadge.empty()
        ? g.append("g").attr("data-ft", "endorse")
        : existingBadge;

      if (existingBadge.empty()) {
        badge.append("rect").attr("data-ft", "endorseBg").attr("rx", 6).attr("ry", 6);
        badge.append("path").attr("data-ft", "endorseStar");
        badge
          .append("text")
          .attr("data-ft", "endorseText")
          .attr("text-anchor", "start")
          .attr("font-size", 8)
          .attr("font-family", "monospace");
        badge
          .append("rect")
          .attr("data-ft", "endorseHit")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("fill", "transparent")
          .style("cursor", "pointer")
          .on("click", (event: any) => {
            event?.stopPropagation?.();
            actions.openEndorseById(id);
          });
      }

      badge
        .select<SVGRectElement>('rect[data-ft="endorseBg"]')
        .attr("x", x)
        .attr("y", y)
        .attr("width", badgeW)
        .attr("height", 12)
        .attr("class", `${theme.endorseBadgeBgClass} stroke-transparent`);

      badge
        .select<SVGPathElement>('path[data-ft="endorseStar"]')
        .attr("d", starPath)
        .attr("class", theme.endorseStarClass);

      badge
        .select<SVGTextElement>('text[data-ft="endorseText"]')
        .attr("x", x + 12)
        .attr("y", y + 8)
        .attr("class", theme.endorseCountText.svg)
        .text(txt);

      badge
        .select<SVGRectElement>('rect[data-ft="endorseHit"]')
        .attr("x", x)
        .attr("y", y)
        .attr("width", badgeW)
        .attr("height", 12);
    });
  };

  // Initial styling
  updateUi(nodeUiById, selectedId);

  return {
    simulation,
    stop: () => simulation.stop(),
    updateUi,
    getMiniMapNodes: () => {
      const arr: ForceGraphMiniNode[] = [];
      root.selectAll<SVGGElement, ForceNode>('g[data-ft-node="1"]').each(function (d: any) {
        if (d && typeof d.x === "number" && typeof d.y === "number")
          arr.push({ id: d.id, x: d.x, y: d.y });
      });
      return arr;
    },
    getNodePosition: (id: string) => {
      const nodes = simulation.nodes() as any[];
      for (const n of nodes) {
        if (n?.id === id && typeof n.x === "number" && typeof n.y === "number")
          return { x: n.x, y: n.y };
      }
      return null;
    },
  };
}
