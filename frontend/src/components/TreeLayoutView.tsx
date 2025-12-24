import React, { useMemo, useRef, useState, useImperativeHandle } from "react";
import useZoom from "../hooks/useZoom";
import GraphViewport from "./GraphViewport";
import { useFamilyTreeViewModel } from "../hooks/useFamilyTreeViewModel";
import { computeTreeLayout, type TreePositionedNode } from "../layout/treeLayout";
import { TreeLayoutDefs, TreeLayoutEdges, TreeLayoutNodes } from "../renderers/treeLayoutRenderer";
import { useFamilyTreeViewConfig } from "../context/FamilyTreeViewConfigContext";
import { noPropsForwardRef } from "../utils/noPropsForwardRef";
import type { FamilyTreeViewHandle } from "../types/familyTreeViewHandle";

const TreeLayoutView = noPropsForwardRef<FamilyTreeViewHandle>((ref) => {
  const { layout, height: responsiveHeight } = useFamilyTreeViewConfig();
  const vm = useFamilyTreeViewModel();
  const { graph, rootId, deduplicateChildren } = vm;
  const { selectedId } = vm;
  const { openNodeById, openEndorseById, copyHash } = vm.actions;
  const {
    nodes: positioned,
    edges,
    width: svgWidth,
    height: svgHeight,
  } = useMemo(() => {
    return computeTreeLayout(graph, rootId, {
      baseNodeWidth: layout.TREE_NODE_WIDTH,
      nodeHeight: layout.TREE_NODE_HEIGHT,
      gapX: layout.TREE_GAP_X,
      gapY: layout.TREE_GAP_Y,
      marginX: layout.TREE_MARGIN_X,
      marginY: layout.TREE_MARGIN_Y,
    });
  }, [graph, rootId]);
  const idToPos = useMemo(() => {
    const m = new Map<string, TreePositionedNode>();
    for (const pn of positioned) m.set(pn.id, pn);
    return m;
  }, [positioned]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } =
    useZoom();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const miniNodes = useMemo(
    () =>
      positioned.map((pn) => ({
        id: pn.id,
        x: pn.x,
        y: pn.y,
        w: layout.TREE_NODE_WIDTH,
        h: layout.TREE_NODE_HEIGHT,
      })),
    [positioned, layout.TREE_NODE_WIDTH, layout.TREE_NODE_HEIGHT],
  );

  useImperativeHandle(
    ref,
    () => ({
      centerOnNode: (id: string) => {
        const pn = idToPos.get(id);
        if (!pn) return;
        const w = layout.TREE_NODE_WIDTH;
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        centerOn(pn.x + w / 2, pn.y + layout.TREE_NODE_HEIGHT / 2, box.width, box.height);
      },
    }),
    [idToPos, centerOn, layout.TREE_NODE_HEIGHT, layout.TREE_NODE_WIDTH],
  );

  return (
    <>
      <GraphViewport
        containerRef={containerRef}
        height={responsiveHeight}
        containerClassName="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16 overscroll-contain"
        svgClassName="block min-w-full min-h-full select-none touch-none"
        viewBox={`0 0 ${Math.max(svgWidth, 800)} ${Math.max(svgHeight, responsiveHeight)}`}
        svgRef={svgRef}
        transform={transform}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        setZoom={setZoom}
        kToNorm={kToNorm}
        normToK={normToK}
        centerOn={centerOn}
        miniMapNodes={miniNodes}
      >
        <TreeLayoutDefs />
        <g ref={innerRef as any}>
          <TreeLayoutEdges
            edges={edges}
            idToPos={idToPos}
            nodeWidth={layout.TREE_NODE_WIDTH}
            nodeHeight={layout.TREE_NODE_HEIGHT}
          />
          <TreeLayoutNodes
            nodes={positioned}
            nodeWidth={layout.TREE_NODE_WIDTH}
            nodeHeight={layout.TREE_NODE_HEIGHT}
            nodeUiById={vm.nodeUiById}
            selectedId={selectedId}
            hoverId={hoverId}
            setHoverId={setHoverId}
            deduplicateChildren={deduplicateChildren}
            actions={{ openNodeById, openEndorseById, copyHash }}
          />
        </g>
      </GraphViewport>
    </>
  );
});
export default TreeLayoutView;
