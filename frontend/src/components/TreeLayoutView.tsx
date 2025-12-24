import React, { useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import useZoom from '../hooks/useZoom'
import NodeCard from './NodeCard'
import { useFamilyTreeHeight } from '../constants/layout'
import GraphViewport from './GraphViewport'
import { useFamilyTreeViewModel } from '../hooks/useFamilyTreeViewModel'
import { computeTreeLayout, type TreePositionedNode } from '../layout/treeLayout'

export interface TreeLayoutViewHandle { centerOnNode: (id: string) => void }

const BASE_NODE_WIDTH = 112
const NODE_HEIGHT = 160
const GAP_X = 24
const GAP_Y = 220
const MARGIN_X = 24
const MARGIN_Y = 0

function TreeLayoutViewInner(_: { }, ref: React.Ref<TreeLayoutViewHandle>) {
  const vm = useFamilyTreeViewModel()
  const { graph, rootId, deduplicateChildren } = vm
  const { selectedId } = vm
  const { openNodeById, openEndorseById, copyHash } = vm.actions
  const { nodes: positioned, edges, width: svgWidth, height: svgHeight } = useMemo(() => {
    return computeTreeLayout(graph, rootId, {
      baseNodeWidth: BASE_NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      gapX: GAP_X,
      gapY: GAP_Y,
      marginX: MARGIN_X,
      marginY: MARGIN_Y
    })
  }, [graph, rootId])
  const idToPos = useMemo(() => { const m = new Map<string, TreePositionedNode>(); for (const pn of positioned) m.set(pn.id, pn); return m }, [positioned])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } = useZoom()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const responsiveHeight = useFamilyTreeHeight()

  const miniNodes = useMemo(() => positioned.map(pn => ({ id: pn.id, x: pn.x, y: pn.y, w: BASE_NODE_WIDTH, h: NODE_HEIGHT })), [positioned])

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      const pn = idToPos.get(id)
      if (!pn) return
      const w = BASE_NODE_WIDTH
      const box = containerRef.current?.getBoundingClientRect(); if (!box) return
      centerOn(pn.x + w / 2, pn.y + NODE_HEIGHT / 2, box.width, box.height)
    }
  }), [idToPos, centerOn])

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
        <defs>
          <linearGradient id="cardGlossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="30%" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g ref={innerRef as any}>
          <g className="stroke-blue-300/70 dark:stroke-blue-500/60" strokeWidth={2} fill="none">
            {edges.map(edge => {
              const childId = edge.to
              const parentId = edge.from
              const childPos = idToPos.get(childId)
              const parentPos = idToPos.get(parentId)
              if (!parentPos) return null
              if (!childPos) return null
              const w1 = BASE_NODE_WIDTH
              const w2 = BASE_NODE_WIDTH
              const x1 = parentPos.x + w1 / 2
              const y1 = parentPos.y + NODE_HEIGHT
              const x2 = childPos.x + w2 / 2
              const y2 = childPos.y
              const mx = (x1 + x2) / 2
              const path = `M ${x1} ${y1} C ${mx} ${y1 + 24}, ${mx} ${y2 - 24}, ${x2} ${y2}`
              return <path key={`${parentId}->${childId}`} d={path} />
            })}
          </g>
              <g>
              {positioned.map(pn => {
                const w = BASE_NODE_WIDTH
                const ui = vm.nodeUiById[pn.id]
                const isSel = pn.id === selectedId
                const isHover = hoverId === pn.id
                const tagText = (ui.tagText || '')
                // In deduplicate mode, show totalVersions badge from contract data
                // In non-deduplicate mode, don't show badge (user can see all versions directly)
                const totalVersions = deduplicateChildren ? ui.totalVersions : undefined
                const handleEndorse = () => openEndorseById(pn.id)
                return (
                  <g key={pn.id}
                     transform={`translate(${pn.x}, ${pn.y})`}
                     onMouseEnter={() => setHoverId(pn.id)}
                     onMouseLeave={() => setHoverId(h => (h === pn.id ? null : h))}
                     onClick={() => openNodeById(pn.id)}
                     onDoubleClick={() => ui.personHash && copyHash(ui.personHash)}
                     className="cursor-pointer"
                  >
                    <title>{ui.personHash}</title>
                    <NodeCard
                      w={w}
                      h={NODE_HEIGHT}
                      minted={ui.minted}
                      selected={isSel}
                      hover={isHover}
                      versionText={ui.versionText}
                      titleText={ui.titleText}
                      tagText={tagText}
                      gender={ui.gender}
                      birthPlace={ui.birthPlace}
                      birthDateText={ui.birthDateText}
                      shortHashText={ui.shortHashText}
                      endorsementCount={ui.endorsementCount}
                      totalVersions={totalVersions}
                      onEndorseClick={handleEndorse}
                    />
                  </g>
                )
              })}
          </g>
        </g>
      </GraphViewport>
    </>
  )
}

const TreeLayoutView = forwardRef(TreeLayoutViewInner)
export default TreeLayoutView
