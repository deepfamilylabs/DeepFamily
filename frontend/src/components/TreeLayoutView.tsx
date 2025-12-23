import React, { useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { makeNodeId, type NodeId } from '../types/graph'
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
import { buildViewGraphData, type TreeGraphData, type TreeWalkParams } from '../utils/treeData'

export interface TreeLayoutViewHandle { centerOnNode: (id: string) => void }

const BASE_NODE_WIDTH = 112
const NODE_HEIGHT = 160
const GAP_X = 24
const GAP_Y = 220
const MARGIN_X = 24
const MARGIN_Y = 0

type PositionedNode = { id: NodeId; depth: number; x: number; y: number }
type Edge = { from: NodeId; to: NodeId }

function computeLayout(params: { graph: TreeGraphData; rootId: NodeId | null }) {
  const { graph, rootId } = params
  const nodes: PositionedNode[] = []
  const edges: Edge[] = []
  if (!rootId) return { nodes, edges, width: 0, height: 0 }
  let nextLeafIndex = 0
  let maxDepthSeen = 0
  const unitWidth = BASE_NODE_WIDTH + GAP_X
  const visited = new Set<NodeId>()
  function layout(id: NodeId, depth: number): { x: number; y: number } | null {
    if (visited.has(id)) return null
    visited.add(id)
    maxDepthSeen = Math.max(maxDepthSeen, depth)
    const children = graph.childrenByParent[id] || []
    const childPositions: Array<{ id: NodeId; pos: { x: number; y: number } }> = []
    for (const cid of children) {
      const pos = layout(cid, depth + 1)
      if (pos) {
        childPositions.push({ id: cid, pos })
        edges.push({ from: id, to: cid })
      }
    }
    let x: number
    const y = MARGIN_Y + depth * GAP_Y
    if (childPositions.length === 0) {
      x = nextLeafIndex * unitWidth
      nextLeafIndex += 1
    } else {
      const minX = childPositions[0].pos.x
      const maxX = childPositions[childPositions.length - 1].pos.x
      x = (minX + maxX) / 2
    }
    nodes.push({ id, depth, x, y })
    return { x, y }
  }
  layout(rootId, 0)
  if (nodes.length === 0) return { nodes, edges, width: 0, height: 0 }
  let minX = Infinity, maxX = -Infinity
  for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x) }
  const offsetX = MARGIN_X - minX
  for (const n of nodes) n.x += offsetX
  const width = (maxX - minX) + BASE_NODE_WIDTH + MARGIN_X * 2
  const height = MARGIN_Y * 2 + maxDepthSeen * GAP_Y + NODE_HEIGHT
  return { nodes, edges, width, height }
}

function TreeLayoutViewInner(_: { }, ref: React.Ref<TreeLayoutViewHandle>) {
  const { rootId, nodesData, edgesUnion, edgesStrict, endorsementsReady, bumpEndorsementCount } = useTreeData()
  const { deduplicateChildren, childrenMode, strictIncludeUnversionedChildren } = useVizOptions()
  const { graph, nodes: positioned, edges, width: svgWidth, height: svgHeight } = useMemo(() => {
    const graph = buildViewGraphData({
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict,
      rootId
    })
    const layout = computeLayout({ graph, rootId })
    return { graph, ...layout }
  }, [childrenMode, deduplicateChildren, edgesStrict, edgesUnion, endorsementsReady, nodesData, rootId, strictIncludeUnversionedChildren])
  const nodeMetaById = useMemo(() => {
    const map = new Map<NodeId, { personHash: string; versionIndex: number }>()
    for (const n of graph.nodes) map.set(n.id, { personHash: n.personHash, versionIndex: n.versionIndex })
    return map
  }, [graph.nodes])
  const idToPos = useMemo(() => { const m = new Map<string, PositionedNode>(); for (const pn of positioned) m.set(pn.id, pn); return m }, [positioned])
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
        className="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16 overscroll-contain"
        style={{ height: responsiveHeight }}
      >
        <ZoomControls className="absolute bottom-[124px] left-3 z-10 md:bottom-[158px]" trackHeight={140} k={transform.k} kToNorm={kToNorm} normToK={normToK} onSetZoom={setZoom} onZoomIn={zoomIn} onZoomOut={zoomOut} />
        <div className="absolute bottom-3 left-3 z-10 scale-75 md:scale-100 origin-bottom-left"><MiniMap width={dims.w} height={dims.h} miniSvgRef={miniSvgRef} viewportRef={viewportRef} /></div>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${Math.max(svgWidth, 800)} ${Math.max(svgHeight, responsiveHeight)}`} className="block min-w-full min-h-full select-none touch-none">
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
                const nd = nodesData[pn.id]
                const meta = nodeMetaById.get(pn.id)
                const mintedFlag = isMinted(nd)
                const shortHashText = shortHash(meta?.personHash || '')
                const nameTextRaw = (mintedFlag && nd?.fullName) ? nd.fullName : shortHashText
                const endorse = nd?.endorsementCount
                const isSel = pn.id === selectedId
                const isHover = hoverId === pn.id
                const versionText = `v${meta?.versionIndex ?? 0}`
                const tagText = nd?.tag || ''
                // In deduplicate mode, show totalVersions badge from contract data
                // In non-deduplicate mode, don't show badge (user can see all versions directly)
                const totalVersions = deduplicateChildren ? nd?.totalVersions : undefined
                const handleEndorse = () => {
                  setEndorseModal({
                    open: true,
                    personHash: meta?.personHash || '',
                    versionIndex: meta?.versionIndex ?? 0,
                    fullName: nd?.fullName,
                    endorsementCount: endorse
                  })
                }
                return (
                  <g key={pn.id}
                     transform={`translate(${pn.x}, ${pn.y})`}
                     onMouseEnter={() => setHoverId(pn.id)}
                     onMouseLeave={() => setHoverId(h => (h === pn.id ? null : h))}
                     onClick={() => openNode({ personHash: meta?.personHash || '', versionIndex: meta?.versionIndex ?? 0 })}
                     onDoubleClick={() => meta?.personHash && navigator.clipboard?.writeText(meta.personHash).catch(() => {})}
                     className="cursor-pointer"
                  >
                    <title>{meta?.personHash}</title>
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
        onSuccess={() => {
          bumpEndorsementCount(endorseModal.personHash, endorseModal.versionIndex, 1)
        }}
      />
    </>
  )
}

const TreeLayoutView = forwardRef(TreeLayoutViewInner)
export default TreeLayoutView
