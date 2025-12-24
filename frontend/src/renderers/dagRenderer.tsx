import React from "react";
import NodeCard from "../components/NodeCard";
import type { NodeId } from "../types/graph";
import type { BaseEdge, BaseNode } from "../types/familyTreeTypes";
import type { NodeUi } from "../utils/familyTreeNodeUi";

export function DagDefs() {
  return (
    <defs>
      <marker
        id="ftv-arrow"
        markerWidth="10"
        markerHeight="10"
        refX="10"
        refY="3"
        orient="auto"
        markerUnits="strokeWidth"
      >
        <path d="M0,0 L0,6 L9,3 z" className="fill-blue-400 dark:fill-blue-500" />
      </marker>
    </defs>
  );
}

export function DagEdges(props: {
  edges: BaseEdge[];
  positions: Record<NodeId, { x: number; y: number }>;
  measuredWidths: Record<string, number>;
  nodeWidth: number;
  nodeHeight: number;
}) {
  const { edges, positions, measuredWidths, nodeWidth, nodeHeight } = props;
  return (
    <>
      {edges.map((e, i) => {
        const s = positions[e.from];
        const t = positions[e.to];
        const x1 = s.x + (measuredWidths[e.from] || nodeWidth);
        const y1 = s.y + nodeHeight / 2;
        const x2 = t.x;
        const y2 = t.y + nodeHeight / 2;
        const mx = (x1 + x2) / 2;
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            className="stroke-blue-300/70 dark:stroke-blue-500/60"
            fill="none"
            markerEnd="url(#ftv-arrow)"
            strokeWidth="2"
          />
        );
      })}
    </>
  );
}

export function DagNodes(props: {
  nodes: BaseNode[];
  positions: Record<NodeId, { x: number; y: number }>;
  measuredWidths: Record<string, number>;
  nodeWidth: number;
  nodeHeight: number;
  ctxSelectedId: NodeId | null;
  hover: { id: string } | null;
  setHover: (h: { id: string; x: number; y: number; hash: string } | null) => void;
  nodeUiById: Record<NodeId, NodeUi>;
  deduplicateChildren: boolean;
  actions: {
    openNodeById: (id: NodeId) => void;
    openEndorseById: (id: NodeId) => void;
  };
  textRefs: React.MutableRefObject<Record<string, SVGTextElement | null>>;
}) {
  const {
    nodes,
    positions,
    measuredWidths,
    nodeWidth,
    nodeHeight,
    ctxSelectedId,
    hover,
    setHover,
    nodeUiById,
    deduplicateChildren,
    actions,
    textRefs,
  } = props;
  return (
    <>
      {nodes.map((n) => {
        const p = positions[n.id];
        const w = measuredWidths[n.id] || nodeWidth;
        const ui = nodeUiById[n.id];
        const isSelected = ctxSelectedId === n.id;
        const totalVersions = deduplicateChildren ? ui.totalVersions : undefined;
        return (
          <g
            key={n.id}
            transform={`translate(${p.x}, ${p.y})`}
            onMouseEnter={() => {
              if (!ctxSelectedId) setHover({ id: n.id, x: 0, y: 0, hash: ui.personHash });
            }}
            onMouseLeave={() => {
              if (!(ctxSelectedId && ctxSelectedId === n.id)) setHover(null);
            }}
            onClick={() => actions.openNodeById(n.id)}
            className="cursor-pointer"
          >
            <title>{ui.personHash}</title>
            <text
              ref={(el) => {
                textRefs.current[n.id] = el;
              }}
              opacity={0}
              className="font-mono pointer-events-none select-none"
            >
              <tspan x={8} y={14}>
                {ui.titleText}
              </tspan>
            </text>
            <NodeCard
              w={w}
              h={nodeHeight}
              minted={ui.minted}
              selected={isSelected}
              hover={Boolean(hover && hover.id === n.id)}
              versionText={ui.versionText}
              titleText={ui.titleText}
              tagText={ui.tagText}
              gender={ui.gender}
              birthPlace={ui.birthPlace}
              birthDateText={ui.birthDateText}
              shortHashText={ui.shortHashText}
              endorsementCount={ui.endorsementCount}
              totalVersions={totalVersions}
              onEndorseClick={() => actions.openEndorseById(n.id)}
            />
          </g>
        );
      })}
    </>
  );
}
