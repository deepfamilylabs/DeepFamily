// Minimal React tree rendering demo for DeepFamily (migrated)
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import HashBadge from './HashBadge'
import { shortHash } from '../types/graph'
import { ethers } from 'ethers'
import { useNavigate } from 'react-router-dom'
import { useConfig } from '../context/ConfigContext'
import { makeNodeId, type GraphNode, isMinted } from '../types/graph'
import { FixedSizeList as VirtualList, ListChildComponentProps } from 'react-window'
import { getRuntimeFamilyTreeConfig } from '../config/familyTreeConfig'
import { useNodeDetail } from '../context/NodeDetailContext'
import { useTreeData } from '../context/TreeDataContext'
import { LAYOUT, useFamilyTreeHeight } from '../constants/layout'
import { getGenderColor } from '../constants/genderColors'

const Node: React.FC<{ node: GraphNode; depth?: number; isLast?: boolean }> = React.memo(function Node({ node, depth = 0, isLast = true }) {
  const indentPx = depth * 16
  const branch = depth === 0 ? "" : (isLast ? "└─ " : "├─ ")
  const [open, setOpen] = useState(true)
  const hasChildren = !!(node.children && node.children.length > 0)
  const navigate = useNavigate()
  const cfg = useConfig()
  const goDetail = useCallback(() => { cfg.update({ rootHash: node.personHash, rootVersionIndex: node.versionIndex }); navigate(`/familyTree?root=${node.personHash}&v=${node.versionIndex}`) }, [cfg, navigate, node.personHash, node.versionIndex])
  const toggle = useCallback(() => setOpen(o => !o), [])
  return (
    <li>
      <div className="flex items-center gap-2 group" style={{ marginLeft: indentPx, whiteSpace: 'pre' }}>
        <span className="text-gray-400 select-none">{branch}</span>
        <button onClick={toggle} className="w-5 h-5 grid place-items-center rounded hover:bg-gray-100 text-gray-500" aria-label={hasChildren ? (open ? 'collapse' : 'expand') : 'leaf'}>
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </button>
        <HashBadge hash={node.personHash} onNavigate={goDetail} />
        <span className="text-sm text-gray-500 font-medium">v{node.versionIndex}</span>
        {node.tag ? <span className="text-xs text-blue-600">({node.tag})</span> : null}
      </div>
      {open && hasChildren && (
        <ul className="list-none m-0 p-0">
          {node.children!.map((child, i) => (
            <Node key={`${child.personHash}-${child.versionIndex}-${i}`} node={child} depth={depth + 1} isLast={i === node.children!.length - 1} />
          ))}
        </ul>
      )}
    </li>
  )
}, (prev, next) => (
  prev.node.personHash === next.node.personHash &&
  prev.node.versionIndex === next.node.versionIndex &&
  prev.node.tag === next.node.tag &&
  (prev.node.children?.length || 0) === (next.node.children?.length || 0) &&
  prev.depth === next.depth &&
  prev.isLast === next.isLast
))

/**
 * Depth-first fetch Merkle / Family subtree.
 * Optimization features:
 * - AbortSignal
 * - Version info + child node paging cache (avoid duplicate RPC)
 * - Concurrency limits / node hard limits
 * - onNode callback (when node is first created)
 */
export type FilterInput = { personHash: string; versionIndex: number; depth: number; tag?: string }
export type FilterDecision = boolean | { include?: boolean; descend?: boolean }
export type FetchSubtreeOptions = {
  maxDepth?: number
  pageSize?: number
  parallel?: number
  signal?: AbortSignal
  hardNodeLimit?: number
  onNode?: (node: GraphNode) => void
  filter?: (info: FilterInput) => FilterDecision
  onProgress?: (stats: { created: number; visited: number; depth: number }) => void
  onStats?: (metrics: WalkerMetrics) => void
  statsIntervalMs?: number
  traversal?: 'dfs' | 'bfs'
  adaptiveConcurrency?: boolean
  minParallel?: number
  maxParallel?: number
  deduplicateChildren?: boolean // true: show highest-endorsed version only, false: keep every version
  onVersionStats?: (personHash: string, totalVersions: number) => void // Callback when totalVersions is fetched
}

