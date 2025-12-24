import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as d3 from 'd3'
import useZoom from '../hooks/useZoom'
import { useFamilyTreeHeight } from '../constants/layout'
import { getGenderColorHex } from '../constants/genderColors'
import type { TreeGraphData } from '../utils/treeData'
import GraphViewport from './GraphViewport'
import { useFamilyTreeViewModel } from '../hooks/useFamilyTreeViewModel'
import { createFamilyTreeForceSimulation, DEFAULT_FORCE_LAYOUT } from '../layout/forceLayout'
import { getFamilyTreeNodeTheme } from '../utils/familyTreeTheme'
import type { ForceLink, ForceNode } from '../types/familyTreeTypes'

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

function buildForceSimData(graph: TreeGraphData) {
  const simNodes: ForceNode[] = graph.nodes.map(n => {
    return {
      id: n.id,
      personHash: n.personHash,
      versionIndex: n.versionIndex,
      depth: n.depth
    }
  })
  const simLinks: ForceLink[] = graph.edges.map(e => ({ from: e.from, to: e.to, source: e.from, target: e.to }))
  return { nodes: simNodes, links: simLinks }
}

function graphStructureKey(graph: TreeGraphData) {
  const n = graph.nodes.map(x => x.id).join('|')
  const e = graph.edges.map(x => `${x.from}>${x.to}`).join('|')
  return `${n}::${e}`
}

export interface ForceGraphViewHandle { centerOnNode: (id: string) => void }

