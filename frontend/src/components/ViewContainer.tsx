import React, { Suspense } from 'react'
import LoadingSkeleton from './LoadingSkeleton'
import ViewModeSwitch from './ViewModeSwitch'
import TreeListView from './TreeListView'
import { NodeDetailProvider } from '../context/NodeDetailContext'
import { EndorseModalProvider } from '../context/EndorseModalContext'
import { LAYOUT } from '../constants/layout'

const ForceGraphView = React.lazy(() => import('./ForceGraphView'))
const DagView = React.lazy(() => import('./DagView'))
const TreeLayoutView = React.lazy(() => import('./TreeLayoutView'))

interface ViewContainerProps {
  viewMode: 'dag' | 'tree' | 'force' | 'virtual'
  hasRoot: boolean
  contractMessage: string
  loading: boolean
  skeletonLines?: number
  onViewModeChange?: (mode: 'dag' | 'tree' | 'force' | 'virtual') => void
  viewModeLabels?: { tree: string; dag: string; force: string; virtual: string }
}

export default function ViewContainer({ viewMode, hasRoot, contractMessage, loading, onViewModeChange, viewModeLabels }: ViewContainerProps) {
  // useVizOptions internally inside views / contexts
  const content = (
    <Suspense fallback={<LoadingSkeleton />}> {
      hasRoot ? (
        viewMode === 'force' ? <ForceGraphView />
        : viewMode === 'dag' ? <DagView />
        : viewMode === 'tree' ? <TreeLayoutView />
        : <TreeListView rowHeight={LAYOUT.ROW_HEIGHT} />
      ) : (
        <div className="w-full min-h-[520px] md:min-h-[680px] bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900/90 dark:via-slate-800/60 dark:to-slate-900/90 transition-all duration-300 p-4 pt-16 flex items-center justify-center">
          {loading ? <LoadingSkeleton /> : contractMessage ? <div className="text-sm text-slate-700 dark:text-slate-300">{contractMessage}</div> : <LoadingSkeleton />}
        </div>
      )
    } </Suspense>
  )
  return (
    <div className="w-full transition-colors relative">
      {/* Floating View Mode Switch - positioned above zoom controls */}
      {onViewModeChange && viewModeLabels && (
        <div className="absolute top-4 right-3 z-10">
          <ViewModeSwitch 
            value={viewMode} 
            onChange={onViewModeChange} 
            labels={viewModeLabels}
          />
        </div>
      )}
      
      <EndorseModalProvider>
        <NodeDetailProvider>
          <Suspense fallback={<LoadingSkeleton />}>{content}</Suspense>
        </NodeDetailProvider>
      </EndorseModalProvider>
    </div>
  )
}
