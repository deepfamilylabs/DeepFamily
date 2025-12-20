import type { GraphNode, NodeData } from '../types/graph'
import { makeNodeId } from '../types/graph'

type DedupPickMode = 'byEndorsement' | 'byMinVersion'

function pickBestChild(children: GraphNode[], nodesData: Record<string, NodeData>, mode: DedupPickMode): GraphNode {
  if (children.length === 1) return children[0]

  if (mode === 'byMinVersion') {
    let best = children[0]
    for (let i = 1; i < children.length; i++) {
      const c = children[i]
      if (Number(c.versionIndex) < Number(best.versionIndex)) best = c
    }
    return best
  }

  let best = children[0]
  let bestEndorse = nodesData[makeNodeId(best.personHash, Number(best.versionIndex))]?.endorsementCount
  bestEndorse = typeof bestEndorse === 'number' ? bestEndorse : -Infinity

  for (let i = 1; i < children.length; i++) {
    const c = children[i]
    let endorse = nodesData[makeNodeId(c.personHash, Number(c.versionIndex))]?.endorsementCount
    endorse = typeof endorse === 'number' ? endorse : -Infinity

    if (endorse > bestEndorse) {
      best = c
      bestEndorse = endorse
      continue
    }
    if (endorse === bestEndorse && Number(c.versionIndex) < Number(best.versionIndex)) {
      best = c
      bestEndorse = endorse
    }
  }
  return best
}

export function projectDeduplicatedRoot(params: {
  root: GraphNode
  nodesData: Record<string, NodeData>
  preferStableUntilReady?: boolean
  endorsementsReady?: boolean
}): GraphNode {
  const { root, nodesData, preferStableUntilReady = true, endorsementsReady = true } = params
  const mode: DedupPickMode = (preferStableUntilReady && !endorsementsReady) ? 'byMinVersion' : 'byEndorsement'

  const visit = (n: GraphNode): GraphNode => {
    const children = n.children || []
    if (children.length === 0) return { ...n }

    const groups = new Map<string, GraphNode[]>()
    for (const c of children) {
      const k = c.personHash.toLowerCase()
      const arr = groups.get(k)
      if (arr) arr.push(c)
      else groups.set(k, [c])
    }

    const picked: GraphNode[] = []
    for (const [, groupChildren] of groups) {
      const chosen = pickBestChild(groupChildren, nodesData, mode)
      picked.push(visit(chosen))
    }

    return { ...n, children: picked }
  }

  return visit(root)
}

