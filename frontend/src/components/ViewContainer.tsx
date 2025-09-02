import React, { Suspense } from 'react'
import LoadingSkeleton from './LoadingSkeleton'
import type { GraphNode } from '../types/graph'
import { VirtualizedContractTree } from './Visualization'
import { NodeDetailProvider } from '../context/NodeDetailContext'
import { useTreeData } from '../context/TreeDataContext'

const ForceDAGView = React.lazy(() => import('./ForceDAGView'))
const FlexibleDAGView = React.lazy(() => import('./FlexibleDAGView'))
const MerkleTreeView = React.lazy(() => import('./MerkleTreeView'))

interface ViewContainerProps {
  mode: 'subgraph' | 'contract'
  viewMode: 'dag' | 'tree' | 'force' | 'virtual'
  root: GraphNode | null
  subgraphBlock: React.ReactNode
  contractMessage: string
  loading: boolean
  skeletonLines?: number
}

export default function ViewContainer({ mode, viewMode, root, subgraphBlock, contractMessage }: ViewContainerProps) {
  const isSubgraph = mode === 'subgraph'
  const hasRoot = !!root
  const showContractViews = !isSubgraph && hasRoot
  const { nodesData } = useTreeData()
  // useVizOptions internally inside views / contexts
  const content = (
    <Suspense fallback={<LoadingSkeleton />}> {
      isSubgraph ? (
        hasRoot ? (
          viewMode === 'tree' ? subgraphBlock : subgraphBlock
        ) : (
          subgraphBlock
        )
      ) : showContractViews ? (
        viewMode === 'force' ? <ForceDAGView root={root as GraphNode} />
        : viewMode === 'dag' ? <FlexibleDAGView root={root as GraphNode} nodeWidth={100} nodeHeight={44} />
        : viewMode === 'tree' ? <MerkleTreeView root={root as GraphNode} />
        : <VirtualizedContractTree root={root as GraphNode} height={560} rowHeight={40} />
      ) : (
        contractMessage ? <div className="text-sm text-gray-700">{contractMessage}</div> : <LoadingSkeleton />
      )
    } </Suspense>
  )
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/70 backdrop-blur-sm p-4 transition-colors">
      <NodeDetailProvider>
        <Suspense fallback={<LoadingSkeleton />}>{content}</Suspense>
      </NodeDetailProvider>
    </div>
  )
}
