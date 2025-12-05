import React, { useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import type { GraphNode } from '../types/graph'
import { makeNodeId } from '../types/graph'
import { useNodeDetail } from '../context/NodeDetailContext'
import useZoom from '../hooks/useZoom'
import useMiniMap from '../hooks/useMiniMap'
import { ZoomControls, MiniMap } from './ZoomControls'
import NodeCard from './NodeCard'
import { useTreeData } from '../context/TreeDataContext'
import { shortHash } from '../types/graph'
import { isMinted } from '../types/graph'
import { birthDateString } from '../types/graph'
import { useFamilyTreeHeight } from '../constants/layout'
import { useVizOptions } from '../context/VizOptionsContext'
import EndorseCompactModal from './modals/EndorseCompactModal'

export interface MerkleTreeViewHandle { centerOnNode: (id: string) => void }

const BASE_NODE_WIDTH = 112
const NODE_HEIGHT = 160
const GAP_X = 24
const GAP_Y = 220
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
  const { nodesData } = useTreeData()
  const { deduplicateChildren } = useVizOptions()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const { openNode, selected: ctxSelected } = useNodeDetail()
  const selectedId = ctxSelected ? makeNodeId(ctxSelected.personHash, ctxSelected.versionIndex) : null
  const { svgRef, innerRef, transform, zoomIn, zoomOut, setZoom, kToNorm, normToK, centerOn } = useZoom()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const responsiveHeight = useFamilyTreeHeight()
  const [endorseModal, setEndorseModal] = useState<{
    open: boolean
    personHash: string
    versionIndex: number
    fullName?: string
    endorsementCount?: number
  }>({ open: false, personHash: '', versionIndex: 1 })

  const miniNodes = useMemo(() => positioned.map(pn => ({ id: pn.id, x: pn.x, y: pn.y, w: BASE_NODE_WIDTH, h: NODE_HEIGHT })), [positioned])
  const { miniSvgRef, viewportRef, dims } = useMiniMap({ width: 120, height: 90 }, { nodes: miniNodes, transform, container: containerRef.current, onCenter: (gx, gy) => {
    const box = containerRef.current?.getBoundingClientRect(); if (!box) return
    centerOn(gx, gy, box.width, box.height)
  } })

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
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16"
        style={{ height: responsiveHeight, overscrollBehavior: 'contain' }}
      >
        <ZoomControls className="absolute bottom-[124px] left-3 z-10 md:bottom-[158px]" trackHeight={140} k={transform.k} kToNorm={kToNorm} normToK={normToK} onSetZoom={setZoom} onZoomIn={zoomIn} onZoomOut={zoomOut} />
        <div className="absolute bottom-3 left-3 z-10 scale-75 md:scale-100 origin-bottom-left"><MiniMap width={dims.w} height={dims.h} miniSvgRef={miniSvgRef} viewportRef={viewportRef} /></div>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${Math.max(svgWidth, 800)} ${Math.max(svgHeight, responsiveHeight)}`} className="block min-w-full min-h-full select-none" style={{ touchAction: 'none' }}>
          <defs>
            <linearGradient id="cardGlossGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="30%" stopColor="#ffffff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g ref={innerRef as any}>
            <g className="stroke-blue-300/70 dark:stroke-blue-500/60" strokeWidth={2} fill="none">
              {positioned.map(pn => (pn.data.children || []).map(child => {
                const childId = makeNodeId(child.personHash, child.versionIndex)
                const childPos = idToPos.get(childId)
                if (!childPos) return null
                const w1 = BASE_NODE_WIDTH
                const w2 = BASE_NODE_WIDTH
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
                const w = BASE_NODE_WIDTH
                const nd = nodesData[pn.id]
                const mintedFlag = isMinted(nd)
                const shortHashText = shortHash(pn.data.personHash)
                const nameTextRaw = (mintedFlag && nd?.fullName) ? nd.fullName : shortHashText
                const endorse = nd?.endorsementCount
                const isSel = pn.id === selectedId
                const isHover = hoverId === pn.id
                const versionText = `v${pn.data.versionIndex}`
                const tagText = nd?.tag || ''
                // In deduplicate mode, show totalVersions badge from contract data
                // In non-deduplicate mode, don't show badge (user can see all versions directly)
                const totalVersions = deduplicateChildren ? nd?.totalVersions : undefined
                const handleEndorse = () => {
                  setEndorseModal({
                    open: true,
                    personHash: pn.data.personHash,
                    versionIndex: pn.data.versionIndex,
                    fullName: nd?.fullName,
                    endorsementCount: endorse
                  })
                }
                return (
                  <g key={pn.id}
                     transform={`translate(${pn.x}, ${pn.y})`}
                     onMouseEnter={() => setHoverId(pn.id)}
                     onMouseLeave={() => setHoverId(h => (h === pn.id ? null : h))}
                     onClick={() => openNode({ personHash: pn.data.personHash, versionIndex: pn.data.versionIndex})}
                     onDoubleClick={() => navigator.clipboard?.writeText(pn.data.personHash).catch(() => {})}
                     className="cursor-pointer"
                  >
                    <title>{pn.data.personHash}</title>
                    <NodeCard
                      w={w}
                      h={NODE_HEIGHT}
                      minted={mintedFlag}
                      selected={isSel}
                      hover={isHover}
                      versionText={versionText}
                      titleText={nameTextRaw}
                      tagText={tagText}
                      gender={nd?.gender}
                      birthPlace={nd?.birthPlace}
                      birthDateText={mintedFlag ? birthDateString(nd) : undefined}
                      shortHashText={shortHashText}
                      endorsementCount={endorse}
                      totalVersions={totalVersions}
                      onEndorseClick={handleEndorse}
                    />
                  </g>
                )
              })}
            </g>
          </g>
        </svg>
      </div>
      <EndorseCompactModal
        isOpen={endorseModal.open}
        onClose={() => setEndorseModal(m => ({ ...m, open: false }))}
        personHash={endorseModal.personHash}
        versionIndex={endorseModal.versionIndex}
        versionData={{
          fullName: endorseModal.fullName,
          endorsementCount: endorseModal.endorsementCount
        }}
      />
    </>
  )
}

const MerkleTreeView = forwardRef(MerkleTreeViewInner)
export default MerkleTreeView
