import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as d3 from 'd3'
import type { GraphNode } from '../types/graph'
import { makeNodeId, nodeLabel, isMinted, shortHash } from '../types/graph'
import { useTreeData } from '../context/TreeDataContext'
import { useNodeDetail } from '../context/NodeDetailContext'
import useZoom from '../hooks/useZoom'
import useMiniMap from '../hooks/useMiniMap'
import { ZoomControls, MiniMap } from './ZoomControls'
import { useFamilyTreeHeight } from '../constants/layout'
import { useVizOptions } from '../context/VizOptionsContext'
import { getGenderColorHex } from '../constants/genderColors'
import EndorseCompactModal from './modals/EndorseCompactModal'

// Re-add types lost during refactor
export type SimNode = d3.SimulationNodeDatum & { id: string; label: string; hash: string; versionIndex: number; tag?: string; depth: number }
export type SimLink = d3.SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode }

function buildGraph(root: GraphNode) {
  const nodes: SimNode[] = []
  const links: SimLink[] = []
  function rec(n: GraphNode, depth: number) {
    const id = makeNodeId(n.personHash, n.versionIndex)
    nodes.push({ id, label: nodeLabel(n), hash: n.personHash, versionIndex: n.versionIndex, tag: n.tag, depth })
    for (const c of n.children || []) { const cid = makeNodeId(c.personHash, c.versionIndex); links.push({ source: id, target: cid }); rec(c, depth + 1) }
  }
  rec(root, 0)
  return { nodes, links }
}

export interface ForceDAGViewHandle { centerOnNode: (id: string) => void }

