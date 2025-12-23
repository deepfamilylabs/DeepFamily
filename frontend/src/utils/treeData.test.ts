import { describe, it, expect } from 'vitest'
import { buildTreeRows, getProjectedChildIds } from './treeData'
import { makeNodeId, type NodeData, type NodeId } from '../types/graph'
import type { EdgeStoreStrict, EdgeStoreUnion } from '../types/treeStore'
import { unionParentKey } from '../types/treeStore'

const parentHash = '0xparent'
const childHash = '0xchild'
const otherHash = '0xother'

function makeNodesData(entries: Array<{ id: NodeId; endorsementCount?: number }>): Record<string, NodeData> {
  const out: Record<string, NodeData> = {}
  for (const e of entries) {
    const parts = e.id.split('-v-')
    out[e.id] = {
      personHash: parts[0],
      versionIndex: Number(parts[1]),
      id: e.id,
      endorsementCount: e.endorsementCount
    }
  }
  return out
}

describe('treeData getProjectedChildIds', () => {
  it('uses union edges when childrenMode=union', () => {
    const parentId = makeNodeId(parentHash, 1)
    const unionIds = [makeNodeId(childHash, 2), makeNodeId(otherHash, 1)]
    const edgesUnion: EdgeStoreUnion = {
      [unionParentKey(parentHash)]: { childIds: unionIds, fetchedAt: Date.now() }
    }
    const edgesStrict: EdgeStoreStrict = {}
    const nodesData = makeNodesData([])
    const out = getProjectedChildIds({
      parentId,
      childrenMode: 'union',
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(out).toEqual(unionIds)
  })

  it('uses strict edges when childrenMode=strict', () => {
    const parentId = makeNodeId(parentHash, 2)
    const strictIds = [makeNodeId(childHash, 1)]
    const edgesStrict: EdgeStoreStrict = {
      [parentId]: { childIds: strictIds, fetchedAt: Date.now() }
    }
    const edgesUnion: EdgeStoreUnion = {}
    const nodesData = makeNodesData([])
    const out = getProjectedChildIds({
      parentId,
      childrenMode: 'strict',
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(out).toEqual(strictIds)
  })

  it('ignores the other store based on childrenMode', () => {
    const parentId = makeNodeId(parentHash, 1)
    const unionIds = [makeNodeId(childHash, 2)]
    const strictIds = [makeNodeId(otherHash, 1)]
    const edgesUnion: EdgeStoreUnion = {
      [unionParentKey(parentHash)]: { childIds: unionIds, fetchedAt: Date.now() }
    }
    const edgesStrict: EdgeStoreStrict = {
      [parentId]: { childIds: strictIds, fetchedAt: Date.now() }
    }
    const nodesData = makeNodesData([])
    const unionOut = getProjectedChildIds({
      parentId,
      childrenMode: 'union',
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    const strictOut = getProjectedChildIds({
      parentId,
      childrenMode: 'strict',
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(unionOut).toEqual(unionIds)
    expect(strictOut).toEqual(strictIds)
  })

  it('deduplicates by best endorsement (tie -> lower version)', () => {
    const parentId = makeNodeId(parentHash, 1)
    const v1 = makeNodeId(childHash, 1)
    const v2 = makeNodeId(childHash, 2)
    const v3 = makeNodeId(otherHash, 1)
    const edgesUnion: EdgeStoreUnion = {
      [unionParentKey(parentHash)]: { childIds: [v1, v2, v3], fetchedAt: Date.now() }
    }
    const edgesStrict: EdgeStoreStrict = {}
    const nodesData = makeNodesData([
      { id: v1, endorsementCount: 5 },
      { id: v2, endorsementCount: 7 },
      { id: v3, endorsementCount: 1 }
    ])
    const out = getProjectedChildIds({
      parentId,
      childrenMode: 'union',
      deduplicateChildren: true,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(out).toEqual([v2, v3])
  })

  it('deduplicates by smallest version when endorsements not ready', () => {
    const parentId = makeNodeId(parentHash, 1)
    const v1 = makeNodeId(childHash, 1)
    const v2 = makeNodeId(childHash, 3)
    const edgesUnion: EdgeStoreUnion = {
      [unionParentKey(parentHash)]: { childIds: [v2, v1], fetchedAt: Date.now() }
    }
    const edgesStrict: EdgeStoreStrict = {}
    const nodesData = makeNodesData([])
    const out = getProjectedChildIds({
      parentId,
      childrenMode: 'union',
      deduplicateChildren: true,
      endorsementsReady: false,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(out).toEqual([v1])
  })

  it('includes v0 children when strictIncludeUnversionedChildren=true', () => {
    const parentId = makeNodeId(parentHash, 2)
    const strictIds = [makeNodeId(childHash, 1)]
    const zeroIds = [makeNodeId(otherHash, 1)]
    const edgesStrict: EdgeStoreStrict = {
      [parentId]: { childIds: strictIds, fetchedAt: Date.now() },
      [makeNodeId(parentHash, 0)]: { childIds: zeroIds, fetchedAt: Date.now() }
    }
    const edgesUnion: EdgeStoreUnion = {}
    const nodesData = makeNodesData([])
    const out = getProjectedChildIds({
      parentId,
      childrenMode: 'strict',
      strictIncludeUnversionedChildren: true,
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(out).toEqual([makeNodeId(childHash, 1), makeNodeId(otherHash, 1)])
  })
})

describe('treeData buildTreeRows', () => {
  it('builds rows depth-first with hasChildren flags', () => {
    const rootId = makeNodeId(parentHash, 1)
    const child1 = makeNodeId(childHash, 1)
    const child2 = makeNodeId(otherHash, 1)
    const edgesUnion: EdgeStoreUnion = {
      [unionParentKey(parentHash)]: { childIds: [child1, child2], fetchedAt: Date.now() }
    }
    const edgesStrict: EdgeStoreStrict = {}
    const nodesData = makeNodesData([{ id: rootId }, { id: child1 }, { id: child2 }])
    const expanded = new Set<NodeId>([rootId])
    const rows = buildTreeRows({
      rootId,
      expanded,
      childrenMode: 'union',
      deduplicateChildren: false,
      endorsementsReady: true,
      nodesData,
      edgesUnion,
      edgesStrict
    })
    expect(rows.map(r => r.nodeId)).toEqual([rootId, child1, child2])
    expect(rows[0].hasChildren).toBe(true)
    expect(rows[1].hasChildren).toBe(false)
  })
})
