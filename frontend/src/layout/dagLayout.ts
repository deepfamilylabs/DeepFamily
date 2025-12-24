import type { TreeGraphData } from '../utils/treeData'
import type { NodeId } from '../types/graph'

export function computeDagLayout(graph: TreeGraphData, nodeWidth: number, nodeHeight: number) {
  const levels: Map<number, Array<{ id: NodeId; depth: number }>> = new Map()
  let maxDepthSeen = 0
  graph.nodes.forEach(n => {
    const arr = levels.get(n.depth) || []
    arr.push({ id: n.id as NodeId, depth: n.depth })
    levels.set(n.depth, arr)
    if (n.depth > maxDepthSeen) maxDepthSeen = n.depth
  })
  const margin = { left: 24, top: 24, right: 24, bottom: 24 }
  const gapX = nodeWidth + 220
  const gapY = nodeHeight + 22
  const width = margin.left + margin.right + (maxDepthSeen + 1) * gapX
  const maxPerLevel = Math.max(...Array.from(levels.values()).map(a => a.length)) || 1
  const height = margin.top + margin.bottom + maxPerLevel * gapY
  const positions: Record<NodeId, { x: number; y: number }> = {} as any
  Array.from(levels.entries()).forEach(([depth, arr]) => {
    arr.forEach((n, idx) => {
      const x = margin.left + depth * gapX
      const y = margin.top + idx * gapY
      positions[n.id] = { x, y }
    })
  })
  return { positions, width, height }
}
