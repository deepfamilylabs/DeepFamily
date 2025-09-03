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
        <div className="w-full bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 rounded-2xl transition-all duration-300 border border-slate-200/50 dark:border-slate-700/50 shadow-xl backdrop-blur-sm p-4 min-h-[560px]">
          {hasRoot ? (
            viewMode === 'tree' ? subgraphBlock : subgraphBlock
          ) : (
            subgraphBlock
          )}
        </div>
      ) : showContractViews ? (
        viewMode === 'force' ? <ForceDAGView root={root as GraphNode} />
        : viewMode === 'dag' ? <FlexibleDAGView root={root as GraphNode} nodeWidth={100} nodeHeight={44} />
        : viewMode === 'tree' ? <MerkleTreeView root={root as GraphNode} />
        : <VirtualizedContractTree root={root as GraphNode} height={560} rowHeight={40} />
      ) : (
        <div className="w-full bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 rounded-2xl transition-all duration-300 border border-slate-200/50 dark:border-slate-700/50 shadow-xl backdrop-blur-sm p-4 min-h-[560px] flex items-center justify-center">
          {contractMessage ? <div className="text-sm text-slate-700 dark:text-slate-300">{contractMessage}</div> : <LoadingSkeleton />}
        </div>
      )
    } </Suspense>
  )
  return (
    <div className="w-full transition-colors">
      <NodeDetailProvider>
        <Suspense fallback={<LoadingSkeleton />}>{content}</Suspense>
      </NodeDetailProvider>
    </div>
  )
}
