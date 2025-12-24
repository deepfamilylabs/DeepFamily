import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import useZoom from '../hooks/useZoom'
import NodeCard from './NodeCard'
import { useFamilyTreeHeight } from '../constants/layout'
import GraphViewport from './GraphViewport'
import { useFamilyTreeViewModel } from '../hooks/useFamilyTreeViewModel'
import { computeDagLayout } from '../layout/dagLayout'

export interface DagViewHandle { centerOnNode: (id: string) => void }

function DagViewInner({
  nodeWidth = 200,
  nodeHeight = 120,
}: {
  nodeWidth?: number
  nodeHeight?: number
}, ref: React.Ref<DagViewHandle>) {
  const vm = useFamilyTreeViewModel()
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
  const MAX_NODE_WIDTH = 168
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
  const responsiveHeight = useFamilyTreeHeight()
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
        <defs>
          <marker id="ftv-arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" className="fill-blue-400 dark:fill-blue-500" />
          </marker>
        </defs>
        <g ref={innerRef as any}>
          {edges.map((e, i) => {
            const s = positions[e.from]
            const t = positions[e.to]
            const x1 = s.x + (measuredWidths[e.from] || nodeWidth)
            const y1 = s.y + nodeHeight / 2
            const x2 = t.x
            const y2 = t.y + nodeHeight / 2
            const mx = (x1 + x2) / 2
            return (
              <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} className="stroke-blue-300/70 dark:stroke-blue-500/60" fill="none" markerEnd="url(#ftv-arrow)" strokeWidth="2" />
            )
          })}
          {nodes.map(n => {
            const p = positions[n.id]
            const w = measuredWidths[n.id] || nodeWidth
            const ui = vm.nodeUiById[n.id]
            const isSelected = ctxSelectedId === n.id
            // Pass totalVersions only in deduplicate mode; NodeCard will handle display logic (show badge only if > 1)
            const totalVersions = deduplicateChildren ? ui.totalVersions : undefined
            return (
              <g key={n.id}
                 transform={`translate(${p.x}, ${p.y})`}
                 onMouseEnter={() => { if (!ctxSelectedId) setHover({ id: n.id, x: 0, y: 0, hash: ui.personHash }) }}
                 onMouseLeave={() => { if (!(ctxSelectedId && ctxSelectedId === n.id)) setHover(null) }}
                 onClick={() => openNodeById(n.id)}
                 className="cursor-pointer">
                <title>{ui.personHash}</title>
                {/* Hidden text for width measurement, consistent with TreeLayoutView */}
                <text ref={el => { textRefs.current[n.id] = el }} opacity={0} className="font-mono pointer-events-none select-none">
                  <tspan x={8} y={14}>{ui.titleText}</tspan>
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
                  onEndorseClick={() => openEndorseById(n.id)}
                />
              </g>
            )
          })}
	        </g>
      </GraphViewport>
    </>
  )
}

const DagView = forwardRef(DagViewInner)
export default DagView