function ForceGraphViewInner({ height }: { height?: number }, ref: React.Ref<ForceGraphViewHandle>) {
  const responsiveHeight = useFamilyTreeHeight()
  const defaultHeight = height || responsiveHeight
  const vm = useFamilyTreeViewModel()
  const { graph } = vm
  const { openNodeById, openEndorseById, copyHash } = vm.actions
  const selectedId = vm.selectedId
  const structureKey = useMemo(() => graphStructureKey(graph), [graph])
  const gRef = useRef<SVGGElement | null>(null)
  const { transform, zoomIn, zoomOut, setZoom, svgRef, innerRef, kToNorm, normToK, centerOn } = useZoom()
  const DRAW_NODE_R = 12
  const COLLIDE_NODE_R = 15
  const containerRef = useRef<HTMLDivElement | null>(null)
  const actionsRef = useRef({ openNodeById, openEndorseById, copyHash })
  const simulationRef = useRef<d3.Simulation<ForceNode, ForceLink> | null>(null)
  const nodeUiRef = useRef(vm.nodeUiById)

  useEffect(() => { actionsRef.current = { openNodeById, openEndorseById, copyHash } }, [openNodeById, openEndorseById, copyHash])
  useEffect(() => { nodeUiRef.current = vm.nodeUiById }, [vm.nodeUiById])

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      let target: any = null
      if (gRef.current) { d3.select(gRef.current).selectAll('g[data-ft-node="1"]').each(function(d: any) { if (d?.id === id) target = d }) }
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return
      const box = containerRef.current?.getBoundingClientRect(); if (!box) return
      centerOn(target.x, target.y, box.width, box.height)
    }
  }), [centerOn])

  useEffect(() => {
    if (!svgRef.current || !innerRef.current) return
    const data = buildForceSimData(graph)
    const svg = d3.select(svgRef.current)
    const root = d3.select(innerRef.current)
    gRef.current = root.node() as SVGGElement

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

    const linkLayer = (() => {
      const sel = root.select<SVGGElement>('g[data-ft-layer="links"]')
      return sel.empty() ? root.append('g').attr('data-ft-layer', 'links') : sel
    })()
    linkLayer.attr('stroke', '#93c5fd').attr('stroke-width', 2).attr('stroke-opacity', 0.7)

    const linkKey = (d: any) => `${(d as ForceLink).from}->${(d as ForceLink).to}`

    const linkSel = linkLayer.selectAll<SVGLineElement, ForceLink>('line').data(data.links, linkKey as any)
    linkSel.exit().remove()
    const link = (linkSel.enter().append('line').attr('marker-end', 'url(#fd-arrow)') as any).merge(linkSel as any)

    let simulation: d3.Simulation<ForceNode, ForceLink>
    const nodeLayer = (() => {
      const sel = root.select<SVGGElement>('g[data-ft-layer="nodes"]')
      return sel.empty() ? root.append('g').attr('data-ft-layer', 'nodes') : sel
    })()

    const nodeSel = nodeLayer.selectAll<SVGGElement, ForceNode>('g[data-ft-node="1"]').data(data.nodes, (d: any) => (d as ForceNode).id)
    nodeSel.exit().remove()
    const nodeEnter = nodeSel.enter().append('g').attr('class', 'cursor-pointer').attr('data-ft-node', '1')
    const node = (nodeEnter as any).merge(nodeSel as any)

    const depthAccentColor = d3.scaleOrdinal(d3.schemeTableau10)

    nodeEnter.append('circle')
      .attr('r', DRAW_NODE_R)
      .attr('data-ft', 'base')
      .attr('class', (d: any) => {
        const id = (d as ForceNode).id as any
        const ui = nodeUiRef.current[id]
        const theme = getFamilyTreeNodeTheme({ minted: Boolean(ui?.minted), selected: id === selectedId })
        return theme.baseShapeClass
      })
      .attr('stroke-width', (d: any) => {
        const id = (d as ForceNode).id as any
        const ui = nodeUiRef.current[id]
        const theme = getFamilyTreeNodeTheme({ minted: Boolean(ui?.minted), selected: id === selectedId })
        return theme.baseShapeStrokeWidth
      })
      .attr('opacity', 0.95)

    // Depth accent: subtle inner fill (inside themed stroke), not an outer ring.
    nodeEnter.append('circle')
      .attr('r', (d: any) => {
        const id = (d as ForceNode).id as any
        const ui = nodeUiRef.current[id]
        const theme = getFamilyTreeNodeTheme({ minted: Boolean(ui?.minted), selected: id === selectedId })
        return Math.max(1, DRAW_NODE_R - (theme.baseShapeStrokeWidth / 2) - 0.6)
      })
      .attr('data-ft', 'depth')
      .attr('fill', (d: any) => (depthAccentColor((d as ForceNode).depth.toString()) as string))
      .attr('fill-opacity', (d: any) => (((d as ForceNode).id as any) === selectedId ? 0.12 : 0.18))
      .attr('stroke', 'none')
      .style('pointer-events', 'none')

    nodeEnter.append('circle')
      .attr('r', 3)
      .attr('cx', DRAW_NODE_R - 5)
      .attr('cy', -(DRAW_NODE_R - 5))
      .attr('data-ft', 'genderDot')
      .attr('class', 'stroke-white dark:stroke-slate-50')
      .attr('fill', (d: any) => {
        const id = (d as ForceNode).id as any
        const ui = nodeUiRef.current[id]
        return getGenderColorHex(ui.gender)
      })
      .attr('stroke-width', 0.5)

    nodeEnter.append('title').text((d: any) => (d as ForceNode).personHash)
    const lbl = nodeEnter.append('text').attr('class', 'font-mono')
    lbl.each(function(d: any) {
      const gtxt = d3.select(this)
      const sim = d as ForceNode
      const id = sim.id as any
      const width = 60
      const ui = nodeUiRef.current[id]
      const minted = Boolean(ui?.minted)
      const theme = getFamilyTreeNodeTheme({ minted, selected: id === selectedId })
      gtxt.append('tspan').attr('data-ft', 'shortHash').attr('x', 12).attr('y', -3).attr('font-size', 11).attr('class', theme.shortHashText.svg).text(ui?.shortHashText || '')
      gtxt.append('tspan').attr('data-ft', 'version').attr('x', 25 + width).attr('y', -3).attr('text-anchor', 'end').attr('font-size', 11).attr('class', theme.versionText.svg).text(ui?.versionTextWithTotal || '')
      gtxt.append('tspan').attr('data-ft', 'fullName').attr('x', 12).attr('y', 12).attr('font-size', 11).attr('class', theme.titleText.svg).text(ui?.fullName || '').style('display', ui?.fullName ? 'inline' : 'none')
    })

    // Endorsement badge is handled in the update effect (so selection changes don't rebuild the graph).

    nodeEnter.on('click', (_e: any, d: any) => { actionsRef.current.openNodeById((d as ForceNode).id as any) })
    nodeEnter.on('dblclick', (_e: any, d: any) => { actionsRef.current.copyHash((d as ForceNode).personHash) })

    const drag = d3.drag<SVGGElement, ForceNode>()
      .on('start', (event: any, d: ForceNode) => { if (!event.active) simulation.alphaTarget(0.3).restart(); (d as any).fx = d.x; (d as any).fy = d.y })
      .on('drag', (event: any, d: ForceNode) => { (d as any).fx = event.x; (d as any).fy = event.y })
      .on('end', (_event: any, d: ForceNode) => { (d as any).fx = null; (d as any).fy = null; simulation.alphaTarget(0) })

    nodeEnter.call(drag)

    // Preserve positions across rebuilds to avoid "jump" when only non-structural data changes.
    const prevNodes = simulationRef.current?.nodes?.() as any[] | undefined
    if (Array.isArray(prevNodes) && prevNodes.length) {
      const byId = new Map<string, any>()
      for (const pn of prevNodes) if (pn?.id) byId.set(String(pn.id), pn)
      for (const n of data.nodes as any[]) {
        const pn = byId.get(String(n.id))
        if (!pn) continue
        if (typeof pn.x === 'number') n.x = pn.x
        if (typeof pn.y === 'number') n.y = pn.y
        if (typeof pn.vx === 'number') n.vx = pn.vx
        if (typeof pn.vy === 'number') n.vy = pn.vy
      }
    }

    simulationRef.current?.stop()

		    simulation = createFamilyTreeForceSimulation({
		      nodes: data.nodes,
		      links: data.links,
		      height: defaultHeight,
		      nodeRadius: COLLIDE_NODE_R,
		      config: DEFAULT_FORCE_LAYOUT
		    })
		      .on('tick', () => {
		        link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y)
		        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
		        miniUpdateRef.current && miniUpdateRef.current()
		      })
	    simulationRef.current = simulation

    return () => { simulation.stop() }
	  }, [structureKey, defaultHeight, innerRef, svgRef])

  useEffect(() => {
    if (!gRef.current) return
    const root = d3.select(gRef.current)
    const nodeGroups = root.selectAll<SVGGElement, ForceNode>('g[data-ft-node="1"]')
    nodeGroups.each(function(d: any) {
      const sim = d as ForceNode
      const id = sim.id as any
      const ui = vm.nodeUiById[id]
      if (!ui) return
      const theme = getFamilyTreeNodeTheme({ minted: Boolean(ui.minted), selected: id === selectedId })
      const g = d3.select(this)
      g.select<SVGCircleElement>('circle[data-ft="base"]').attr('class', theme.baseShapeClass).attr('stroke-width', theme.baseShapeStrokeWidth)
      g.select<SVGCircleElement>('circle[data-ft="depth"]')
        .attr('r', Math.max(1, DRAW_NODE_R - (theme.baseShapeStrokeWidth / 2) - 0.6))
        .attr('fill-opacity', id === selectedId ? 0.12 : 0.18)
      g.select<SVGTSpanElement>('tspan[data-ft="shortHash"]').attr('class', theme.shortHashText.svg).text(ui.shortHashText || '')
      g.select<SVGTSpanElement>('tspan[data-ft="version"]').attr('class', theme.versionText.svg).text(ui.versionTextWithTotal || '')
      g.select<SVGTSpanElement>('tspan[data-ft="fullName"]').attr('class', theme.titleText.svg).text(ui.fullName || '').style('display', ui.fullName ? 'inline' : 'none')

      const endorsementCount = ui.endorsementCount
      const shouldShowEndorse = typeof endorsementCount === 'number' && Boolean(ui.fullName)
      const existingBadge = g.select<SVGGElement>('g[data-ft="endorse"]')

      if (!shouldShowEndorse) {
        if (!existingBadge.empty()) existingBadge.remove()
        return
      }

      const txt = String(endorsementCount)
      const badgeW = Math.max(20, 8 + txt.length * 5)
      const width = 60
      const x = 25 + width - badgeW
      const y = 1
      const cx = x + 6
      const cy = y + 6
      const starPath = buildStarPath(cx, cy)

      const badge = existingBadge.empty()
        ? g.append('g').attr('data-ft', 'endorse')
        : existingBadge

      if (existingBadge.empty()) {
        badge.append('rect').attr('data-ft', 'endorseBg').attr('rx', 6).attr('ry', 6)
        badge.append('path').attr('data-ft', 'endorseStar')
        badge.append('text').attr('data-ft', 'endorseText').attr('text-anchor', 'start').attr('font-size', 8).attr('font-family', 'monospace')
        badge.append('rect')
          .attr('data-ft', 'endorseHit')
          .attr('rx', 6)
          .attr('ry', 6)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('click', (event: any) => {
            event?.stopPropagation?.()
            actionsRef.current.openEndorseById(id)
          })
      }

      badge.select<SVGRectElement>('rect[data-ft="endorseBg"]')
        .attr('x', x).attr('y', y).attr('width', badgeW).attr('height', 12)
        .attr('class', `${theme.endorseBadgeBgClass} stroke-transparent`)
      badge.select<SVGPathElement>('path[data-ft="endorseStar"]').attr('d', starPath).attr('class', theme.endorseStarClass)
      badge.select<SVGTextElement>('text[data-ft="endorseText"]')
        .attr('x', x + 12).attr('y', y + 8)
        .attr('class', theme.endorseCountText.svg)
        .text(txt)
      badge.select<SVGRectElement>('rect[data-ft="endorseHit"]').attr('x', x).attr('y', y).attr('width', badgeW).attr('height', 12)
    })
  }, [selectedId, vm.nodeUiById, DRAW_NODE_R])

  const [miniNodes, setMiniNodes] = useState<Array<{ id: string; x: number; y: number }>>([])
  const miniUpdateRef = useRef<() => void>()
  const refreshMiniNodes = useCallback(() => {
    const arr: Array<{ id: string; x: number; y: number }> = []
    if (gRef.current) {
      d3.select(gRef.current).selectAll('g[data-ft-node="1"]').each(function(d: any) {
        if (d && typeof d.x === 'number' && typeof d.y === 'number') arr.push({ id: d.id, x: d.x, y: d.y })
      })
    }
    setMiniNodes(arr)
  }, [])
  useEffect(() => { const id = setInterval(refreshMiniNodes, 500); return () => clearInterval(id) }, [refreshMiniNodes])

  return (
    <>
      <GraphViewport
        containerRef={containerRef}
        height={defaultHeight}
        containerClassName="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16 touch-none overscroll-contain"
        svgClassName="block min-w-full min-h-full select-none touch-none"
        viewBox={`0 0 800 ${defaultHeight}`}
        svgRef={svgRef}
        transform={transform}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        setZoom={setZoom}
        kToNorm={kToNorm}
        normToK={normToK}
        centerOn={centerOn}
        miniMapNodes={miniNodes}
        miniMapOptions={{ shape: 'circle', width: 120, height: 90 }}
        miniMapUpdateRef={miniUpdateRef}
      >
        <g ref={innerRef as any} />
      </GraphViewport>
    </>
  )
}

const ForceGraphView = forwardRef(ForceGraphViewInner)
export default ForceGraphView