function ForceDAGViewInner({ root, height }: { root: GraphNode; height?: number }, ref: React.Ref<ForceDAGViewHandle>) {
  const responsiveHeight = useFamilyTreeHeight()
  const defaultHeight = height || responsiveHeight
  const { nodesData, bumpEndorsementCount } = useTreeData() as any
  const { deduplicateChildren } = useVizOptions()
  const { openNode, selected: ctxSelected } = useNodeDetail()
  const selectedId = ctxSelected ? makeNodeId(ctxSelected.personHash, ctxSelected.versionIndex) : null
  const data = useMemo(() => buildGraph(root), [root])
  const gRef = useRef<SVGGElement | null>(null)
  const { transform, zoomIn, zoomOut, setZoom, svgRef, innerRef, kToNorm, normToK, centerOn } = useZoom()
  const NODE_R = 14
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [endorseModal, setEndorseModal] = useState<{
    open: boolean
    personHash: string
    versionIndex: number
    fullName?: string
    endorsementCount?: number
  }>({ open: false, personHash: '', versionIndex: 1 })

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      let target: any = null
      if (gRef.current) { d3.select(gRef.current).selectAll('g').each(function(d: any) { if (d?.id === id) target = d }) }
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return
      const box = containerRef.current?.getBoundingClientRect(); if (!box) return
      centerOn(target.x, target.y, box.width, box.height)
    }
  }), [centerOn])

  useEffect(() => {
    if (!svgRef.current || !innerRef.current) return
    const svg = d3.select(svgRef.current)
    // Only clear inner group; keep defs etc.
    const g = d3.select(innerRef.current)
    g.selectAll('*').remove()
    gRef.current = g.node() as SVGGElement
    const width = (svgRef.current?.clientWidth || 800)

    // Ensure marker defs exist once
    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append('defs')
    const markerSel = defs.select('#fd-arrow')
    if (markerSel.empty()) {
      const m = defs.append('marker')
        .attr('id', 'fd-arrow')
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 10)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
      m.append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z').attr('fill', '#60a5fa')
    }

    const link = g.append('g').attr('stroke', '#93c5fd').attr('stroke-width', 2).attr('stroke-opacity', 0.7).selectAll('line').data(data.links).enter().append('line').attr('marker-end', 'url(#fd-arrow)')

    const node = g.append('g').selectAll('g').data(data.nodes).enter().append('g')
      .attr('class', 'cursor-pointer')
      .call(d3.drag<SVGGElement, SimNode>()
      .on('start', (event: any, d: SimNode) => { if (!event.active) simulation.alphaTarget(0.3).restart(); (d as any).fx = d.x; (d as any).fy = d.y })
      .on('drag', (event: any, d: SimNode) => { (d as any).fx = event.x; (d as any).fy = event.y })
      .on('end', (_event: any, d: SimNode) => { (d as any).fx = null; (d as any).fy = null; simulation.alphaTarget(0) })
    )

    const color = d3.scaleOrdinal(d3.schemeTableau10)
    node.append('circle').attr('r', NODE_R)
      .attr('fill', (d: any) => {
        const id = (d as SimNode).id
        return id === selectedId ? '#fde68a' : (color((d as SimNode).depth.toString()) as string)
      })
      .attr('opacity', 0.95)

    const isDark = document.documentElement.classList.contains('dark')
    const strokeColor = isDark ? '#f8fafc' : '#ffffff'
    node.append('circle')
      .attr('r', 3)
      .attr('cx', NODE_R - 5)
      .attr('cy', -(NODE_R - 5))
      .attr('fill', (d: any) => {
        const id = (d as SimNode).id
        const nd = nodesData?.[id]
        const g = nd?.gender as number | undefined
        return getGenderColorHex(g)
      })
      .attr('stroke', strokeColor)
      .attr('stroke-width', 0.5)



    node.append('title').text((d: any) => (d as SimNode).hash)
    const lbl = node.append('text').attr('class', 'font-mono').attr('fill', '#0f172a')
    lbl.each((d: any, i: number, nodesSel: any) => {
      const gtxt = d3.select(nodesSel[i])
      const sim = d as SimNode
      const id = sim.id
      const nd = nodesData?.[id]
      const mintedFlag = isMinted(nd)
      const shortHashText = shortHash(sim.hash)
      const width = 60
      gtxt.append('tspan').attr('x', 12).attr('y', -3).attr('font-size', 11).attr('fill', mintedFlag ? '#047857' : '#64748b').text(shortHashText)
      gtxt.append('tspan').attr('x', 25 + width).attr('y', -3).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', mintedFlag ? '#059669' : '#64748b').text(
        nd?.totalVersions && nd.totalVersions > 1 
          ? `T${nd.totalVersions}:v${sim.versionIndex}` 
          : `v${sim.versionIndex}`
      )
      const nm = nd?.fullName
      if (nm) gtxt.append('tspan').attr('x', 12).attr('y', 12).attr('font-size', 11).attr('fill', mintedFlag ? '#047857' : '#64748b').text(nm)
    })

    // Endorsement count with star icon aligned with version text (right) and fullName bottom
    node.each((d: any) => {
      const sim = d as SimNode
      const nd = nodesData?.[sim.id]
      const endorsementCount = nd?.endorsementCount
      const fullName = nd?.fullName
      if (typeof endorsementCount === 'number' && fullName) {
        const g = d3.select((node as any)._groups[0][data.nodes.indexOf(d)])
        const mintedFlag = isMinted(nd)
        
        // Create star path (same as NodeCard)
        function buildStarPath(cx: number, cy: number, spikes = 5, outerR = 4, innerR = 2): string {
          const step = Math.PI / spikes
          let rot = -Math.PI / 2
          let path = ''
          for (let i = 0; i < spikes * 2; i++) {
            const r = (i % 2 === 0) ? outerR : innerR
            const x = cx + Math.cos(rot) * r
            const y = cy + Math.sin(rot) * r
            path += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`)
            rot += step
          }
          path += ' Z'
          return path
        }
        
        const txt = String(endorsementCount)
        const badgeW = Math.max(20, 8 + txt.length * 5)
        const width = 60
        // Right-align with version text (T2:v1) and bottom-align with fullName (a1)
        const x = 25 + width - badgeW  // Right-align with version text position
        const y = 12 - 12 + 1  // fullName is at y=12, badge height is 12, so align bottom: y = 12 - 12 + 1 = 1
        const cx = x + 6
        const cy = y + 6
        const starPath = buildStarPath(cx, cy)
        
        // Subtle rounded badge background (consistent across themes)
        g.append('rect')
          .attr('x', x)
          .attr('y', y)
          .attr('width', badgeW)
          .attr('height', 12)
          .attr('rx', 6)
          .attr('ry', 6)
          .attr('fill', '#38bdf830')
          .attr('stroke', 'transparent')
        
        // Star icon
        g.append('path')
          .attr('d', starPath)
          .attr('fill', '#059669')
        
        // Count text
        g.append('text')
          .attr('x', x + 6 + 6)
          .attr('y', y + 8)
          .attr('text-anchor', 'start')
          .attr('font-size', 8)
          .attr('font-family', 'monospace')
          .attr('fill', '#047857')
          .text(txt)

        // Click area for endorsement badge
        g.append('rect')
          .attr('x', x)
          .attr('y', y)
          .attr('width', badgeW)
          .attr('height', 12)
          .attr('rx', 6)
          .attr('ry', 6)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('click', (event: any) => {
            event?.stopPropagation?.()
            setEndorseModal({
              open: true,
              personHash: sim.hash,
              versionIndex: sim.versionIndex,
              fullName: nd?.fullName,
              endorsementCount
            })
          })
      }
    })

    node.on('click', (_e: any, d: any) => { const sim = d as SimNode; openNode({ personHash: sim.hash, versionIndex: sim.versionIndex}) })
    node.on('dblclick', (_e: any, d: any) => { navigator.clipboard?.writeText((d as SimNode).hash).catch(() => {}) })

    const SPEED = { charge: -180, linkDist: 90, linkStrength: 0.95, xStrength: 0.7, yStrength: 0.15, collidePad: 2, velocityDecay: 0.25, alpha: 1, alphaDecay: 0.015 }
    const gapX = 80
    const marginX = 30
    const simulation = d3.forceSimulation<SimNode>(data.nodes)
      .velocityDecay(SPEED.velocityDecay)
      .alpha(SPEED.alpha)
      .alphaDecay(SPEED.alphaDecay)
      .force('link', d3.forceLink<SimNode, SimLink>(data.links).id((d: any) => (d as SimNode).id).distance(SPEED.linkDist).strength(SPEED.linkStrength))
      .force('charge', d3.forceManyBody().strength(SPEED.charge))
      .force('x', d3.forceX<SimNode>().x((d: any) => marginX + (d as SimNode).depth * gapX).strength(SPEED.xStrength))
      .force('y', d3.forceY(defaultHeight / 2).strength(SPEED.yStrength))
      .force('collide', d3.forceCollide<SimNode>(NODE_R + SPEED.collidePad))
      .on('tick', () => {
        link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y)
        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
        miniUpdateRef.current && miniUpdateRef.current()
      })

    return () => { simulation.stop() }
  }, [data, height, openNode, selectedId, innerRef, svgRef, nodesData, deduplicateChildren])

  const [miniNodes, setMiniNodes] = useState<any[]>([])
  const miniUpdateRef = useRef<()=>void>()
  const refreshMiniNodes = useCallback(() => {
    const arr: any[] = []
    if (gRef.current) d3.select(gRef.current).selectAll('g').each(function(d: any) { if (d && typeof d.x === 'number' && typeof d.y === 'number') arr.push({ id: d.id, x: d.x, y: d.y }) })
    setMiniNodes(arr)
  }, [])
  useEffect(() => { const id = setInterval(refreshMiniNodes, 500); return () => clearInterval(id) }, [refreshMiniNodes])
  const { miniSvgRef, viewportRef, dims, update } = useMiniMap({ shape: 'circle', width: 120, height: 90 }, { nodes: miniNodes, transform, container: containerRef.current, onCenter: (gx, gy) => {
    const box = containerRef.current?.getBoundingClientRect(); if (!box) return
    centerOn(gx, gy, box.width, box.height)
  } })
  miniUpdateRef.current = update

  return (
    <>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16"
        style={{ height: defaultHeight, touchAction: 'none', overscrollBehavior: 'contain' }}
      >
        <ZoomControls className="absolute bottom-[124px] left-3 z-10 md:bottom-[158px]" trackHeight={140} k={transform.k} kToNorm={kToNorm} normToK={normToK} onSetZoom={setZoom} onZoomIn={zoomIn} onZoomOut={zoomOut} />
        <div className="absolute bottom-3 left-3 z-10 scale-75 md:scale-100 origin-bottom-left"><MiniMap width={dims.w} height={dims.h} miniSvgRef={miniSvgRef} viewportRef={viewportRef} /></div>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 800 ${defaultHeight}`} className="block min-w-full min-h-full select-none" style={{ touchAction: 'none' }}>
          <g ref={innerRef as any} />
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

const ForceDAGView = forwardRef(ForceDAGViewInner)
export default ForceDAGView
