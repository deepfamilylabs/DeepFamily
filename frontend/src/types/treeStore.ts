import type { NodeId } from './graph'

export type ChildrenMode = 'union' | 'strict'

export type EdgeUnionEntry = {
  childIds: NodeId[]
  fetchedAt: number
  totalVersions?: number
}

export type EdgeStrictEntry = {
  childIds: NodeId[]
  fetchedAt: number
  totalCount?: number
}

export type EdgeStoreUnion = Record<string, EdgeUnionEntry> // key: parentHashLower
export type EdgeStoreStrict = Record<NodeId, EdgeStrictEntry> // key: parent NodeId

export function unionParentKey(parentHash: string): string {
  return String(parentHash || '').toLowerCase()
}

