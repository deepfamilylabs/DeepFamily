import React, { useLayoutEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { GraphNode } from '../types/graph'
import { makeNodeId } from '../types/graph'
import { useNodeDetail } from '../context/NodeDetailContext'
import useZoom from '../hooks/useZoom'
import useMiniMap from '../hooks/useMiniMap'
import { ZoomControls, MiniMap } from './ZoomControls'
import { useNodeData } from '../hooks/useNodeData'
import { useVisualizationHeight } from '../constants/layout'

export interface MerkleTreeViewHandle { centerOnNode: (id: string) => void }

const BASE_NODE_WIDTH = 100
const NODE_HEIGHT = 44
const GAP_X = 16
const GAP_Y = 96
const MARGIN_X = 24
const MARGIN_Y = 0

type PositionedNode = { id: string; data: GraphNode; depth: number; x: number; y: number }

function computeLayout(root: GraphNode) {
  const nodes: PositionedNode[] = []
  let nextLeafIndex = 0
  let maxDepth = 0
  const unitWidth = BASE_NODE_WIDTH + GAP_X
  function layout(node: GraphNode, depth: number): { x: number; y: number } {
    maxDepth = Math.max(maxDepth, depth)
    const children = node.children || []
    let x: number
    const y = MARGIN_Y + depth * GAP_Y
    if (children.length === 0) { x = nextLeafIndex * unitWidth; nextLeafIndex += 1 } else {
      const childPositions = children.map(c => layout(c, depth + 1))
      const minX = childPositions[0].x
      const maxX = childPositions[childPositions.length - 1].x
      x = (minX + maxX) / 2
    }
    const id = makeNodeId(node.personHash, node.versionIndex)
    nodes.push({ id, data: node, depth, x, y })
    return { x, y }
  }
  layout(root, 0)
  let minX = Infinity, maxX = -Infinity
  for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x) }
  const offsetX = MARGIN_X - minX
  for (const n of nodes) n.x += offsetX
  const width = (maxX - minX) + BASE_NODE_WIDTH + MARGIN_X * 2
  const height = MARGIN_Y * 2 + maxDepth * GAP_Y + NODE_HEIGHT
  return { nodes, width, height }
}

