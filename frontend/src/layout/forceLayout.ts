import * as d3 from "d3";
import type { ForceLink, ForceNode } from "../types/familyTreeTypes";

export type ForceLayoutConfig = {
  charge: number;
  linkDist: number;
  linkStrength: number;
  xStrength: number;
  yStrength: number;
  collidePad: number;
  velocityDecay: number;
  alpha: number;
  alphaDecay: number;
  gapX: number;
  marginX: number;
};

export const DEFAULT_FORCE_LAYOUT: ForceLayoutConfig = {
  charge: -180,
  linkDist: 90,
  linkStrength: 0.95,
  xStrength: 0.7,
  yStrength: 0.15,
  collidePad: 2,
  velocityDecay: 0.25,
  alpha: 1,
  alphaDecay: 0.015,
  gapX: 80,
  marginX: 30,
};

export function createForceLayoutSimulation<
  TNode extends d3.SimulationNodeDatum & { depth: number },
  TLink extends d3.SimulationLinkDatum<TNode>,
>(params: {
  nodes: TNode[];
  links: TLink[];
  height: number;
  nodeRadius: number;
  config?: Partial<ForceLayoutConfig>;
}) {
  const cfg = { ...DEFAULT_FORCE_LAYOUT, ...(params.config || {}) };
  const simulation = d3
    .forceSimulation<TNode>(params.nodes)
    .velocityDecay(cfg.velocityDecay)
    .alpha(cfg.alpha)
    .alphaDecay(cfg.alphaDecay)
    .force(
      "link",
      d3
        .forceLink<TNode, any>(params.links)
        .id((d: any) => (d as any).id)
        .distance(cfg.linkDist)
        .strength(cfg.linkStrength),
    )
    .force("charge", d3.forceManyBody().strength(cfg.charge))
    .force(
      "x",
      d3
        .forceX<TNode>()
        .x((d: any) => cfg.marginX + (d as any).depth * cfg.gapX)
        .strength(cfg.xStrength),
    )
    .force("y", d3.forceY(params.height / 2).strength(cfg.yStrength))
    .force("collide", d3.forceCollide<TNode>(params.nodeRadius + cfg.collidePad));
  return simulation;
}

export function createFamilyTreeForceSimulation(params: {
  nodes: ForceNode[];
  links: ForceLink[];
  height: number;
  nodeRadius: number;
  config?: Partial<ForceLayoutConfig>;
}) {
  return createForceLayoutSimulation<ForceNode, ForceLink>(params);
}
