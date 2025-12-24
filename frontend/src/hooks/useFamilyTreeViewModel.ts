import { useCallback, useMemo } from 'react'
import type { NodeId } from '../types/graph'
import { makeNodeId, parseNodeId } from '../types/graph'
import type { NodeUi } from '../utils/familyTreeNodeUi'
import { getNodeUi } from '../utils/familyTreeNodeUi'
import { useTreeData } from '../context/TreeDataContext'
import { useVizOptions } from '../context/VizOptionsContext'
import { useNodeDetail } from '../context/NodeDetailContext'
import { useEndorseModal, type EndorseTarget } from '../context/EndorseModalContext'
import { buildTreeRowsFromGraph, buildViewGraphData, type TreeRow } from '../utils/treeData'

export type FamilyTreeViewModel = {
  graph: ReturnType<typeof buildViewGraphData>
  rootId: ReturnType<typeof useTreeData>['rootId']
  nodesData: ReturnType<typeof useTreeData>['nodesData']
  edgesUnion: ReturnType<typeof useTreeData>['edgesUnion']
  edgesStrict: ReturnType<typeof useTreeData>['edgesStrict']
  endorsementsReady: ReturnType<typeof useTreeData>['endorsementsReady']
  deduplicateChildren: ReturnType<typeof useVizOptions>['deduplicateChildren']
  childrenMode: ReturnType<typeof useVizOptions>['childrenMode']
  strictIncludeUnversionedChildren: ReturnType<typeof useVizOptions>['strictIncludeUnversionedChildren']

  nodeUiById: Record<NodeId, NodeUi>
  selectedId: NodeId | null
  selectors: {
    treeListRows: (expanded: Set<NodeId>) => TreeRow[]
  }
  actions: {
    openNode: ReturnType<typeof useNodeDetail>['openNode']
    openNodeById: (id: NodeId) => void
    openEndorse: (t: EndorseTarget) => void
    openEndorseById: (id: NodeId) => void
    copyHash: (personHash: string) => void
  }
}

export function useFamilyTreeViewModel(): FamilyTreeViewModel {
  const { rootId, reachableNodeIds, endorsementsReady, nodesData, edgesUnion, edgesStrict } = useTreeData()
  const { deduplicateChildren, childrenMode, strictIncludeUnversionedChildren } = useVizOptions()
  const { openNode, selected } = useNodeDetail()
  const { openEndorse } = useEndorseModal()

  const selectedId = useMemo(() => {
    if (!selected) return null
    return makeNodeId(selected.personHash, selected.versionIndex)
  }, [selected])

  const openNodeById = useCallback((id: NodeId) => {
    const parsed = parseNodeId(id)
    openNode({ personHash: parsed.personHash, versionIndex: parsed.versionIndex })
  }, [openNode])


  const copyHash = useCallback((personHash: string) => {
    navigator.clipboard?.writeText(personHash).catch(() => {})
  }, [])

  const graph = useMemo(() => {
    return buildViewGraphData({
      rootId,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict
    })
  }, [
    rootId,
    childrenMode,
    strictIncludeUnversionedChildren,
    deduplicateChildren,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict
  ])

  const nodeUiById = useMemo(() => {
    const ids = new Set<NodeId>()
    for (const id of reachableNodeIds as any) ids.add(id)
    for (const n of graph.nodes) ids.add(n.id as NodeId)
    const out: Record<NodeId, NodeUi> = {} as any
    for (const id of ids) {
      out[id] = getNodeUi(id, nodesData)
    }
    return out
  }, [reachableNodeIds, graph.nodes, nodesData])

  const treeListRows = useCallback((expanded: Set<NodeId>): TreeRow[] => {
    if (!rootId) return []
    return buildTreeRowsFromGraph({ rootId, expanded, graph })
  }, [graph, rootId])

  const openEndorseById = useCallback((id: NodeId) => {
    const ui = getNodeUi(id, nodesData)
    const parsed = parseNodeId(id)
    openEndorse({
      personHash: parsed.personHash,
      versionIndex: parsed.versionIndex,
      fullName: ui?.fullName,
      endorsementCount: ui?.endorsementCount
    })
  }, [openEndorse, nodesData])

  return {
    graph,
    rootId,
    nodesData,
    edgesUnion,
    edgesStrict,
    endorsementsReady,
    deduplicateChildren,
    childrenMode,
    strictIncludeUnversionedChildren,
    nodeUiById,
    selectedId,
    selectors: {
      treeListRows
    },
    actions: {
      openNode,
      openNodeById,
      openEndorse,
      openEndorseById,
      copyHash
    }
  }
}
