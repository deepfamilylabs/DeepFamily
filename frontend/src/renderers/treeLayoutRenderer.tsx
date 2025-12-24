import React from 'react'
import NodeCard from '../components/NodeCard'
import type { NodeId } from '../types/graph'
import type { NodeUi } from '../utils/familyTreeNodeUi'
import type { TreePositionedEdge, TreePositionedNode } from '../layout/treeLayout'

export function TreeLayoutDefs() {
  return (
    <defs>
      <linearGradient id="cardGlossGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="30%" stopColor="#ffffff" stopOpacity="0.15" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}

export function TreeLayoutEdges(props: {
  edges: TreePositionedEdge[]
  idToPos: Map<string, TreePositionedNode>
  nodeWidth: number
  nodeHeight: number
}) {
  const { edges, idToPos, nodeWidth, nodeHeight } = props
  return (
    <g className="stroke-blue-300/70 dark:stroke-blue-500/60" strokeWidth={2} fill="none">
      {edges.map(edge => {
        const childId = edge.to
        const parentId = edge.from
        const childPos = idToPos.get(childId)
        const parentPos = idToPos.get(parentId)
        if (!parentPos) return null
        if (!childPos) return null
        const x1 = parentPos.x + nodeWidth / 2
        const y1 = parentPos.y + nodeHeight
        const x2 = childPos.x + nodeWidth / 2
        const y2 = childPos.y
        const mx = (x1 + x2) / 2
        const path = `M ${x1} ${y1} C ${mx} ${y1 + 24}, ${mx} ${y2 - 24}, ${x2} ${y2}`
        return <path key={`${parentId}->${childId}`} d={path} />
      })}
    </g>
  )
}

export function TreeLayoutNodes(props: {
  nodes: TreePositionedNode[]
  nodeWidth: number
  nodeHeight: number
  nodeUiById: Record<NodeId, NodeUi>
  selectedId: NodeId | null
  hoverId: string | null
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>
  deduplicateChildren: boolean
  actions: {
    openNodeById: (id: NodeId) => void
    openEndorseById: (id: NodeId) => void
    copyHash: (personHash: string) => void
  }
}) {
  const { nodes, nodeWidth, nodeHeight, nodeUiById, selectedId, hoverId, setHoverId, deduplicateChildren, actions } = props
  return (
    <g>
      {nodes.map(pn => {
        const ui = nodeUiById[pn.id]
        const isSel = pn.id === selectedId
        const isHover = hoverId === pn.id
        const tagText = (ui.tagText || '')
        const totalVersions = deduplicateChildren ? ui.totalVersions : undefined
        const handleEndorse = () => actions.openEndorseById(pn.id)
        return (
          <g key={pn.id}
            transform={`translate(${pn.x}, ${pn.y})`}
            onMouseEnter={() => setHoverId(pn.id)}
            onMouseLeave={() => setHoverId(h => (h === pn.id ? null : h))}
            onClick={() => actions.openNodeById(pn.id)}
            onDoubleClick={() => ui.personHash && actions.copyHash(ui.personHash)}
            className="cursor-pointer"
          >
            <title>{ui.personHash}</title>
            <NodeCard
              w={nodeWidth}
              h={nodeHeight}
              minted={ui.minted}
              selected={isSel}
              hover={isHover}
              versionText={ui.versionText}
              titleText={ui.titleText}
              tagText={tagText}
              gender={ui.gender}
              birthPlace={ui.birthPlace}
              birthDateText={ui.birthDateText}
              shortHashText={ui.shortHashText}
              endorsementCount={ui.endorsementCount}
              totalVersions={totalVersions}
              onEndorseClick={handleEndorse}
            />
          </g>
        )
      })}
    </g>
  )
}