export interface WalkerMetrics {
  created: number
  visited: number
  depth: number
  versionCacheHits: number
  versionCacheMisses: number
  childrenCacheHits: number
  childrenCacheMisses: number
  avgVersionMs: number
  avgChildrenMs: number
  parallel: number
}

function createTreeLoader(params: { contract: ethers.Contract; pageSize: number; signal?: AbortSignal; onStats?: (m: WalkerMetrics)=>void; metricsRef: React.MutableRefObject<WalkerMetrics>; statsIntervalMs?: number; deduplicateChildren?: boolean; onVersionStats?: (personHash: string, totalVersions: number) => void }) {
  const { contract, pageSize, signal, onStats, metricsRef, statsIntervalMs, deduplicateChildren = true, onVersionStats } = params
  const versionCache = new Map<string, { tag?: string }>()
  const childrenCache = new Map<string, { childHashes: string[]; childVersionIndices: (number|bigint)[]; hasMore: boolean; nextOffset: number; pageOffset: number }>()
  const unversionedChildrenCache = new Map<string, { childHashes: string[]; childVersionIndices: number[] }>()
  const bestVersionCache = new Map<string, number>()
  const key = (h: string, v: number) => `${h.toLowerCase()}-v-${v}`
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
  let lastStatsEmit = 0
  function emit(now: number) {
    if (!onStats) return
    if (!statsIntervalMs || now - lastStatsEmit >= statsIntervalMs) { lastStatsEmit = now; onStats({ ...metricsRef.current }) }
  }

  async function loadVersion(h: string, v: number) {
    checkAbort()
    const k = key(h, v)
    const start = performance.now()
    // tags no longer fetched separately; keep structure for potential future fields
    if (!versionCache.has(k)) { metricsRef.current.versionCacheMisses++; versionCache.set(k, { tag: undefined }) } else { metricsRef.current.versionCacheHits++ }
    emit(start)
    return versionCache.get(k)!
  }

  async function getBestVersion(personHash: string): Promise<number> {
    checkAbort()
    const cacheKey = personHash.toLowerCase()
    if (bestVersionCache.has(cacheKey)) {
      return bestVersionCache.get(cacheKey)!
    }
    try {
      const stats = await contract.listVersionsEndorsementStats(personHash, 0, 100)
      let bestVersion = 1
      let maxEndorsements = -1
      for (let i = 0; i < stats.versionIndices.length; i++) {
        const versionIndex = Number(stats.versionIndices[i])
        const endorsementCount = Number(stats.endorsementCounts[i])
        if (endorsementCount > maxEndorsements) {
          maxEndorsements = endorsementCount
          bestVersion = versionIndex
        }
      }
      bestVersionCache.set(cacheKey, bestVersion)
      return bestVersion
    } catch (e) {
      bestVersionCache.set(cacheKey, 1)
      return 1
    }
  }

  async function loadUnversionedChildren(h: string) {
    checkAbort()
    const cacheKey = h.toLowerCase()
    if (unversionedChildrenCache.has(cacheKey)) {
      return unversionedChildrenCache.get(cacheKey)!
    }

    const collectedHashes: string[] = []
    const collectedVersions: number[] = []
    let offset = 0

    try {
      while (true) {
        checkAbort()
        const response = await contract.listChildren(h, 0, offset, pageSize)
        const hashes = response[0] as string[]
        const versions = response[1] as (number | bigint)[]
        for (let i = 0; i < hashes.length; i++) {
          collectedHashes.push(hashes[i])
          collectedVersions.push(Number(versions[i]))
        }
        const hasMore = Boolean(response[3])
        const nextOffset = Number(response[4])
        if (!hasMore || nextOffset === offset) break
        offset = nextOffset
      }
    } catch {
      // Swallow errors and treat as no unversioned children
    }

    const entry = { childHashes: collectedHashes, childVersionIndices: collectedVersions }
    unversionedChildrenCache.set(cacheKey, entry)
    return entry
  }

  async function loadAllChildrenAcrossVersions(h: string): Promise<{ childHashes: string[]; childVersionIndices: number[] }> {
    checkAbort()
    const cacheKey = `${h.toLowerCase()}:all-versions`
    if (unversionedChildrenCache.has(cacheKey)) {
      return unversionedChildrenCache.get(cacheKey)!
    }

    const collectedHashes: string[] = []
    const collectedVersions: number[] = []

    try {
      // First get the total number of versions for this parent using listVersionsEndorsementStats
      const stats = await contract.listVersionsEndorsementStats(h, 0, 1)
      const totalVersions = Number(stats.totalVersions || stats[3])

      // Query children for v=0 and all parent versions (v=1, v=2, ...)
      for (let parentVer = 0; parentVer <= totalVersions; parentVer++) {
        let offset = 0
        while (true) {
          checkAbort()
          const response = await contract.listChildren(h, parentVer, offset, pageSize)
          const hashes = response[0] as string[]
          const versions = response[1] as (number | bigint)[]
          for (let i = 0; i < hashes.length; i++) {
            collectedHashes.push(hashes[i])
            collectedVersions.push(Number(versions[i]))
          }
          const hasMore = Boolean(response[3])
          const nextOffset = Number(response[4])
          if (!hasMore || nextOffset === offset) break
          offset = nextOffset
        }
      }
    } catch (e) {
      // Swallow errors and return what we have
    }

    const entry = { childHashes: collectedHashes, childVersionIndices: collectedVersions }
    unversionedChildrenCache.set(cacheKey, entry)
    return entry
  }

  async function loadChildrenPage(h: string, v: number, offset: number) {
    checkAbort()
    const cacheKey = `${key(h,v)}:o:${offset}:dedup:${deduplicateChildren ? 1 : 0}`
    const start = performance.now()
    if (childrenCache.has(cacheKey)) { metricsRef.current.childrenCacheHits++; emit(start); return childrenCache.get(cacheKey)! }
    metricsRef.current.childrenCacheMisses++
    try {
      const r = await contract.listChildren(h, v, offset, pageSize)
      let childHashes = r[0] as string[]
      let childVersionIndices = r[1] as (number|bigint)[]

      // When deduplication is disabled, load children from ALL parent versions
      // This ensures all versions are visible (e.g., a child version might be under a specific fatherVersionIndex)
      if (!deduplicateChildren && offset === 0) {
        const allChildren = await loadAllChildrenAcrossVersions(h)
        childHashes = allChildren.childHashes
        childVersionIndices = allChildren.childVersionIndices
      } else if (deduplicateChildren && v !== 0) {
        // When deduplication is enabled, merge unversioned children (v=0) with versioned children
        // This ensures children added with fatherVersionIndex=0 are visible
        const zeroChildren = await loadUnversionedChildren(h)
        if (zeroChildren.childHashes.length) {
          childHashes = childHashes.concat(zeroChildren.childHashes)
          childVersionIndices = childVersionIndices.concat(zeroChildren.childVersionIndices)
        }
      }

      // Deduplication & version resolution (controlled by deduplicateChildren option)
      if (deduplicateChildren) {
        const childMap = new Map<string, { hash: string; versions: number[] }>()

        // First pass: collect all versions of each personHash that exist under this parent
        for (let i = 0; i < childHashes.length; i++) {
          const childHash = childHashes[i].toLowerCase()
          let childVersion = Number(childVersionIndices[i])

          if (childMap.has(childHash)) {
            const existing = childMap.get(childHash)!
            existing.versions.push(childVersion)
          } else {
            childMap.set(childHash, { hash: childHashes[i], versions: [childVersion] })
          }
        }

        // Second pass: for all children, fetch totalVersions and find best version
        const finalChildren: Array<{ hash: string; version: number }> = []
        for (const [, entry] of childMap.entries()) {
          // Always fetch endorsement stats to get totalVersions (for badge display)
          const stats = await contract.listVersionsEndorsementStats(entry.hash, 0, 100)

          const endorsementMap = new Map<number, number>()
          const versionIndices = stats.versionIndices || stats[0]
          const endorsementCounts = stats.endorsementCounts || stats[1]
          const totalVersions = Number(stats.totalVersions || stats[3] || 0)

          // Store totalVersions for this personHash (needed for multi-version badge)
          if (onVersionStats && totalVersions > 0) {
            onVersionStats(entry.hash, totalVersions)
          }

          for (let i = 0; i < versionIndices.length; i++) {
            endorsementMap.set(Number(versionIndices[i]), Number(endorsementCounts[i]))
          }

          if (entry.versions.length > 1) {
            // Multiple versions under this parent: find best version among them
            let bestVersion = entry.versions[0]
            let maxEndorsements = endorsementMap.get(bestVersion) ?? 0
            for (const ver of entry.versions) {
              const endorsements = endorsementMap.get(ver) ?? 0
              if (endorsements > maxEndorsements || (endorsements === maxEndorsements && ver < bestVersion)) {
                maxEndorsements = endorsements
                bestVersion = ver
              }
            }
            finalChildren.push({ hash: entry.hash, version: bestVersion })
          } else {
            // Only one version under this parent, keep it
            finalChildren.push({ hash: entry.hash, version: entry.versions[0] })
          }
        }

        // Rebuild deduplicated arrays
        childHashes = finalChildren.map(c => c.hash)
        childVersionIndices = finalChildren.map(c => c.version)
      }

      const entry = { childHashes, childVersionIndices, hasMore: Boolean(r[3]), nextOffset: Number(r[4]), pageOffset: offset }
      childrenCache.set(cacheKey, entry)
      return entry
    } catch {
      const entry = { childHashes: [], childVersionIndices: [], hasMore: false, nextOffset: offset, pageOffset: offset }
      childrenCache.set(cacheKey, entry)
      return entry
    } finally {
      const dur = performance.now() - start
      const m = metricsRef.current
      m.avgChildrenMs = m.avgChildrenMs === 0 ? dur : (m.avgChildrenMs * 0.9 + dur * 0.1)
      emit(performance.now())
    }
  }
  return { loadVersion, loadChildrenPage, key, checkAbort }
}

