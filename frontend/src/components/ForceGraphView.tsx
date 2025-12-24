import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useZoom from '../hooks/useZoom'
import GraphViewport from './GraphViewport'
import { useFamilyTreeViewModel } from '../hooks/useFamilyTreeViewModel'
import { buildForceGraphStructureKey, mountForceGraphScene, type ForceGraphMiniNode, type ForceGraphScene } from '../renderers/forceGraphRenderer'
import { useFamilyTreeViewConfig } from '../context/FamilyTreeViewConfigContext'
import { noPropsForwardRef } from '../utils/noPropsForwardRef'
import type { FamilyTreeViewHandle } from '../types/familyTreeViewHandle'

const ForceGraphView = noPropsForwardRef<FamilyTreeViewHandle>((ref) => {
  const { layout, height } = useFamilyTreeViewConfig()
  const vm = useFamilyTreeViewModel()
  const { graph } = vm
  const graphRef = useRef(graph)
  const { openNodeById, openEndorseById, copyHash } = vm.actions
  const selectedId = vm.selectedId
  const structureKey = useMemo(() => buildForceGraphStructureKey(graph), [graph])

  const { transform, zoomIn, zoomOut, setZoom, svgRef, innerRef, kToNorm, normToK, centerOn } = useZoom()
  const DRAW_NODE_R = layout.FORCE_DRAW_NODE_R
  const COLLIDE_NODE_R = layout.FORCE_COLLIDE_NODE_R

  const containerRef = useRef<HTMLDivElement | null>(null)
  const actionsRef = useRef({ openNodeById, openEndorseById, copyHash })
  const nodeUiRef = useRef(vm.nodeUiById)
  const selectedIdRef = useRef<string | null>(selectedId)
  const sceneRef = useRef<ForceGraphScene | null>(null)

  useEffect(() => { graphRef.current = graph }, [graph])
  useEffect(() => { actionsRef.current = { openNodeById, openEndorseById, copyHash } }, [openNodeById, openEndorseById, copyHash])
  useEffect(() => { nodeUiRef.current = vm.nodeUiById }, [vm.nodeUiById])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  useImperativeHandle(ref, () => ({
    centerOnNode: (id: string) => {
      const pos = sceneRef.current?.getNodePosition(id)
      if (!pos) return
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return
      centerOn(pos.x, pos.y, box.width, box.height)
    }
  }), [centerOn])

  const miniUpdateRef = useRef<() => void>()

  useEffect(() => {
    if (!svgRef.current || !innerRef.current) return

    const prevNodes = sceneRef.current?.simulation?.nodes?.()
    sceneRef.current?.stop()

    const scene = mountForceGraphScene({
      svgEl: svgRef.current,
      rootEl: innerRef.current,
      graph: graphRef.current,
      nodeUiById: nodeUiRef.current,
      selectedId: selectedIdRef.current,
      drawNodeR: DRAW_NODE_R,
      collideNodeR: COLLIDE_NODE_R,
      height,
      actions: {
        openNodeById: (id: any) => actionsRef.current.openNodeById(id),
        openEndorseById: (id: any) => actionsRef.current.openEndorseById(id),
        copyHash: (personHash: string) => actionsRef.current.copyHash(personHash)
      },
      prevNodes: Array.isArray(prevNodes) ? (prevNodes as any) : undefined,
      onTick: () => { miniUpdateRef.current?.() }
    })

    sceneRef.current = scene

    return () => {
      scene.stop()
      if (sceneRef.current === scene) sceneRef.current = null
    }
  }, [height, structureKey])

  useEffect(() => {
    sceneRef.current?.updateUi(vm.nodeUiById, selectedId)
  }, [selectedId, vm.nodeUiById])

  const [miniNodes, setMiniNodes] = useState<ForceGraphMiniNode[]>([])
  const refreshMiniNodes = useCallback(() => {
    setMiniNodes(sceneRef.current?.getMiniMapNodes() || [])
  }, [])

  useEffect(() => {
    const id = window.setInterval(refreshMiniNodes, 500)
    return () => window.clearInterval(id)
  }, [refreshMiniNodes])

  return (
    <GraphViewport
      containerRef={containerRef}
      height={height}
      containerClassName="relative w-full overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 pt-16 touch-none overscroll-contain"
      svgClassName="block min-w-full min-h-full select-none touch-none"
      viewBox={`0 0 ${layout.FORCE_VIEWBOX_WIDTH} ${height}`}
      svgRef={svgRef}
      transform={transform}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      setZoom={setZoom}
      kToNorm={kToNorm}
      normToK={normToK}
      centerOn={centerOn}
      miniMapNodes={miniNodes}
      miniMapOptions={{ shape: 'circle', width: layout.FORCE_MINIMAP_WIDTH, height: layout.FORCE_MINIMAP_HEIGHT }}
      miniMapUpdateRef={miniUpdateRef}
    >
      <g ref={innerRef as any} />
    </GraphViewport>
  )
})
export default ForceGraphView
