import type { NodeId, NodeData } from '../types/graph'
import { makeNodeId, parseNodeId } from '../types/graph'
import type { EdgeStoreStrict, EdgeStoreUnion } from '../types/treeStore'
import { unionParentKey } from '../types/treeStore'
import type { BaseEdge, BaseNode } from '../types/familyTreeTypes'

export type TreeRow = { nodeId: NodeId; depth: number; isLast: boolean; hasChildren: boolean }
export type TreeGraphData = {
  nodes: BaseNode[]
  edges: BaseEdge[]
  childrenByParent: Record<NodeId, NodeId[]>
}

export type TreeWalkParams = {
  rootId: NodeId | null
  childrenMode: 'union' | 'strict'
  strictIncludeUnversionedChildren?: boolean
  deduplicateChildren: boolean
  endorsementsReady: boolean
  nodesData: Record<string, NodeData>
  edgesUnion: EdgeStoreUnion
  edgesStrict: EdgeStoreStrict
}

function chooseBestVersion(ids: NodeId[], nodesData: Record<string, NodeData>, endorsementsReady: boolean): NodeId {
  if (!endorsementsReady) {
    return ids.reduce((best, cur) => (parseNodeId(cur).versionIndex < parseNodeId(best).versionIndex ? cur : best), ids[0])
  }
  let best = ids[0]
  let bestCount = nodesData[best]?.endorsementCount ?? 0
  let bestV = parseNodeId(best).versionIndex
  for (let i = 1; i < ids.length; i++) {
    const id = ids[i]
    const count = nodesData[id]?.endorsementCount ?? 0
    const v = parseNodeId(id).versionIndex
    if (count > bestCount || (count === bestCount && v < bestV)) {
      best = id
      bestCount = count
      bestV = v
    }
  }
  return best
}

function projectDeduplicatedChildIds(raw: NodeId[], nodesData: Record<string, NodeData>, endorsementsReady: boolean): NodeId[] {
  if (raw.length <= 1) return raw
  const byHash = new Map<string, NodeId[]>()
  for (const id of raw) {
    const { personHash } = parseNodeId(id)
    const k = personHash.toLowerCase()
    const arr = byHash.get(k)
    if (arr) arr.push(id)
    else byHash.set(k, [id])
  }
  if (byHash.size === raw.length) return raw

  const bestByHash = new Map<string, NodeId>()
  for (const [k, ids] of byHash.entries()) {
    bestByHash.set(k, ids.length === 1 ? ids[0] : chooseBestVersion(ids, nodesData, endorsementsReady))
  }
  const out: NodeId[] = []
  const seen = new Set<string>()
  for (const id of raw) {
    const { personHash } = parseNodeId(id)
    const k = personHash.toLowerCase()
    if (seen.has(k)) continue
    const best = bestByHash.get(k)
    if (best) out.push(best)
    seen.add(k)
  }
  return out
}

export function getProjectedChildIds(params: {
  parentId: NodeId
  childrenMode: 'union' | 'strict'
  strictIncludeUnversionedChildren?: boolean
  deduplicateChildren: boolean
  endorsementsReady: boolean
  nodesData: Record<string, NodeData>
  edgesUnion: EdgeStoreUnion
  edgesStrict: EdgeStoreStrict
}): NodeId[] {
  const { parentId, childrenMode, strictIncludeUnversionedChildren, deduplicateChildren, endorsementsReady, nodesData, edgesUnion, edgesStrict } = params
  const { personHash } = parseNodeId(parentId)
  const raw = childrenMode === 'strict'
    ? (() => {
        const base = edgesStrict[parentId]?.childIds || []
        if (!strictIncludeUnversionedChildren) return base
        const zero = edgesStrict[makeNodeId(personHash, 0)]?.childIds || []
        if (!zero.length) return base
        const merged = new Set(base)
        for (const cid of zero) merged.add(cid)
        return Array.from(merged).sort((a, b) => a.localeCompare(b))
      })()
    : (edgesUnion[unionParentKey(personHash)]?.childIds || [])
  const filtered = raw.filter(id => id !== parentId)
  if (!deduplicateChildren) return filtered
  return projectDeduplicatedChildIds(filtered, nodesData, endorsementsReady)
}