async function* walkSubtree(
  contract: ethers.Contract,
  personHash: string,
  versionIndex: number,
  options?: FetchSubtreeOptions
): AsyncGenerator<GraphNode, GraphNode, void> {
  const runtimeCfg = getRuntimeFamilyTreeConfig()
  const maxDepth = options?.maxDepth ?? runtimeCfg.DEFAULT_MAX_DEPTH
  const pageSize = options?.pageSize ?? 25
  let parallel = Math.max(1, options?.parallel ?? 6)
  const signal = options?.signal
  const hardNodeLimit = options?.hardNodeLimit ?? 2500
  const filter = options?.filter
  const onNode = options?.onNode
  const onProgress = options?.onProgress
  const onStats = options?.onStats
  const traversal = options?.traversal || 'dfs'
  const adaptive = options?.adaptiveConcurrency !== false
  const minParallel = Math.max(1, options?.minParallel ?? 1)
  const maxParallel = Math.max(minParallel, options?.maxParallel ?? parallel * 2)
  const metricsRef = { current: { created:0, visited:0, depth:0, versionCacheHits:0, versionCacheMisses:0, childrenCacheHits:0, childrenCacheMisses:0, avgVersionMs:0, avgChildrenMs:0, parallel } as WalkerMetrics }
  const { loadVersion, loadChildrenPage, key, checkAbort } = createTreeLoader({ contract, pageSize, signal, onStats, metricsRef, statsIntervalMs: options?.statsIntervalMs, deduplicateChildren: options?.deduplicateChildren, onVersionStats: options?.onVersionStats })
  if (signal?.aborted) throw new DOMException('Aborted','AbortError')
  const visited = new Set<string>()
  const root: GraphNode = { personHash, versionIndex, children: [] }

  function decide(fi: FilterInput): { include: boolean; descend: boolean } {
    const r = filter ? filter(fi) : true
    if (typeof r === 'boolean') return { include: r, descend: r }
    return { include: r.include !== false, descend: r.descend !== false }
  }

  async function* dfs(h: string, v: number, depth: number, parent?: GraphNode): AsyncGenerator<GraphNode, void, void> {
    checkAbort()
    const k = key(h, v)
    if (visited.has(k) || depth > maxDepth || metricsRef.current.created >= hardNodeLimit) return
    visited.add(k)
    metricsRef.current.visited = visited.size
    const { tag } = await loadVersion(h, v)
    const { include, descend } = decide({ personHash: h, versionIndex: v, depth, tag })
    let node: GraphNode | undefined
    if (include) {
      metricsRef.current.created++
      metricsRef.current.depth = depth
      if (parent) {
        node = { personHash: h, versionIndex: v, tag, children: [] }
        parent.children = parent.children ? [...parent.children, node] : [node]
      } else {
        node = root
        node.tag = tag
      }
      onNode?.(node)
      onProgress?.({ created: metricsRef.current.created, visited: visited.size, depth })
      yield node
    }
    if (!descend || depth >= maxDepth || metricsRef.current.created >= hardNodeLimit) return

    let offset = 0
    let prefetch: Promise<any> | null = null
    while (true) {
      checkAbort()
      if (metricsRef.current.created >= hardNodeLimit) break
      const page = prefetch ? await prefetch : await loadChildrenPage(h, v, offset)
      prefetch = null
      const { childHashes, childVersionIndices, hasMore, nextOffset } = page
      if (hasMore) prefetch = loadChildrenPage(h, v, nextOffset)
      if (childHashes.length && node) {
        const tasks = childHashes.map((ch: string, i: number)=>({ ch, cv:Number(childVersionIndices[i]) }))
        if (adaptive) {
          const m = metricsRef.current
            if (m.avgChildrenMs > 900 && parallel > minParallel) parallel = Math.max(minParallel, Math.floor(parallel/2))
            else if (m.avgChildrenMs < 250 && parallel < maxParallel) parallel = Math.min(maxParallel, parallel+1)
            m.parallel = parallel
        }
        for (let i=0; i<tasks.length; i+=parallel) {
          const slice = tasks.slice(i, i+parallel)
          for (const t of slice) { for await (const _ of dfs(t.ch, t.cv, depth+1, node)) { /* streaming forward */ } }
          if (metricsRef.current.created >= hardNodeLimit) break
        }
      }
      if (!hasMore || metricsRef.current.created >= hardNodeLimit) break
      offset = nextOffset
    }
  }

  async function* bfs(): AsyncGenerator<GraphNode, void, void> {
    const queue: Array<{ h:string; v:number; depth:number; parent?: GraphNode }> = [{ h: personHash, v: versionIndex, depth:1 }]
    while (queue.length) {
      checkAbort(); if (metricsRef.current.created >= hardNodeLimit) break
      const { h, v, depth, parent } = queue.shift()!
      const k = key(h,v)
      if (visited.has(k) || depth > maxDepth) continue
      visited.add(k); metricsRef.current.visited = visited.size
      const { tag } = await loadVersion(h,v)
      const { include, descend } = decide({ personHash: h, versionIndex: v, depth, tag })
      let node: GraphNode | undefined
      if (include) {
        metricsRef.current.created++; metricsRef.current.depth=depth
        node = parent ? { personHash:h, versionIndex:v, tag, children:[] } : root
        if (parent) parent.children = parent.children ? [...parent.children, node] : [node]; else root.tag = tag
        onNode?.(node); onProgress?.({ created: metricsRef.current.created, visited: visited.size, depth }); yield node!
      }
      if (!descend || depth >= maxDepth || metricsRef.current.created >= hardNodeLimit) continue
      let offset = 0; let prefetch: Promise<any>|null = null
      while (true) {
        checkAbort(); if (metricsRef.current.created >= hardNodeLimit) break
        const page = prefetch ? await prefetch : await loadChildrenPage(h,v,offset); prefetch=null
        const { childHashes, childVersionIndices, hasMore, nextOffset } = page
        if (hasMore) prefetch = loadChildrenPage(h,v,nextOffset)
        for (let i=0;i<childHashes.length;i++) queue.push({ h: childHashes[i], v:Number(childVersionIndices[i]), depth: depth+1, parent: node })
        if (!hasMore) break; offset = nextOffset
      }
    }
  }

  if (traversal === 'bfs') { for await (const _ of bfs()) {/* streaming bfs */} } else { for await (const _ of dfs(personHash, versionIndex, 1)) {/* streaming dfs */} }
  return root
}

