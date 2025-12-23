import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FixedSizeList as VirtualList, type ListChildComponentProps } from 'react-window'
import { useFamilyTreeHeight, LAYOUT } from '../constants/layout'
import { useTreeData } from '../context/TreeDataContext'
import { useNodeDetail } from '../context/NodeDetailContext'
import { useVizOptions } from '../context/VizOptionsContext'
import { parseNodeId, shortHash, isMinted, type NodeId } from '../types/graph'
import { getGenderColor } from '../constants/genderColors'
import { buildTreeRows, type TreeRow } from '../utils/treeData'
import EndorseCompactModal from './modals/EndorseCompactModal'

export default function VirtualizedIdTree({ rowHeight = LAYOUT.ROW_HEIGHT }: { rowHeight?: number }) {
  const familyTreeHeight = useFamilyTreeHeight()
  const { rootId, endorsementsReady, nodesData, edgesUnion, edgesStrict, bumpEndorsementCount } = useTreeData()
  const { openNode, selected } = useNodeDetail()
  const { deduplicateChildren, childrenMode, strictIncludeUnversionedChildren } = useVizOptions()
  const selectedKey = selected ? `${selected.personHash}-v-${selected.versionIndex}` : null
  const [expanded, setExpanded] = useState<Set<NodeId>>(() => new Set(rootId ? [rootId] : []))
  const [endorseModal, setEndorseModal] = useState<{ open: boolean; personHash: string; versionIndex: number; fullName?: string; endorsementCount?: number }>({ open: false, personHash: '', versionIndex: 1 })

  useEffect(() => {
    setExpanded(new Set(rootId ? [rootId] : []))
  }, [rootId])

  const rows = useMemo<TreeRow[]>(() => {
    if (!rootId) return []
    return buildTreeRows({
      rootId,
      expanded,
      childrenMode,
      strictIncludeUnversionedChildren: childrenMode === 'strict' ? strictIncludeUnversionedChildren : undefined,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict
    })
  }, [childrenMode, deduplicateChildren, endorsementsReady, edgesStrict, edgesUnion, expanded, nodesData, rootId, strictIncludeUnversionedChildren])

  const toggle = useCallback((nodeId: NodeId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const Row = useCallback(({ index, style }: ListChildComponentProps) => {
    const row = rows[index]
    const { nodeId, depth, isLast, hasChildren } = row
    const parsed = parseNodeId(nodeId)
    const k = nodeId
    const isOpen = expanded.has(nodeId)
    const nd = nodesData?.[nodeId]
    const name = nd?.fullName
    const endorse = nd?.endorsementCount
    const mintedFlag = isMinted(nd)
    const gender = nd?.gender as number | undefined
    const isSel = selectedKey === k

    const ancestorGuides: boolean[] = []
    if (depth > 0) {
      let currentDepth = depth - 1
      for (let i = index - 1; i >= 0 && currentDepth >= 0; i--) {
        const r = rows[i]
        if (r.depth === currentDepth) { ancestorGuides[currentDepth] = !r.isLast; currentDepth-- }
      }
    }

    const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement)?.closest?.('[data-endorse-btn="true"]')) return
      openNode({ personHash: parsed.personHash, versionIndex: parsed.versionIndex })
    }

    const openEndorseModal = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setEndorseModal({
        open: true,
        personHash: parsed.personHash,
        versionIndex: parsed.versionIndex,
        fullName: name,
        endorsementCount: endorse
      })
    }

    return (
      <div
        style={{ ...style }}
        className={`group font-mono text-[12px] flex items-stretch relative ${isSel ? 'bg-amber-100 dark:bg-amber-900/40' : ''} hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors cursor-pointer`}
        onClick={handleRowClick}
      >
        <div className="absolute inset-y-0 left-0 flex pointer-events-none">
          {ancestorGuides.map((show, i) => show ? (
            <div key={i} className="w-4 flex-shrink-0 relative">
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />
            </div>
          ) : (
            <div key={i} className="w-4" />
          ))}
        </div>

        <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-1 pl-1 pr-2 min-w-[140px] relative" title={parsed.personHash}>
          <div className="flex items-center">
            {depth > 0 && (
              <div className="relative w-4" style={{ height: rowHeight }}>
                <div className="absolute left-1/2 -translate-x-1/2 top-0 w-px h-1/2 bg-slate-300 dark:bg-slate-600" />
                {!isLast && <div className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />}
                <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 h-px w-1/2 bg-slate-300 dark:bg-slate-600" />
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); hasChildren && toggle(nodeId) }}
              className={`mr-1 ${hasChildren ? 'w-5 h-5 text-[10px]' : 'w-5 h-5 text-lg leading-none'} grid place-items-center rounded border ${hasChildren ? 'bg-white dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700 border-slate-300 dark:border-gray-600 text-slate-700 dark:text-slate-300' : 'border-transparent text-slate-400 dark:text-slate-500 cursor-default'}`}
            >
              {hasChildren ? (isOpen ? '−' : '+') : '•'}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-max">
            <span className="text-slate-600 dark:text-slate-300">{shortHash(parsed.personHash)}</span>
            <span className="text-sky-600 dark:text-sky-400">
              {nd?.totalVersions && nd.totalVersions > 1 ? `T${nd.totalVersions}:v${parsed.versionIndex}` : `v${parsed.versionIndex}`}
            </span>
            {endorse !== undefined && (
              <button
                type="button"
                data-endorse-btn="true"
                onClick={openEndorseModal}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${mintedFlag ? 'hover:bg-emerald-50 dark:hover:bg-emerald-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'}`}
                title="Endorsements"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" className="flex-shrink-0">
                  <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9L10 15l-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L10 1.5z" className={mintedFlag ? 'fill-emerald-500' : 'fill-slate-500'} />
                </svg>
                <span className={`font-mono text-[12px] ${mintedFlag ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}`}>{endorse}</span>
              </button>
            )}
            {mintedFlag && (
              <>
                <span className="text-[10px] px-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/40">NFT</span>
                <span className={`ml-1 inline-block w-2 h-2 rounded-full ${getGenderColor(gender, 'BG')} ring-1 ring-white dark:ring-slate-900`} />
              </>
            )}
            {name && <span className="text-slate-700 dark:text-slate-200 text-[12px] truncate max-w-[180px]" title={name}>{name}</span>}
            {nd?.tag && <span className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/40 px-1 rounded" title={nd.tag}>{nd.tag}</span>}
          </div>
        </div>
      </div>
    )
  }, [rows, expanded, rowHeight, toggle, openNode, selectedKey, nodesData, setEndorseModal])

  if (!rootId) return null

  return (
    <div className="w-full transition-all duration-300 overflow-hidden" style={{ height: familyTreeHeight }}>
      <div className="p-4 pt-16 h-full overflow-x-auto">
        <VirtualList height={familyTreeHeight - 32} itemCount={rows.length} itemSize={rowHeight} width={'auto'}>{Row}</VirtualList>
      </div>
      <EndorseCompactModal
        isOpen={endorseModal.open}
        onClose={() => setEndorseModal(m => ({ ...m, open: false }))}
        personHash={endorseModal.personHash}
        versionIndex={endorseModal.versionIndex}
        versionData={{
          fullName: endorseModal.fullName,
          endorsementCount: endorseModal.endorsementCount
        }}
        onSuccess={() => bumpEndorsementCount?.(endorseModal.personHash, endorseModal.versionIndex, 1)}
      />
    </div>
  )
}
