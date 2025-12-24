import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import useZoom from '../hooks/useZoom'
import GraphViewport from './GraphViewport'
import { useFamilyTreeViewModel } from '../hooks/useFamilyTreeViewModel'
import { computeDagLayout } from '../layout/dagLayout'
import { DagDefs, DagEdges, DagNodes } from '../renderers/dagRenderer'
import { useFamilyTreeViewConfig } from '../context/FamilyTreeViewConfigContext'
import { noPropsForwardRef } from '../utils/noPropsForwardRef'
import type { FamilyTreeViewHandle } from '../types/familyTreeViewHandle'

const DagView = noPropsForwardRef<FamilyTreeViewHandle>((ref) => {
  const vm = useFamilyTreeViewModel()
  const { layout, height: responsiveHeight } = useFamilyTreeViewConfig()
  const nodeWidth = layout.DAG_NODE_WIDTH
  const nodeHeight = layout.DAG_NODE_HEIGHT
  const { selectedId: ctxSelectedId } = vm
  const { openNodeById, openEndorseById } = vm.actions
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } = useZoom()
  const { graph, deduplicateChildren } = vm
  const selectedHash = useMemo(() => {
    if (!ctxSelectedId) return ''
    return vm.nodeUiById[ctxSelectedId]?.personHash || ''
  }, [ctxSelectedId, vm.nodeUiById])

  const { nodes, edges, positions, width, height } = useMemo(() => {
    const nodes = graph.nodes
    const edges = graph.edges
    const { positions, width, height } = computeDagLayout(graph, nodeWidth, nodeHeight)
    return { nodes, edges, positions, width, height }
  }, [graph, nodeHeight, nodeWidth])

  const textRefs = useRef<Record<string, SVGTextElement | null>>({})
  const [measuredWidths, setMeasuredWidths] = useState<Record<string, number>>({})
  const MAX_NODE_WIDTH = layout.DAG_MAX_NODE_WIDTH
  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    for (const id of Object.keys(textRefs.current)) {
      const el = textRefs.current[id]
      if (el && typeof el.getComputedTextLength === 'function') {
        const computed = Math.ceil(el.getComputedTextLength()) + 16
        next[id] = Math.max(nodeWidth, Math.min(MAX_NODE_WIDTH, computed))
      }
    }
    if (Object.keys(next).length) setMeasuredWidths(next)
  }, [nodes, nodeWidth])

  const [hover, setHover] = useState<{ id: string; x: number; y: number; hash: string } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const toContainer = (svgX: number, svgY: number) => ({ left: transform.x + svgX * transform.k, top: transform.y + svgY * transform.k })
  const recomputeHoverPosition = useCallback(() => {
    const anchorId = ctxSelectedId || hover?.id
    if (!anchorId) return
    const p = positions[anchorId]
    if (!p) return
    const w = (measuredWidths[anchorId] || nodeWidth)
    const scr = toContainer(p.x + w / 2, p.y)
    // only update if changed to prevent infinite setState loop
    setHover(prev => {
      if (!prev || prev.id !== anchorId) return prev
      if (prev.x === scr.left && prev.y === scr.top) return prev
      return { ...prev, x: scr.left, y: scr.top }
    })
  }, [ctxSelectedId, hover?.id, positions, measuredWidths, nodeWidth, transform])
  useEffect(() => { recomputeHoverPosition() }, [transform, recomputeHoverPosition])
  useEffect(() => {
    if (ctxSelectedId) {
      const p = positions[ctxSelectedId]; if (p) {
        const w = measuredWidths[ctxSelectedId] || nodeWidth
        const scr = toContainer(p.x + w / 2, p.y)
        setHover(prev => {
          if (prev && prev.id === ctxSelectedId && prev.x === scr.left && prev.y === scr.top) return prev
          return { id: ctxSelectedId, x: scr.left, y: scr.top, hash: selectedHash }
        })
      }
    } else if (!hover) setHover(null)
  }, [ctxSelectedId, positions, measuredWidths, nodeWidth, transform, selectedHash, hover])

  const miniNodes = useMemo(() => nodes.map(n => ({ id: n.id, x: positions[n.id].x, y: positions[n.id].y, w: measuredWidths[n.id] || nodeWidth, h: nodeHeight })), [nodes, positions, measuredWidths, nodeWidth, nodeHeight])

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      const p = positions[id]
      if (!p) return
      const w = measuredWidths[id] || nodeWidth
      const h = nodeHeight
      const box = containerRef.current?.getBoundingClientRect(); if (!box) return
      centerOn(p.x + w / 2, p.y + h / 2, box.width, box.height)
    }
  }), [positions, measuredWidths, nodeWidth, nodeHeight, centerOn])

  return (
    <>
      <GraphViewport
        containerRef={containerRef}
        height={responsiveHeight}
        containerClassName="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16 pb-4 px-4 md:px-6 overscroll-contain"
        svgClassName="block min-w-full min-h-full select-none touch-none"
        viewBox={`0 0 ${Math.max(width, 800)} ${Math.max(height, responsiveHeight)}`}
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
        <DagDefs />
        <g ref={innerRef as any}>
          <DagEdges edges={edges} positions={positions} measuredWidths={measuredWidths} nodeWidth={nodeWidth} nodeHeight={nodeHeight} />
          <DagNodes
            nodes={nodes}
            positions={positions}
            measuredWidths={measuredWidths}
            nodeWidth={nodeWidth}
            nodeHeight={nodeHeight}
            ctxSelectedId={ctxSelectedId}
            hover={hover}
            setHover={setHover}
            nodeUiById={vm.nodeUiById}
            deduplicateChildren={deduplicateChildren}
            actions={{ openNodeById, openEndorseById }}
            textRefs={textRefs}
          />
	        </g>
      </GraphViewport>
    </>
  )
})
export default DagView