export async function fetchSubtree(contract: ethers.Contract, personHash: string, versionIndex: number, options?: FetchSubtreeOptions) {
  const gen = walkSubtree(contract, personHash, versionIndex, options)
  let root: GraphNode | null = null
  for await (const node of gen) { if (!root) root = node }
  return root!
}

export async function* fetchSubtreeStream(contract: ethers.Contract, personHash: string, versionIndex: number, options?: FetchSubtreeOptions) {
  yield* walkSubtree(contract, personHash, versionIndex, options)
}

interface FlatRow { node: GraphNode; depth: number; isLast: boolean }
function flattenTree(root: GraphNode, expanded: Set<string>): FlatRow[] {
  const rows: FlatRow[] = []
  const stack: Array<{ node: GraphNode; depth: number }> = [{ node: root, depth: 0 }]
  while (stack.length) {
    const { node, depth } = stack.pop()!
    rows.push({ node, depth, isLast: true })
    if (expanded.has(node.personHash + ':' + node.versionIndex) && node.children && node.children.length) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1 })
    }
  }
  function mark(parent: GraphNode) {
    const key = parent.personHash + ':' + parent.versionIndex
    if (!expanded.has(key) || !parent.children) return
    parent.children.forEach((c,i)=>{
      const idx = rows.findIndex(r => r.node === c)
      if (idx >= 0) rows[idx].isLast = i === parent.children!.length -1
      mark(c)
    })
  }
  mark(root)
  return rows
}