export function buildTreeRows(params: {
  rootId: NodeId
  expanded: Set<NodeId>
  childrenMode: 'union' | 'strict'
  strictIncludeUnversionedChildren?: boolean
  deduplicateChildren: boolean
  endorsementsReady: boolean
  nodesData: Record<string, NodeData>
  edgesUnion: EdgeStoreUnion
  edgesStrict: EdgeStoreStrict
}): TreeRow[] {
  const { rootId, expanded, childrenMode, strictIncludeUnversionedChildren, deduplicateChildren, endorsementsReady, nodesData, edgesUnion, edgesStrict } = params
  const rows: TreeRow[] = []
  const childCache = new Map<NodeId, NodeId[]>()
  const seen = new Set<NodeId>()

  const getChildren = (id: NodeId): NodeId[] => {
    const cached = childCache.get(id)
    if (cached) return cached
    const out = getProjectedChildIds({ parentId: id, childrenMode, strictIncludeUnversionedChildren, deduplicateChildren, endorsementsReady, nodesData, edgesUnion, edgesStrict })
    childCache.set(id, out)
    return out
  }

  const stack: Array<{ id: NodeId; depth: number; isLast: boolean }> = [{ id: rootId, depth: 0, isLast: true }]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur.id)) continue
    seen.add(cur.id)
    const children = getChildren(cur.id)
    rows.push({ nodeId: cur.id, depth: cur.depth, isLast: cur.isLast, hasChildren: children.length > 0 })
    if (!expanded.has(cur.id)) continue
    if (!children.length) continue
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: cur.depth + 1, isLast: i === children.length - 1 })
    }
  }
  return rows
}

export function buildTreeRowsFromGraph(params: {
  rootId: NodeId
  expanded: Set<NodeId>
  graph: TreeGraphData
}): TreeRow[] {
  const { rootId, expanded, graph } = params
  const rows: TreeRow[] = []
  const seen = new Set<NodeId>()
  const stack: Array<{ id: NodeId; depth: number; isLast: boolean }> = [{ id: rootId, depth: 0, isLast: true }]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur.id)) continue
    seen.add(cur.id)
    const children = graph.childrenByParent[cur.id] || []
    rows.push({ nodeId: cur.id, depth: cur.depth, isLast: cur.isLast, hasChildren: children.length > 0 })
    if (!expanded.has(cur.id)) continue
    if (!children.length) continue
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: cur.depth + 1, isLast: i === children.length - 1 })
    }
  }
  return rows
}

function walkTree(params: TreeWalkParams): TreeGraphData {
  const { rootId, childrenMode, strictIncludeUnversionedChildren, deduplicateChildren, endorsementsReady, nodesData, edgesUnion, edgesStrict } = params
  if (!rootId) return { nodes: [], edges: [], childrenByParent: {} }
  const nodes: BaseNode[] = []
  const edges: BaseEdge[] = []
  const childrenByParent: Record<NodeId, NodeId[]> = {}
  const visited = new Set<NodeId>()
  const stack: Array<{ id: NodeId; depth: number; parentId?: NodeId }> = [{ id: rootId, depth: 0 }]

  while (stack.length) {
    const cur = stack.pop()!
    if (visited.has(cur.id)) continue
    visited.add(cur.id)
    const parsed = parseNodeId(cur.id)
    nodes.push({ id: cur.id, depth: cur.depth, personHash: parsed.personHash, versionIndex: parsed.versionIndex })
    if (cur.parentId) edges.push({ from: cur.parentId, to: cur.id })

    const children = getProjectedChildIds({
      parentId: cur.id,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    if (children.length) childrenByParent[cur.id] = children
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: cur.depth + 1, parentId: cur.id })
    }
  }

  return { nodes, edges, childrenByParent }
}

export function buildViewGraphData(params: TreeWalkParams): TreeGraphData {
  return walkTree(params)
}