function MerkleTreeViewInner({ root }: { root: GraphNode }, ref: React.Ref<MerkleTreeViewHandle>) {
  const { nodes: positioned, width: svgWidth, height: svgHeight } = useMemo(() => computeLayout(root), [root])
  const idToPos = useMemo(() => { const m = new Map<string, PositionedNode>(); for (const pn of positioned) m.set(pn.id, pn); return m }, [positioned])
  const textRefs = useRef<Record<string, SVGTextElement | null>>({})
  const [measuredWidths, setMeasuredWidths] = useState<Record<string, number>>({})
  useLayoutEffect(() => { const next: Record<string, number> = {}; for (const id of Object.keys(textRefs.current)) { const el = textRefs.current[id]; if (el?.getComputedTextLength) next[id] = Math.max(BASE_NODE_WIDTH, Math.ceil(el.getComputedTextLength()) + 16) } if (Object.keys(next).length) setMeasuredWidths(next) }, [positioned])
  const truncateName = useCallback((name: string, width: number) => { if (!name) return ''; const charW = 8; const maxChars = Math.max(0, Math.floor((width - 16) / charW)); if (name.length <= maxChars) return name; if (maxChars <= 1) return '…'; return name.slice(0, maxChars - 1) + '…' }, [])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const { openNode, selected: ctxSelected } = useNodeDetail()
  const selectedId = ctxSelected ? makeNodeId(ctxSelected.personHash, ctxSelected.versionIndex) : null
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } = useZoom()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const responsiveHeight = useVisualizationHeight()

  const miniNodes = useMemo(() => positioned.map(pn => ({ id: pn.id, x: pn.x, y: pn.y, w: measuredWidths[pn.id] || BASE_NODE_WIDTH, h: NODE_HEIGHT })), [positioned, measuredWidths])
  const { miniSvgRef, viewportRef, dims } = useMiniMap({}, { nodes: miniNodes, transform, container: containerRef.current, onCenter: (gx, gy) => {
    const box = containerRef.current?.getBoundingClientRect(); if (!box) return
    centerOn(gx, gy, box.width, box.height)
  } })

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      const pn = idToPos.get(id)
      if (!pn) return
      const w = measuredWidths[id] || BASE_NODE_WIDTH
      const box = containerRef.current?.getBoundingClientRect(); if (!box) return
      centerOn(pn.x + w / 2, pn.y + NODE_HEIGHT / 2, box.width, box.height)
    }
  }), [idToPos, measuredWidths, centerOn])

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 rounded-2xl transition-all duration-300 border border-slate-200/50 dark:border-slate-700/50 shadow-xl backdrop-blur-sm pt-16"
      style={{ height: responsiveHeight, overscrollBehavior: 'contain' }}
    >
      <div className="absolute bottom-3 right-3 z-10"><MiniMap width={dims.w} height={dims.h} miniSvgRef={miniSvgRef} viewportRef={viewportRef} /></div>
      <ZoomControls className="absolute top-20 right-3 z-10" k={transform.k} kToNorm={kToNorm} normToK={normToK} onSetZoom={setZoom} onZoomIn={zoomIn} onZoomOut={zoomOut} />
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${Math.max(svgWidth, 800)} ${Math.max(svgHeight, responsiveHeight)}`} className="block min-w-full min-h-full select-none" style={{ touchAction: 'none' }}>
        <g ref={innerRef as any}>
          <g className="stroke-blue-300/70 dark:stroke-blue-500/60" strokeWidth={2} fill="none">
            {positioned.map(pn => (pn.data.children || []).map(child => {
              const childId = makeNodeId(child.personHash, child.versionIndex)
              const childPos = idToPos.get(childId)
              if (!childPos) return null
              const w1 = measuredWidths[pn.id] || BASE_NODE_WIDTH
              const w2 = measuredWidths[childId] || BASE_NODE_WIDTH
              const x1 = pn.x + w1 / 2
              const y1 = pn.y + NODE_HEIGHT
              const x2 = childPos.x + w2 / 2
              const y2 = childPos.y
              const mx = (x1 + x2) / 2
              const path = `M ${x1} ${y1} C ${mx} ${y1 + 24}, ${mx} ${y2 - 24}, ${x2} ${y2}`
              return <path key={`${pn.id}->${childId}`} d={path} />
            }))}
          </g>
          <g>
            {positioned.map(pn => {
              const w = measuredWidths[pn.id] || BASE_NODE_WIDTH
              const nd = useNodeData(pn.id)
              const mintedFlag = !!(nd?.tokenId && nd.tokenId !== '0')
              const nameDisplay = (mintedFlag && nd?.fullName) ? truncateName(nd.fullName, w) : undefined
              const endorse = nd?.endorsementCount
              const shortHash = pn.data.personHash.replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]+/, '0x$1…')
              const isSel = pn.id === selectedId
              const isHover = hoverId === pn.id
              const baseRect = mintedFlag
                ? 'fill-emerald-100 dark:fill-emerald-900/30 stroke-emerald-300 dark:stroke-emerald-400'
                : isSel
                  ? 'fill-amber-100 dark:fill-amber-900/30 stroke-amber-400 dark:stroke-amber-400/70'
                  : 'fill-gray-50 dark:fill-transparent stroke-green-600 dark:stroke-green-500'
              const hoverStroke = (!mintedFlag && !isSel && isHover) ? 'stroke-blue-500 dark:stroke-blue-400' : ''
              return (
                <g key={pn.id}
                   transform={`translate(${pn.x}, ${pn.y})`}
                   onMouseEnter={() => setHoverId(pn.id)}
                   onMouseLeave={() => setHoverId(h => (h === pn.id ? null : h))}
                   onClick={() => openNode({ personHash: pn.data.personHash, versionIndex: pn.data.versionIndex})}
                   onDoubleClick={() => navigator.clipboard?.writeText(pn.data.personHash).catch(() => {})}
                >
                  <title>{pn.data.personHash}</title>
                  <rect
                    width={w}
                    height={NODE_HEIGHT}
                    rx={8}
                    ry={8}
                    className={`${baseRect} ${hoverStroke} shadow-sm transition-colors`}
                    strokeWidth={mintedFlag || isSel ? 2 : 1}
                  />
                  <text ref={el => { textRefs.current[pn.id] = el }} className="font-mono">
                    <tspan x={8} y={16} className={`text-[16px] ${mintedFlag ? 'fill-emerald-700 dark:fill-emerald-300' : 'fill-gray-900 dark:fill-gray-100'}`}>{shortHash}</tspan>
                    <tspan x={w - 8} y={16} textAnchor="end" className={`text-[16px] ${mintedFlag ? 'fill-emerald-600 dark:fill-emerald-400' : 'fill-slate-700 dark:fill-slate-300'}`}>v{pn.data.versionIndex}</tspan>
                  </text>
                  <text className="font-mono">
                    {nameDisplay && (
                      <tspan x={8} y={NODE_HEIGHT - 6} className={`text-[16px] ${mintedFlag ? 'fill-emerald-700 dark:fill-emerald-300' : 'fill-slate-800 dark:fill-slate-200'}`}>{nameDisplay}</tspan>
                    )}
                    <tspan x={w - 8} y={NODE_HEIGHT - 6} textAnchor="end" className={`text-[16px] ${mintedFlag ? 'fill-emerald-600 dark:fill-emerald-400' : 'fill-slate-700 dark:fill-slate-300'}`}>{endorse !== undefined ? endorse : ''}</tspan>
                  </text>
                  {mintedFlag ? (<circle cx={w - 6} cy={6} r={3} className="fill-emerald-500 stroke-white dark:stroke-gray-900" strokeWidth={1} />) : null}
                </g>
              )
            })}
          </g>
        </g>
      </svg>
    </div>
  )
}

const MerkleTreeView = forwardRef(MerkleTreeViewInner)
export default MerkleTreeView