export const VirtualizedContractTree: React.FC<{ root: GraphNode; height?: number; rowHeight?: number }> = ({ root, height, rowHeight = LAYOUT.ROW_HEIGHT }) => {
  const familyTreeHeight = useFamilyTreeHeight()
  const { nodesData } = useTreeData() as any
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.personHash + ':' + root.versionIndex]))
  
  const rows = useMemo(() => flattenTree(root, expanded), [root, expanded])
  
  const toggle = useCallback((node: GraphNode) => {
    const key = node.personHash + ':' + node.versionIndex
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(key)) {
        n.delete(key)
      } else {
        n.add(key)
      }
      return n
    })
  }, [])
  
  const getKey = (n: GraphNode) => n.personHash + ':' + n.versionIndex
  const { openNode, selected } = useNodeDetail()
  const selectedKey = selected ? `${selected.personHash}:${selected.versionIndex}` : null
  const Row = useCallback(({ index, style }: ListChildComponentProps) => {
    const { node, depth, isLast } = rows[index]
    const hasChildren = !!(node.children && node.children.length)
    const k = getKey(node)
    const isOpen = expanded.has(k)
    const cacheKey = makeNodeId(node.personHash, node.versionIndex)
    const name = nodesData?.[cacheKey]?.fullName
    const endorse = nodesData?.[cacheKey]?.endorsementCount
    const mintedFlag = isMinted(nodesData?.[cacheKey])
    const gender = nodesData?.[cacheKey]?.gender as number | undefined
    const isSel = selectedKey === k
    const ancestorGuides: boolean[] = []
    if (depth > 0) {
      let currentDepth = depth - 1
      for (let i = index - 1; i >= 0 && currentDepth >= 0; i--) {
        const r = rows[i]
        if (r.depth === currentDepth) { ancestorGuides[currentDepth] = !r.isLast; currentDepth-- }
      }
    }
    return (
      <div style={{ ...style }} className={`group font-mono text-[12px] flex items-stretch relative ${isSel ? 'bg-amber-100 dark:bg-amber-900/40' : ''} hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors cursor-pointer`}
           onClick={() => openNode({ personHash: node.personHash, versionIndex: node.versionIndex})}>
        <div className="absolute inset-y-0 left-0 flex pointer-events-none">
          {ancestorGuides.map((show, i) => show ? (
            <div key={i} style={{ width: 16 }} className="flex-shrink-0 relative">
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />
            </div>
          ) : (<div key={i} style={{ width:16 }} />))}
        </div>
        <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-1 pl-1 pr-2 min-w-[140px] relative" title={node.personHash}>
          <div className="flex items-center">
            {depth>0 && (
              <div className="relative" style={{ width:16, height: rowHeight }}>
                <div className="absolute left-1/2 -translate-x-1/2 top-0 w-px h-1/2 bg-slate-300 dark:bg-slate-600" />
                {!isLast && <div className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0 w-px bg-slate-300 dark:bg-slate-600" />}
                <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 h-px w-1/2 bg-slate-300 dark:bg-slate-600" />
              </div>
            )}
            <button
              onClick={(e)=>{ e.stopPropagation(); hasChildren && toggle(node) }}
              className={`mr-1 ${hasChildren ? 'w-5 h-5 text-[10px]' : 'w-5 h-5 text-lg leading-none'} grid place-items-center rounded border ${hasChildren ? 'bg-white dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700 border-slate-300 dark:border-gray-600 text-slate-700 dark:text-slate-300' : 'border-transparent text-slate-400 dark:text-slate-500 cursor-default'}`}
            >
              {hasChildren ? (isOpen ? '−' : '+') : '•'}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 'max-content' }}>
            <span className="text-slate-600 dark:text-slate-300">{shortHash(node.personHash)}</span>
            <span className="text-sky-600 dark:text-sky-400">
              {nodesData?.[cacheKey]?.totalVersions && nodesData[cacheKey].totalVersions > 1 
                ? `T${nodesData[cacheKey].totalVersions}:v${node.versionIndex}` 
                : `v${node.versionIndex}`}
            </span>
            {endorse !== undefined && (
              <span className="inline-flex items-center gap-1" title="Endorsements">
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" className="flex-shrink-0">
                  <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9L10 15l-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L10 1.5z" className={mintedFlag ? 'fill-emerald-500' : 'fill-slate-500'} />
                </svg>
                <span className={`font-mono text-[12px] ${mintedFlag ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}`}>{endorse}</span>
              </span>
            )}
            {mintedFlag && (
              <>
                <span className="text-[10px] px-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/40">NFT</span>
                <span className={`ml-1 inline-block w-2 h-2 rounded-full ${getGenderColor(gender, 'BG')} ring-1 ring-white dark:ring-slate-900`} />
              </>
            )}
            {name && <span className="text-slate-700 dark:text-slate-200 text-[12px] truncate max-w-[180px]" title={name}>{name}</span>}
            {node.tag && <span className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/40 px-1 rounded" title={node.tag}>{node.tag}</span>}
          </div>
        </div>
      </div>
    )
  }, [rows, expanded, rowHeight, toggle, openNode, selectedKey, nodesData])
  return (
    <div className="w-full transition-all duration-300 overflow-hidden" style={{ height: familyTreeHeight }}>
      <div className="p-4 pt-16 h-full overflow-x-auto">
        <VirtualList height={familyTreeHeight - 32} itemCount={rows.length} itemSize={rowHeight} width={'auto'}>{Row}</VirtualList>
      </div>
    </div>
  )
}

export function ContractTree({ root }: { root: GraphNode }) {
  return <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}><Node node={root} /></ul>
}
