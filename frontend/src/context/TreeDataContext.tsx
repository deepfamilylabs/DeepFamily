import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useConfig } from './ConfigContext'
import { useTranslation } from 'react-i18next'
import { makeNodeId, parseNodeId, type NodeId } from '../types/graph'
import DeepFamily from '../abi/DeepFamily.json'
import { ethers } from 'ethers'
import { makeProvider } from '../utils/provider'
import { getRuntimeFamilyTreeConfig } from '../config/familyTreeConfig'
import { useErrorMonitor } from '../hooks/useErrorMonitor'
import { useVizOptions } from './VizOptionsContext'
import { NodeData } from '../types/graph'
import { computeStoryHash } from '../lib/story'
import type { EdgeStoreStrict, EdgeStoreUnion, EdgeStrictEntry, EdgeUnionEntry } from '../types/treeStore'
import { unionParentKey } from '../types/treeStore'
import { deleteBlob, isIndexedDBSupported, readBlob, writeBlob } from '../utils/idbCache'
import { createDeepFamilyApi, parseVersionDetailsResult } from '../utils/deepFamilyApi'
import { QueryCache } from '../utils/queryCache'
import { getInvalidateKeysAfterPersonVersionAdded } from '../utils/treeInvalidation'
import { nftKey, parseVdKey, vdKey } from '../utils/queryKeys'

// Reuse provider instances to avoid repeated network detection / socket exhaustion
const providerCache = new Map<string, ethers.JsonRpcProvider>()
const env: any = (import.meta as any).env || {}
const EDGE_TTL_MS = Number(env.VITE_DF_EDGE_TTL_MS || 120_000)
const TOTAL_VERSIONS_TTL_MS = Number(env.VITE_DF_TV_TTL_MS || 60_000)
const VERSION_DETAILS_TTL_MS = Number(env.VITE_DF_VD_TTL_MS || 300_000)
const NFT_DETAILS_TTL_MS = Number(env.VITE_DF_NFT_TTL_MS || 86_400_000)
const STORY_TTL_MS = Number(env.VITE_DF_STORY_TTL_MS || 300_000)
const USE_INDEXEDDB_CACHE = env.VITE_USE_INDEXEDDB_CACHE !== '0' && env.VITE_USE_INDEXEDDB_CACHE !== 'false'
const QUERY_PAGE_LIMIT = Number(env.VITE_DF_QUERY_PAGE_LIMIT || 200)
const CHILDREN_PAGE_LIMIT = QUERY_PAGE_LIMIT
const STORY_PAGE_LIMIT = QUERY_PAGE_LIMIT
const isStale = (fetchedAt?: number, ttlMs?: number) => {
  if (!Number.isFinite(fetchedAt)) return true
  const ttl = Number(ttlMs ?? 0)
  if (ttl <= 0) return false
  return Date.now() - Number(fetchedAt) > ttl
}

export interface TreeProgress { created: number; visited: number; depth: number }
export interface TreeDebugStats {
  inflightCount: number
  edgeCacheHits: { strict: number; union: number }
  edgeCacheMisses: { strict: number; union: number }
  lastEdgeFetchAt: { strict?: number; union?: number }
  totalVersionsCacheHits: number
  totalVersionsCacheMisses: number
  lastTotalVersionsFetchAt?: number
}
interface TreeDataValue {
  rootId: NodeId | null
  rootExists: boolean
  reachableNodeIds: NodeId[]
  loading: boolean
  progress?: TreeProgress
  contractMessage: string
  refresh: () => void
  invalidateTreeRootCache: () => void
  errors: ReturnType<typeof useErrorMonitor>['errors']
  endorsementsReady: boolean
  nodesData: Record<string, NodeData>
  edgesUnion: EdgeStoreUnion
  edgesStrict: EdgeStoreStrict
  setNodesData?: React.Dispatch<React.SetStateAction<Record<string, NodeData>>>
  getStoryData: (tokenId: string, opts?: { nodeIdHint?: string }) => Promise<any>
  preloadStoryData: (tokenId: string) => void
  getNodeByTokenId: (tokenId: string) => Promise<NodeData | null>
  getOwnerOf: (tokenId: string) => Promise<string | null>
  getDebugStats: () => TreeDebugStats
  clearAllCaches: () => void
  bumpEndorsementCount: (personHash: string, versionIndex: number, delta?: number) => void
  invalidateByTx: (input?: {
    receipt?: any
    events?: {
      PersonVersionAdded?: {
        personHash: string
        versionIndex: number
        fatherHash?: string
        fatherVersionIndex?: number
        motherHash?: string
        motherVersionIndex?: number
      } | null
      PersonVersionEndorsed?: {
        personHash: string
        versionIndex: number
      } | null
      PersonNFTMinted?: {
        tokenId?: string | number
        versionIndex?: number
        personHash?: string
      } | null
    }
    hints?: {
      personHash?: string
      versionIndex?: number
      tokenId?: string | number
    }
  } | null) => void
}

const TreeDataContext = createContext<TreeDataValue | null>(null)

export function TreeDataProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { rpcUrl, contractAddress, rootHash, rootVersionIndex, chainId } = useConfig()
  const { traversal, childrenMode, strictIncludeUnversionedChildren } = useVizOptions()
  // Bootstrap empty; IndexedDB hydration happens asynchronously.
  const initialNodesDataRef = useRef<Record<string, NodeData>>({})
  const [idbHydrated, setIdbHydrated] = useState(() => !USE_INDEXEDDB_CACHE || !isIndexedDBSupported())
  const [nodesData, setNodesData] = useState<Record<string, NodeData>>(() => initialNodesDataRef.current)
  const nodesDataRef = useRef(nodesData)
  useEffect(() => { nodesDataRef.current = nodesData }, [nodesData])
  // nodesDataRef keeps latest snapshot for async updates
  const [edgesUnion, setEdgesUnion] = useState<EdgeStoreUnion>({})
  const edgesUnionRef = useRef(edgesUnion)
  useEffect(() => { edgesUnionRef.current = edgesUnion }, [edgesUnion])
  const [edgesStrict, setEdgesStrict] = useState<EdgeStoreStrict>({})
  const edgesStrictRef = useRef(edgesStrict)
  useEffect(() => { edgesStrictRef.current = edgesStrict }, [edgesStrict])
  const [reachableNodeIds, setReachableNodeIds] = useState<NodeId[]>([])
  const reachableNodeIdsRef = useRef(reachableNodeIds)
  useEffect(() => { reachableNodeIdsRef.current = reachableNodeIds }, [reachableNodeIds])
  const [loading, setLoading] = useState(false)
  const [rootExists, setRootExists] = useState(false)
  const [progress, setProgress] = useState<TreeProgress | undefined>(undefined)
  const [contractMessage, setContractMessage] = useState('')
  const [refreshTick, setRefreshTick] = useState(1)
  const refresh = useCallback(() => setRefreshTick(t => t + 1), [])
  // Remove auto-refresh from context; pages should call refresh() explicitly when needed
  const { errors, push } = useErrorMonitor()
  const stageLoggedRef = useRef<Set<string>>(new Set())
  const debugStatsRef = useRef<TreeDebugStats>({
    inflightCount: 0,
    edgeCacheHits: { strict: 0, union: 0 },
    edgeCacheMisses: { strict: 0, union: 0 },
    lastEdgeFetchAt: {},
    totalVersionsCacheHits: 0,
    totalVersionsCacheMisses: 0
  })
  const getDebugStats = useCallback(() => ({
    ...debugStatsRef.current,
    inflightCount: queryCacheRef.current.inflightCount()
  }), [])
  const optionsRef = useRef({ traversal })
  useEffect(() => {
    const o = optionsRef.current
    if (o.traversal !== traversal) {
      optionsRef.current = { traversal }
      refresh()
    }
  }, [traversal, refresh])

  // Provider + contract (memoized & cached)
  const provider = useMemo(() => {
    if (!rpcUrl) return null
    const key = `${rpcUrl}::${chainId || 'auto'}`
    if (providerCache.has(key)) return providerCache.get(key) as ethers.JsonRpcProvider
    try {
      const p = makeProvider(rpcUrl, chainId)
      providerCache.set(key, p)
      return p
    } catch { return null }
  }, [rpcUrl, chainId])

  const contract = useMemo(() => {
    if (!provider || !contractAddress) return null
    try { return new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider) } catch { return null }
  }, [provider, contractAddress])

  const fetchRunKeyRef = useRef<string | null>(null)
  const queryCacheRef = useRef(new QueryCache())
  const edgeRevalidateRef = useRef(new Set<string>())
  const storyRevalidateRef = useRef(new Set<string>())
  const eventInterfaceRef = useRef(new ethers.Interface((DeepFamily as any).abi))
  const api = useMemo(() => (contract ? createDeepFamilyApi(contract, queryCacheRef.current) : null), [contract])

  const CACHE_SCHEMA_VERSION = 1
  // Persistent storage namespace scoped by chain + RPC + contract
  const storageNS = useMemo(() => {
    const rpc = rpcUrl || 'no-rpc'
    const addr = contractAddress || 'no-contract'
    const chain = chainId ? String(chainId) : 'no-chain'
    return `df.cache.v${CACHE_SCHEMA_VERSION}::${chain}::${rpc}::${addr}`
  }, [rpcUrl, contractAddress, chainId])

  // Edge persistence (scoped by RPC + contract)
  const edgesUnionKey = useMemo(() => `${storageNS}::edges.union.v1`, [storageNS])
  const edgesStrictKey = useMemo(() => `${storageNS}::edges.strict.v1`, [storageNS])

  // Clear in-memory caches when RPC/contract changes (IDB hydrates asynchronously).
  useEffect(() => {
    setNodesData({})
    setEdgesUnion({})
    setEdgesStrict({})
    queryCacheRef.current.clear()
  }, [storageNS])

  // Async load persisted caches from IndexedDB (non-blocking, merges missing entries)
  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) {
      setIdbHydrated(true)
      return
    }
    setIdbHydrated(false)
    let cancelled = false
    ;(async () => {
      try {
        const [idbNodes, idbEdgesUnion, idbEdgesStrict] = await Promise.all([
          readBlob<Record<string, NodeData>>(`${storageNS}::nodesData`).catch(() => null),
          readBlob<EdgeStoreUnion>(edgesUnionKey).catch(() => null),
          readBlob<EdgeStoreStrict>(edgesStrictKey).catch(() => null)
        ])
        if (cancelled) return
        if (idbNodes && Object.keys(idbNodes).length) {
          setNodesData(prev => {
            let changed = false
            const next = { ...prev }
            for (const [k, v] of Object.entries(idbNodes)) {
              if (!next[k]) { next[k] = v; changed = true }
            }
            return changed ? next : prev
          })
        }
        if (idbEdgesUnion && Object.keys(idbEdgesUnion).length) {
          setEdgesUnion(prev => ({ ...idbEdgesUnion, ...prev }))
        }
        if (idbEdgesStrict && Object.keys(idbEdgesStrict).length) {
          setEdgesStrict(prev => ({ ...idbEdgesStrict, ...prev }))
        }
      } catch {
        // Ignore IDB errors; keep in-memory state only.
      } finally {
        if (!cancelled) setIdbHydrated(true)
      }
    })()
    return () => { cancelled = true }
  }, [edgesStrictKey, edgesUnionKey, storageNS])

  // Persist caches to IndexedDB (debounced to avoid frequent writes)
  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return
    const handle = setTimeout(() => {
      writeBlob(`${storageNS}::nodesData`, nodesData).catch(() => {})
    }, 200)
    return () => clearTimeout(handle)
  }, [nodesData, storageNS])

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return
    const handle = setTimeout(() => {
      writeBlob(edgesUnionKey, edgesUnion).catch(() => {})
    }, 200)
    return () => clearTimeout(handle)
  }, [edgesUnion, edgesUnionKey])

  useEffect(() => {
    if (!USE_INDEXEDDB_CACHE || !isIndexedDBSupported()) return
    const handle = setTimeout(() => {
      writeBlob(edgesStrictKey, edgesStrict).catch(() => {})
    }, 200)
    return () => clearTimeout(handle)
  }, [edgesStrict, edgesStrictKey])

  const rootId = useMemo<NodeId | null>(() => {
    const isValidHash = typeof rootHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(rootHash)
    const v = Number(rootVersionIndex)
    const isValidVersion = Number.isFinite(v) && v >= 1
    if (!isValidHash || !isValidVersion) return null
    return makeNodeId(rootHash, v)
  }, [rootHash, rootVersionIndex])
  useEffect(() => {
    setRootExists(false)
  }, [rootId])

  // Build-session load: populate EdgeStore + reachableNodeIds (no tree streaming).
  useEffect(() => {
    if (refreshTick === 0) return
    if (!rootId) {
      setReachableNodeIds([])
      setRootExists(false)
      setProgress(undefined)
      if (typeof rootHash === 'string' && rootHash) setContractMessage(t('familyTree.status.rootNotFound'))
      return
    }
    // Don't "cache emptiness" while provider/contract is still bootstrapping.
    // Wait until the contract is available.
    if (!contract) return
    if (!idbHydrated) return
    const trv = optionsRef.current.traversal
    const runKey = `build-${rootId}-${childrenMode}-${strictIncludeUnversionedChildren ? 'v0' : 'no0'}-${trv}-${refreshTick}`
    if (fetchRunKeyRef.current === runKey) return
    fetchRunKeyRef.current = runKey
    let cancelled = false
    const controller = new AbortController()
    const checkAbort = () => { if (cancelled || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError') }
    debugStatsRef.current.edgeCacheHits = { strict: 0, union: 0 }
    debugStatsRef.current.edgeCacheMisses = { strict: 0, union: 0 }
    debugStatsRef.current.lastEdgeFetchAt = {}
    debugStatsRef.current.totalVersionsCacheHits = 0
    debugStatsRef.current.totalVersionsCacheMisses = 0
    debugStatsRef.current.lastTotalVersionsFetchAt = undefined

    const ensureTotalVersions = (personHash: string, totalVersions: number) => {
      if (!personHash || !Number.isFinite(totalVersions) || totalVersions <= 0) return
      const key = personHash.toLowerCase()
      setNodesData(prev => {
        const next = { ...prev }
        let changed = false
        for (const [id, nd] of Object.entries(next)) {
          if (nd.personHash.toLowerCase() === key && nd.totalVersions !== totalVersions) {
            next[id] = { ...nd, totalVersions }
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

		    const loadChildrenStrict = async (nodeId: NodeId, forceRefresh?: boolean): Promise<EdgeStrictEntry> => {
		      const cached = edgesStrictRef.current[nodeId]
		      if (!forceRefresh && cached && !isStale(cached.fetchedAt, EDGE_TTL_MS)) {
            return cached
          }
		      if (!api) throw new Error('Contract not ready')

          const { personHash, versionIndex } = parseNodeId(nodeId)
          const childIds = await api.listChildrenStrictAll(personHash, Number(versionIndex), {
            pageLimit: CHILDREN_PAGE_LIMIT,
            checkAbort
          })
          debugStatsRef.current.lastEdgeFetchAt.strict = Date.now()
          return { childIds, fetchedAt: Date.now(), totalCount: childIds.length }
    }

		    const loadChildrenUnion = async (personHash: string, forceRefresh?: boolean): Promise<EdgeUnionEntry> => {
		      const pKey = unionParentKey(personHash)
		      const cached = edgesUnionRef.current[pKey]
		      if (!forceRefresh && cached && !isStale(cached.fetchedAt, EDGE_TTL_MS)) {
            return cached
          }
		      if (!api) throw new Error('Contract not ready')

          checkAbort()
          const { childIds, totalVersions } = await api.listChildrenUnionAll(personHash, {
            pageLimit: CHILDREN_PAGE_LIMIT,
            checkAbort,
            totalVersionsOptions: {
              ttlMs: TOTAL_VERSIONS_TTL_MS,
              onCacheHit: () => { debugStatsRef.current.totalVersionsCacheHits += 1 },
              onCacheMiss: () => { debugStatsRef.current.totalVersionsCacheMisses += 1 },
              onFetched: () => { debugStatsRef.current.lastTotalVersionsFetchAt = Date.now() }
            },
            onTotalVersions: (tv) => {
              if (tv > 0) ensureTotalVersions(personHash, tv)
            }
          })
          debugStatsRef.current.lastEdgeFetchAt.union = Date.now()
          return { childIds, fetchedAt: Date.now(), totalVersions }
    }

        const scheduleRevalidate = (key: string, run: () => Promise<void>) => {
          if (edgeRevalidateRef.current.has(key)) return
          edgeRevalidateRef.current.add(key)
          run()
            .catch(() => {})
            .finally(() => { edgeRevalidateRef.current.delete(key) })
        }

        const ensureReachableChildren = (parentId: NodeId | null, parentHash: string | null, childIds: NodeId[]) => {
          if (!childIds.length) return
          const reachableIds = reachableNodeIdsRef.current
          if (!reachableIds.length) return
          let parentReachable = false
          if (parentId) {
            parentReachable = reachableIds.includes(parentId)
          } else if (parentHash) {
            const key = parentHash.toLowerCase()
            for (const rid of reachableIds) {
              if (parseNodeId(rid).personHash.toLowerCase() === key) { parentReachable = true; break }
            }
          }
          if (!parentReachable) return

          setNodesData(prev => {
            let changed = false
            const next = { ...prev }
            for (const cid of childIds) {
              if (next[cid]) continue
              const parsed = parseNodeId(cid)
              next[cid] = { personHash: parsed.personHash, versionIndex: Number(parsed.versionIndex), id: cid }
              changed = true
            }
            return changed ? next : prev
          })

          setReachableNodeIds(prev => {
            const next = new Set(prev)
            let changed = false
            for (const cid of childIds) {
              if (next.has(cid)) continue
              next.add(cid)
              changed = true
            }
            return changed ? Array.from(next) : prev
          })
        }

        const revalidateStrict = (nodeId: NodeId) => {
          scheduleRevalidate(`strict:${nodeId}`, async () => {
            const entry = await loadChildrenStrict(nodeId, true)
            setEdgesStrict(prev => ({ ...prev, [nodeId]: entry }))
            ensureReachableChildren(nodeId, null, entry.childIds)
          })
        }

        const revalidateUnion = (personHash: string) => {
          const pKey = unionParentKey(personHash)
          scheduleRevalidate(`union:${pKey}`, async () => {
            const entry = await loadChildrenUnion(personHash, true)
            setEdgesUnion(prev => ({ ...prev, [pKey]: entry }))
            ensureReachableChildren(null, personHash, entry.childIds)
          })
        }

    ;(async () => {
      setLoading(true)
      setContractMessage('')
      setProgress(undefined)

	      try {
	        await (provider as any)?.send?.('eth_chainId', [])
	      } catch (e: any) {
	        if (!cancelled) {
	          const raw = String(
	            e?.message || e?.shortMessage ||
	            (e?.cause && (e.cause.message || e.cause.shortMessage)) || ''
	          )
	          const code = (e?.code ?? (e?.error && e.error.code) ?? (e?.info && e.info.error && e.info.error.code) ?? (e?.cause && e.cause.code)) as any
	          const isRateLimit = (code === -32005) || /Too\s*many\s*requests|daily\s*request\s*count\s*exceeded|rate[-\s]?limit|status\s*429/i.test(raw)
	          const isConnRefused = /ECONNREFUSED|ERR_CONNECTION_REFUSED|connection\s*refused/i.test(raw)
	          const isAbort = /AbortError|The user aborted a request/i.test(raw)
	          const isFetchFail = /Failed\s*to\s*fetch|NetworkError\s*when\s*attempting\s*to\s*fetch/i.test(raw)
	          const isNetwork = isConnRefused || isAbort || isFetchFail || /network|timeout|ECONN|ENET|EAI_AGAIN/i.test(raw) || String(code).includes('NETWORK')
	          if (isRateLimit) setContractMessage(t('familyTree.status.rateLimited'))
	          else if (isNetwork) setContractMessage(t('familyTree.status.networkError'))
	          else setContractMessage(t('familyTree.status.contractModeRootNotFound'))
	        }
	        setLoading(false)
	        return
	      }

      try {
        if (!api) throw new Error('Contract not ready')
        await api.getVersionDetails(rootHash, Number(rootVersionIndex), { ttlMs: VERSION_DETAILS_TTL_MS })
        setRootExists(true)
      } catch (e: any) {
	        if (!cancelled) {
	          const msg = String(
	            e?.message || e?.shortMessage ||
	            (e?.cause && (e.cause.message || e.cause.shortMessage)) ||
	            ''
	          )
	          const name = String((e as any)?.errorName || '')
	          const code = (e?.code ?? (e?.error && e.error.code) ?? (e?.info && e.info.error && e.info.error.code) ?? (e?.cause && e.cause.code)) as any
	          const isRateLimit = (code === -32005) || /Too\s*many\s*requests|daily\s*request\s*count\s*exceeded|rate[-\s]?limit|status\s*429/i.test(msg)
	          const isConnRefused = /ECONNREFUSED|ERR_CONNECTION_REFUSED|connection\s*refused/i.test(msg)
	          const isAbort = /AbortError|The user aborted a request/i.test(msg)
	          const isFetchFail = /Failed\s*to\s*fetch|NetworkError\s*when\s*attempting\s*to\s*fetch/i.test(msg)
	          const isNetwork = isConnRefused || isAbort || isFetchFail || /network|timeout|ECONN|ENET|EAI_AGAIN/i.test(msg) || String(code).includes('NETWORK')
	          const isRootInvalid = name.includes('InvalidPersonHash') || name.includes('InvalidVersionIndex') || /InvalidPersonHash|InvalidVersionIndex/i.test(msg)
	          if (isRateLimit) setContractMessage(t('familyTree.status.rateLimited'))
	          else if (isRootInvalid) setContractMessage(t('familyTree.status.rootNotFound'))
	          else if (isNetwork) setContractMessage(t('familyTree.status.networkError'))
	          else setContractMessage(t('familyTree.status.contractModeRootNotFound'))
	          if (isRootInvalid) setRootExists(false)
	          if (!stageLoggedRef.current.has('root_check')) { stageLoggedRef.current.add('root_check'); push(e as any, { stage: 'root_check' }) }
	        }
	        setLoading(false)
	        return
	      }

      const runtimeCfg = getRuntimeFamilyTreeConfig()
      const hardNodeLimit = runtimeCfg.DEFAULT_HARD_NODE_LIMIT

      const visited = new Set<NodeId>()
      const frontier: Array<{ id: NodeId; depth: number }> = [{ id: rootId, depth: 1 }]
      let maxDepthSeen = 1
      let lastEmit = performance.now()
      let lastCommit = performance.now()

      const nodeUpserts: Record<string, NodeData> = {}
      const unionUpserts: EdgeStoreUnion = {}
      const strictUpserts: EdgeStoreStrict = {}

      const commit = () => {
        const nodeSnapshot = Object.keys(nodeUpserts).length ? { ...nodeUpserts } : null
        const unionSnapshot = Object.keys(unionUpserts).length ? { ...unionUpserts } : null
        const strictSnapshot = Object.keys(strictUpserts).length ? { ...strictUpserts } : null

        if (nodeSnapshot) {
          setNodesData(prev => {
            const next = { ...prev }
            for (const [id, nd] of Object.entries(nodeSnapshot)) {
              next[id] = next[id] ? { ...nd, ...next[id], id } : nd
            }
            return next
          })
          for (const k of Object.keys(nodeUpserts)) delete nodeUpserts[k]
        }
        if (unionSnapshot) {
          setEdgesUnion(prev => ({ ...prev, ...unionSnapshot }))
          for (const k of Object.keys(unionUpserts)) delete (unionUpserts as any)[k]
        }
        if (strictSnapshot) {
          setEdgesStrict(prev => ({ ...prev, ...strictSnapshot }))
          for (const k of Object.keys(strictUpserts)) delete (strictUpserts as any)[k]
        }
      }

      while (frontier.length && !cancelled && visited.size < hardNodeLimit) {
        checkAbort()
        const next = (trv === 'bfs') ? frontier.shift() : frontier.pop()
        if (!next) break
        const { id, depth } = next
        if (visited.has(id)) continue
        visited.add(id)
        maxDepthSeen = Math.max(maxDepthSeen, depth)

        if (!nodesDataRef.current[id] && !nodeUpserts[id]) {
          const parsed = parseNodeId(id)
          nodeUpserts[id] = { personHash: parsed.personHash, versionIndex: Number(parsed.versionIndex), id }
        }

        let childIds: NodeId[] = []
        if (childrenMode === 'strict') {
          const cached = edgesStrictRef.current[id]
          let entry: EdgeStrictEntry
          if (cached) {
            debugStatsRef.current.edgeCacheHits.strict += 1
            if (isStale(cached.fetchedAt, EDGE_TTL_MS)) revalidateStrict(id)
            entry = cached
          } else {
            debugStatsRef.current.edgeCacheMisses.strict += 1
            entry = await loadChildrenStrict(id, true)
            strictUpserts[id] = entry
          }
          childIds = entry.childIds

          if (strictIncludeUnversionedChildren) {
            const { personHash } = parseNodeId(id)
            const zeroKey = makeNodeId(personHash, 0)
            const cachedZero = edgesStrictRef.current[zeroKey]
            let zeroEntry: EdgeStrictEntry
            if (cachedZero) {
              debugStatsRef.current.edgeCacheHits.strict += 1
              if (isStale(cachedZero.fetchedAt, EDGE_TTL_MS)) revalidateStrict(zeroKey)
              zeroEntry = cachedZero
            } else {
              debugStatsRef.current.edgeCacheMisses.strict += 1
              zeroEntry = await loadChildrenStrict(zeroKey, true)
              strictUpserts[zeroKey] = zeroEntry
            }
            if (zeroEntry.childIds.length) {
              const merged = new Set(childIds)
              for (const cid of zeroEntry.childIds) merged.add(cid)
              childIds = Array.from(merged)
              childIds.sort((a, b) => a.localeCompare(b))
            }
          }
        } else {
          const { personHash } = parseNodeId(id)
          const pKey = unionParentKey(personHash)
          const cached = edgesUnionRef.current[pKey]
          let entry: EdgeUnionEntry
          if (cached) {
            debugStatsRef.current.edgeCacheHits.union += 1
            if (isStale(cached.fetchedAt, EDGE_TTL_MS)) revalidateUnion(personHash)
            entry = cached
          } else {
            debugStatsRef.current.edgeCacheMisses.union += 1
            entry = await loadChildrenUnion(personHash, true)
            unionUpserts[pKey] = entry
          }
          childIds = entry.childIds
        }

        for (const cid of childIds) {
          if (!nodesDataRef.current[cid] && !nodeUpserts[cid]) {
            const parsed = parseNodeId(cid)
            nodeUpserts[cid] = { personHash: parsed.personHash, versionIndex: Number(parsed.versionIndex), id: cid }
          }
          frontier.push({ id: cid, depth: depth + 1 })
        }

        const now = performance.now()
        if (now - lastEmit > 60 || visited.size % 50 === 0) {
          setProgress({ created: visited.size, visited: visited.size, depth: maxDepthSeen })
          lastEmit = now
        }
        if (now - lastCommit > 60 || visited.size % 50 === 0) {
          commit()
          lastCommit = now
        }
      }

      commit()
      if (!cancelled) {
        setReachableNodeIds(Array.from(visited))
        setProgress({ created: visited.size, visited: visited.size, depth: maxDepthSeen })
        setContractMessage('')
      }
      setLoading(false)
    })().catch((e: any) => {
      if (!cancelled && e?.name !== 'AbortError') {
        push(e, { stage: 'build_session' })
      }
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [childrenMode, contract, api, provider, push, refreshTick, rootHash, rootId, rootVersionIndex, t, strictIncludeUnversionedChildren, idbHydrated])

  const nodePairs = useMemo(() => {
    if (!reachableNodeIds.length) return [] as Array<{ h: string; v: number }>
    return reachableNodeIds.map(id => {
      const p = parseNodeId(id)
      return { h: p.personHash, v: Number(p.versionIndex) }
    })
  }, [reachableNodeIds])

  const [endorsementsReady, setEndorsementsReady] = useState(false)
  useEffect(() => {
    setEndorsementsReady(false)
  }, [rootId, childrenMode, nodePairs.length])

  // Endorsement counts
  useEffect(() => {
    if (loading || !contract || !api || nodePairs.length === 0) return
    let cancelled = false
    ;(async () => {
      const iface = new ethers.Interface((DeepFamily as any).abi)

      // Read persisted snapshot (IndexedDB) to assist with cache hits
      let snapshot: Record<string, NodeData> | null = null
      if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
        try {
          snapshot = await readBlob<Record<string, NodeData>>(`${storageNS}::nodesData`)
        } catch {
          snapshot = null
        }
      }

      const hasRequiredFields = (nd?: NodeData) => !!nd && nd.endorsementCount !== undefined && nd.tokenId !== undefined
      const isVersionDetailsFresh = (nd?: NodeData) => {
        if (!hasRequiredFields(nd)) return false
        return !isStale(nd?.versionDetailsFetchedAt, VERSION_DETAILS_TTL_MS)
      }

      // If all nodes already have fresh fields (endorsementCount and tokenId) in cache, skip network request
      try {
        const allSatisfied = nodePairs.every(p => {
          const id = makeNodeId(p.h, p.v)
          const nd = nodesDataRef.current[id] || (snapshot ? snapshot[id] : undefined)
          return isVersionDetailsFresh(nd)
        })
        if (allSatisfied) {
          if (!cancelled) setEndorsementsReady(true)
          // Backfill node details missing from memory but present in local snapshot, maintain nodesData as single source of truth
          if (snapshot) {
            setNodesData(prev => {
              let changed = false
              const next = { ...prev }
              for (const p of nodePairs) {
                const id = makeNodeId(p.h, p.v)
                const fromSnap = snapshot![id]
                const cur = next[id]
                if (!hasRequiredFields(cur) && hasRequiredFields(fromSnap)) {
                  next[id] = cur ? { ...cur, ...fromSnap, id: cur.id } : { ...fromSnap }
                  changed = true
                }
              }
              return changed ? next : prev
            })
          }
          return
        }
      } catch {}
      for (let i = 0; i < nodePairs.length && !cancelled; i += 40) {
        const slice = nodePairs.slice(i, i + 40)
        // Only make requests for nodes missing essential details, while backfilling available data from local snapshot
        const backfills: Record<string, NodeData> = {}
        const targets = slice.filter(p => {
          const id = makeNodeId(p.h, p.v)
          const fromMem = nodesDataRef.current[id]
          const fromSnap = snapshot ? snapshot[id] : undefined
          if (hasRequiredFields(fromMem) || hasRequiredFields(fromSnap)) {
            if (!hasRequiredFields(fromMem) && fromSnap) backfills[id] = fromSnap
          }
          return !isVersionDetailsFresh(fromMem) && !isVersionDetailsFresh(fromSnap)
        })
        if (Object.keys(backfills).length > 0) {
          setNodesData(prev => {
            let changed = false
            const next = { ...prev }
            for (const [id, nd] of Object.entries(backfills)) {
              const cur = next[id]
              if (!hasRequiredFields(cur)) {
                next[id] = cur ? { ...cur, ...nd, id: cur.id } : nd
                changed = true
              }
            }
            return changed ? next : prev
          })
        }
        if (targets.length === 0) continue
        try {
          const pendingNFTs: Array<{ id: string; tokenId: string }> = []
          const results = await Promise.all(targets.map(async (original) => {
            if (!api) return { ok: false as const, original }
            try {
              const parsed = await api.getVersionDetails(original.h, original.v, { ttlMs: VERSION_DETAILS_TTL_MS })
              return { ok: true as const, parsed, original }
            } catch {
              return { ok: false as const, original }
            }
          }))

          results.forEach((entry) => {
            if (cancelled || !entry.ok) return
            const { parsed, original } = entry as { ok: true; parsed: ReturnType<typeof parseVersionDetailsResult>; original: { h: string; v: number } }
            const id = makeNodeId(original.h, original.v)
            const versionDetailsKey = vdKey(original.h, original.v)
            const vdFetchedAt = queryCacheRef.current.getEntry(versionDetailsKey)?.fetchedAt ?? Date.now()
            const versionFields = parsed.version
            setNodesData(prev => {
              const tag = versionFields.tag ?? prev[id]?.tag
              return {
                ...prev,
                [id]: {
                  ...(prev[id] || { personHash: original.h, versionIndex: original.v, id }),
                  endorsementCount: parsed.endorsementCount,
                  tokenId: parsed.tokenId,
                  fatherHash: versionFields.fatherHash,
                  motherHash: versionFields.motherHash,
                  fatherVersionIndex: versionFields.fatherVersionIndex,
                  motherVersionIndex: versionFields.motherVersionIndex,
                  addedBy: versionFields.addedBy,
                  timestamp: versionFields.timestamp,
                  tag,
                  metadataCID: versionFields.metadataCID,
                  versionDetailsFetchedAt: vdFetchedAt
                }
              }
            })
            if (parsed.tokenId !== '0') pendingNFTs.push({ id, tokenId: parsed.tokenId })
          })
          for (const item of pendingNFTs) {
            if (cancelled) break
            const current = nodesDataRef.current[item.id]
            if (!current || current.fullName !== undefined) continue
            try {
              if (!api) throw new Error('Contract not ready')
              const nftRet = await api.getNFTDetails(item.tokenId, { ttlMs: NFT_DETAILS_TTL_MS })
              const versionFields = nftRet.version
              const coreFields = nftRet.core
              const endorsementCount2 = nftRet.endorsementCount
              const nftTokenURI = nftRet.nftTokenURI
              
              // Get story metadata
              let storyMetadata = undefined
              try {
                const metadata = await contract.getStoryMetadata(item.tokenId)
                storyMetadata = {
                  totalChunks: Number(metadata.totalChunks),
                  totalLength: Number(metadata.totalLength),
                  isSealed: Boolean(metadata.isSealed),
                  lastUpdateTime: Number(metadata.lastUpdateTime),
                  fullStoryHash: metadata.fullStoryHash
                }
              } catch (e) {
                // If fetch fails, set default values
                storyMetadata = {
                  totalChunks: 0,
                  totalLength: 0,
                  isSealed: false,
                  lastUpdateTime: 0,
                  fullStoryHash: ''
                }
              }
              
              setNodesData(prev => {
                const cur = prev[item.id]
                if (!cur || cur.fullName !== undefined) return prev
                return {
                  ...prev,
                  [item.id]: {
                    ...cur,
                    fatherHash: versionFields.fatherHash ?? cur.fatherHash,
                    motherHash: versionFields.motherHash ?? cur.motherHash,
                    fatherVersionIndex: versionFields.fatherVersionIndex ?? cur.fatherVersionIndex,
                    motherVersionIndex: versionFields.motherVersionIndex ?? cur.motherVersionIndex,
                    addedBy: versionFields.addedBy ?? cur.addedBy,
                    timestamp: versionFields.timestamp ?? cur.timestamp,
                    tag: (versionFields.tag || cur.tag),
                    metadataCID: versionFields.metadataCID ?? cur.metadataCID,
                    endorsementCount: endorsementCount2 ?? cur.endorsementCount,
                    tokenId: item.tokenId,
                    fullName: coreFields.fullName,
                    gender: coreFields.gender,
                    birthYear: coreFields.birthYear,
                    birthMonth: coreFields.birthMonth,
                    birthDay: coreFields.birthDay,
                    birthPlace: coreFields.birthPlace,
                    isBirthBC: coreFields.isBirthBC,
                    deathYear: coreFields.deathYear,
                    deathMonth: coreFields.deathMonth,
                    deathDay: coreFields.deathDay,
                    deathPlace: coreFields.deathPlace,
                    isDeathBC: coreFields.isDeathBC,
                    story: coreFields.story,
                    nftTokenURI,
                    storyMetadata,
                    versionDetailsFetchedAt: Date.now()
                  }
                }
              })
            } catch (e) {
              if (!stageLoggedRef.current.has('nft_details_batch')) { stageLoggedRef.current.add('nft_details_batch'); push(e as any, { stage: 'nft_details_batch' }) }
            }
          }
        } catch (e) {
          if (!stageLoggedRef.current.has('counts_batch')) { stageLoggedRef.current.add('counts_batch'); push(e as any, { stage: 'counts_batch' }) }
        }
      }
      if (!cancelled) setEndorsementsReady(true)
    })()
    return () => { cancelled = true }
  }, [loading, contract, api, nodePairs, contractAddress, provider, push])

  // Ensure totalVersions is available for the currently selected root version (for T{n}:v{idx} badge),
  // even when the root has no children (onVersionStats would never fire in that case).
  useEffect(() => {
    if (!contract || !rootId) return
    let cancelled = false
    ;(async () => {
      const h = rootHash
      const v = Number(rootVersionIndex)
      if (!h || !/^0x[0-9a-fA-F]{64}$/.test(h) || !Number.isFinite(v) || v <= 0) return
      try {
        const out: any = await (contract as any).listPersonVersions(h, 0, 0)
        const tv = out.totalVersions ?? out[1]
        const totalVersions = Number(tv ?? 0)
        if (!Number.isFinite(totalVersions) || totalVersions <= 1) return
        if (cancelled) return
        setNodesData(prev => {
          const key = h.toLowerCase()
          const next = { ...prev }
          let changed = false

          // Update any existing entries for this personHash.
          for (const [id, nd] of Object.entries(next)) {
            if (nd.personHash.toLowerCase() === key && nd.totalVersions !== totalVersions) {
              next[id] = { ...nd, totalVersions }
              changed = true
            }
          }

          // Ensure the currently selected version entry exists and has totalVersions.
          const curId = makeNodeId(h, v)
          const cur = next[curId]
          if (!cur) {
            next[curId] = { personHash: h, versionIndex: v, id: curId, totalVersions }
            changed = true
          } else if (cur.totalVersions !== totalVersions) {
            next[curId] = { ...cur, totalVersions }
            changed = true
          }

          return changed ? next : prev
        })
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [contract, rootHash, rootId, rootVersionIndex])

  // Fetch minimal NodeData by tokenId for cold-start deep links (moved above getStoryData to avoid TS hoisting issue)
  const getNodeByTokenId = useCallback(async (tokenId: string): Promise<NodeData | null> => {
    // 1) Prefer in-memory nodesData snapshot
    for (const nd of Object.values(nodesDataRef.current)) {
      if (nd.tokenId && String(nd.tokenId) === String(tokenId)) return nd
    }

    // 2) Try persisted nodesData (cold start hydration race)
    if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
      try {
        const obj = await readBlob<Record<string, NodeData>>(`${storageNS}::nodesData`)
        if (obj) {
          for (const [id, nd] of Object.entries(obj)) {
            if (nd.tokenId && String(nd.tokenId) === String(tokenId)) {
              // Backfill into state for future hits
              setNodesData(prev => prev[id] ? prev : ({ ...prev, [id]: nd }))
              return nd
            }
          }
        }
      } catch {}
    }

    if (!api) return null
    try {
      const nftRet = await api.getNFTDetails(tokenId, { ttlMs: NFT_DETAILS_TTL_MS })
      const { personHash, versionIndex, version: versionFields, core: coreFields } = nftRet
      const endorsementCount = nftRet.endorsementCount
      const nftTokenURI = nftRet.nftTokenURI
      const id = makeNodeId(personHash, Number(versionIndex))
      const node: NodeData = {
        personHash,
        versionIndex: Number(versionIndex),
        id,
        tokenId: String(tokenId),
        fatherHash: versionFields.fatherHash,
        motherHash: versionFields.motherHash,
        fatherVersionIndex: versionFields.fatherVersionIndex,
        motherVersionIndex: versionFields.motherVersionIndex,
        addedBy: versionFields.addedBy,
        timestamp: versionFields.timestamp,
        tag: versionFields.tag,
        metadataCID: versionFields.metadataCID,
        owner: undefined,
        fullName: coreFields.fullName,
        gender: coreFields.gender,
        birthYear: coreFields.birthYear,
        birthMonth: coreFields.birthMonth,
        birthDay: coreFields.birthDay,
        birthPlace: coreFields.birthPlace,
        isBirthBC: coreFields.isBirthBC,
        deathYear: coreFields.deathYear,
        deathMonth: coreFields.deathMonth,
        deathDay: coreFields.deathDay,
        deathPlace: coreFields.deathPlace,
        isDeathBC: coreFields.isDeathBC,
        story: coreFields.story,
        endorsementCount,
        nftTokenURI,
      }

      setNodesData(prev => ({ ...prev, [id]: { ...(prev[id] || node), ...node } }))
      return node
    } catch (e) {
      return null
    }
  }, [api, storageNS])

  // Function to get story data (cache solely via NodesData)
  const getStoryData = useCallback(async (tokenId: string, opts?: { nodeIdHint?: string }) => {
    const scheduleStoryRevalidate = (key: string, run: () => Promise<void>) => {
      if (storyRevalidateRef.current.has(key)) return
      storyRevalidateRef.current.add(key)
      run()
        .catch(() => {})
        .finally(() => { storyRevalidateRef.current.delete(key) })
    }

    const fetchAndStoreStory = async (effectiveTokenId: string, nodeIdToUpdate?: string) => {
      if (!provider || !contractAddress || !contract) throw new Error('Provider or contract address not available')

      const parseStoryChunk = (chunk: any) => ({
        chunkIndex: Number(chunk?.chunkIndex ?? chunk?.[0] ?? 0),
        chunkHash: String(chunk?.chunkHash ?? chunk?.[1] ?? ethers.ZeroHash),
        content: String(chunk?.content ?? chunk?.[2] ?? ''),
        timestamp: Number(chunk?.timestamp ?? chunk?.[3] ?? 0),
        editor: String(chunk?.editor ?? chunk?.[4] ?? ethers.ZeroAddress),
        chunkType: Number(chunk?.chunkType ?? chunk?.[5] ?? 0),
        attachmentCID: String(chunk?.attachmentCID ?? chunk?.[6] ?? '')
      })

      const existingNode = nodeIdToUpdate ? nodesDataRef.current[nodeIdToUpdate] : undefined
      const existingChunks = Array.isArray(existingNode?.storyChunks) ? existingNode!.storyChunks : []
      const existingMap = new Map<number, any>()
      for (const c of existingChunks) {
        const idx = Number((c as any)?.chunkIndex)
        if (!Number.isFinite(idx) || idx < 0) continue
        if (!existingMap.has(idx)) existingMap.set(idx, c)
      }

      const metadata = await contract!.getStoryMetadata(effectiveTokenId)
      const storyMetadata = {
        totalChunks: Number(metadata.totalChunks),
        totalLength: Number(metadata.totalLength),
        isSealed: Boolean(metadata.isSealed),
        lastUpdateTime: Number(metadata.lastUpdateTime),
        fullStoryHash: metadata.fullStoryHash
      }

      const total = Number(storyMetadata.totalChunks || 0)
      if (total > 0) {
        // Prefer `listStoryChunks` to fetch missing chunks in pages (single RPC per page).
        // Because story chunks are append-only, most misses are a suffix; we start at the first gap.
        let offset = 0
        while (existingMap.has(offset)) offset += 1
        if (offset < total) {
          let hasMore = true
          while (hasMore && offset < total) {
            const out: any = await contract!.listStoryChunks(effectiveTokenId, offset, STORY_PAGE_LIMIT)
            const rawChunks: any[] = Array.from(out?.chunks ?? out?.[0] ?? [])
            for (const raw of rawChunks) {
              const c = parseStoryChunk(raw)
              if (Number.isFinite(c.chunkIndex) && c.chunkIndex >= 0) existingMap.set(c.chunkIndex, c)
            }
            hasMore = Boolean(out?.hasMore ?? out?.[2])
            const nextOffset = Number(out?.nextOffset ?? out?.[3] ?? 0)
            if (!Number.isFinite(nextOffset) || nextOffset <= offset) break
            offset = nextOffset
          }
        }
      }

      const sorted = Array.from(existingMap.values())
        .filter(c => Number((c as any)?.chunkIndex) < total)
        .sort((a, b) => Number((a as any).chunkIndex) - Number((b as any).chunkIndex))
      const missing: number[] = []
      if (storyMetadata?.totalChunks) {
        for (let i = 0; i < storyMetadata.totalChunks; i++) {
          if (!sorted.find(c => c.chunkIndex === i)) missing.push(i)
        }
      }
      const fullStory = sorted.map(c => c.content).join('')
      const encoder = new TextEncoder()
      const computedLength = sorted.reduce((acc, c) => acc + encoder.encode(c.content).length, 0)
      const lengthMatch = storyMetadata?.totalLength ? computedLength === storyMetadata.totalLength : true
      let hashMatch: boolean | null = null
      let computedHash: string | undefined
      if (missing.length === 0 && storyMetadata?.totalChunks > 0 && storyMetadata?.fullStoryHash && storyMetadata.fullStoryHash !== ethers.ZeroHash) {
        computedHash = computeStoryHash(sorted)
        hashMatch = computedHash === storyMetadata.fullStoryHash
      }

      const storyData = {
        chunks: sorted,
        fullStory,
        integrity: {
          missing,
          lengthMatch,
          hashMatch,
          computedLength,
          computedHash
        },
        metadata: storyMetadata,
        loading: false,
        fetchedAt: Date.now()
      }

      if (nodeIdToUpdate) {
        setNodesData(prev => {
          const cur = prev[nodeIdToUpdate]
          if (!cur) return prev
          return {
            ...prev,
            [nodeIdToUpdate]: {
              ...cur,
              storyMetadata,
              storyChunks: storyData.chunks,
              storyFetchedAt: Date.now(),
            }
          }
        })
      }
      return storyData
    }

    // Prefer unified dataset (nodesData) if available and fresh
    const findNodeIdByToken = (): string | undefined => {
      for (const [id, nd] of Object.entries(nodesDataRef.current)) {
        if (nd.tokenId && String(nd.tokenId) === String(tokenId)) return id
      }
      return undefined
    }
    let nodeId = opts?.nodeIdHint || findNodeIdByToken()
    let ndFromLookup: NodeData | undefined
    if (!nodeId) {
      try { const nd = await getNodeByTokenId(tokenId); if (nd) { nodeId = nd.id; ndFromLookup = nd } } catch {}
    }
    if (nodeId) {
      const nd = ndFromLookup || nodesDataRef.current[nodeId]
      if (nd?.storyMetadata && Array.isArray(nd?.storyChunks)) {
        const stale = isStale(nd?.storyFetchedAt, STORY_TTL_MS)
        const sorted = [...nd.storyChunks].sort((a,b)=>a.chunkIndex-b.chunkIndex)
        const fullStory = sorted.map(c => c.content).join('')
        const encoder = new TextEncoder()
        const computedLength = sorted.reduce((acc, c) => acc + encoder.encode(c.content).length, 0)
        const missing: number[] = []
        if (nd.storyMetadata?.totalChunks) {
          for (let i = 0; i < nd.storyMetadata.totalChunks; i++) {
            if (!sorted.find(c => c.chunkIndex === i)) missing.push(i)
          }
        }
        let hashMatch: boolean | null = null
        let computedHash: string | undefined
        if (missing.length === 0 && nd.storyMetadata?.totalChunks! > 0 && nd.storyMetadata?.fullStoryHash && nd.storyMetadata.fullStoryHash !== ethers.ZeroHash) {
          computedHash = computeStoryHash(sorted)
          hashMatch = computedHash === nd.storyMetadata.fullStoryHash
        }
        if (stale) {
          scheduleStoryRevalidate(`story:${String(tokenId)}`, async () => {
            await fetchAndStoreStory(String(tokenId), nodeId!)
          })
        }
        return {
          chunks: sorted,
          fullStory,
          integrity: { missing, lengthMatch: nd.storyMetadata ? (computedLength === nd.storyMetadata.totalLength) : true, hashMatch, computedLength, computedHash },
          metadata: nd.storyMetadata,
          loading: false,
          fetchedAt: Number(nd?.storyFetchedAt || 0)
        }
      }
    }
    // legacy in-memory cache removed; rely solely on NodesData

    if (!provider || !contractAddress || !contract) {
      throw new Error('Provider or contract address not available')
    }

    try {
      const ensureId = nodeId || findNodeIdByToken()
      const out = await fetchAndStoreStory(String(tokenId), ensureId)
      return out
    } catch (error: any) {
      console.error('Failed to fetch story chunks:', error)
      throw error
    }
  }, [provider, contractAddress, contract, getNodeByTokenId])

  // Removed helper fetchAndStoreStory; unified via getStoryData and NodesData

  // Clear nodesData + story + owner caches for current namespace
  const clearAllCaches = useCallback(() => {
    setNodesData({})
    setEdgesUnion({})
    setEdgesStrict({})
    queryCacheRef.current.clear()
    setReachableNodeIds([])
    setProgress(undefined)
    if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
      deleteBlob(`${storageNS}::nodesData`).catch(() => {})
      deleteBlob(edgesUnionKey).catch(() => {})
      deleteBlob(edgesStrictKey).catch(() => {})
    }
  }, [storageNS, edgesUnionKey, edgesStrictKey])

  const invalidateTreeRootCache = useCallback(() => {
    setReachableNodeIds([])
    setProgress(undefined)
    setEdgesUnion({})
    setEdgesStrict({})
    queryCacheRef.current.clear()
    if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
      deleteBlob(edgesUnionKey).catch(() => {})
      deleteBlob(edgesStrictKey).catch(() => {})
    }
    refresh()
  }, [edgesStrictKey, edgesUnionKey, refresh])

  const updateTotalVersions = useCallback((personHash: string, totalVersions: number) => {
    if (!personHash || !Number.isFinite(totalVersions) || totalVersions <= 0) return
    const key = personHash.toLowerCase()
    setNodesData(prev => {
      const next = { ...prev }
      let changed = false
      for (const [id, nd] of Object.entries(next)) {
        if (nd.personHash.toLowerCase() === key && nd.totalVersions !== totalVersions) {
          next[id] = { ...nd, totalVersions }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  const refreshInvalidatedEdges = useCallback(async (invalidation: ReturnType<typeof getInvalidateKeysAfterPersonVersionAdded>) => {
    if (!api) {
      refresh()
      return
    }

    const reachableIds = new Set(reachableNodeIdsRef.current)
    const reachableHashes = new Set(Array.from(reachableIds).map(id => parseNodeId(id).personHash.toLowerCase()))
    const strictIds = new Set<NodeId>(invalidation.strictKeys)
    for (const prefix of invalidation.strictPrefixes) {
      const prefixLower = prefix.toLowerCase()
      for (const key of Object.keys(edgesStrictRef.current)) {
        if (key.toLowerCase().startsWith(prefixLower)) strictIds.add(key as NodeId)
      }
    }

    const unionUpserts: EdgeStoreUnion = {}
    const strictUpserts: EdgeStoreStrict = {}
    const newReachableChildren = new Set<NodeId>()

    for (const parentHashLower of invalidation.unionKeys) {
      if (!reachableHashes.has(parentHashLower)) continue
      try {
        const { childIds, totalVersions } = await api.listChildrenUnionAll(parentHashLower, {
          pageLimit: CHILDREN_PAGE_LIMIT,
          totalVersionsOptions: { ttlMs: TOTAL_VERSIONS_TTL_MS },
          onTotalVersions: (tv) => { if (tv > 0) updateTotalVersions(parentHashLower, tv) }
        })
        unionUpserts[parentHashLower] = { childIds, fetchedAt: Date.now(), totalVersions }
        for (const cid of childIds) newReachableChildren.add(cid)
      } catch {}
    }

    for (const parentId of strictIds) {
      if (!reachableIds.has(parentId)) continue
      try {
        const { personHash, versionIndex } = parseNodeId(parentId)
        const childIds = await api.listChildrenStrictAll(personHash, Number(versionIndex), { pageLimit: CHILDREN_PAGE_LIMIT })
        strictUpserts[parentId] = { childIds, fetchedAt: Date.now(), totalCount: childIds.length }
        for (const cid of childIds) newReachableChildren.add(cid)
      } catch {}
    }

    if (Object.keys(unionUpserts).length) {
      setEdgesUnion(prev => ({ ...prev, ...unionUpserts }))
    }
    if (Object.keys(strictUpserts).length) {
      setEdgesStrict(prev => ({ ...prev, ...strictUpserts }))
    }

    const newIds = Array.from(newReachableChildren)
    if (newIds.length) {
      setNodesData(prev => {
        let changed = false
        const next = { ...prev }
        for (const id of newIds) {
          if (next[id]) continue
          const parsed = parseNodeId(id)
          next[id] = { personHash: parsed.personHash, versionIndex: Number(parsed.versionIndex), id }
          changed = true
        }
        return changed ? next : prev
      })

      setReachableNodeIds(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of newIds) {
          if (next.has(id)) continue
          next.add(id)
          changed = true
        }
        return changed ? Array.from(next) : prev
      })
    }
  }, [api, refresh, updateTotalVersions])

  const parseTxEvents = useCallback((receipt: any) => {
    const parsed = {
      PersonVersionAdded: [] as Array<{
        personHash: string
        versionIndex: number
        fatherHash?: string
        fatherVersionIndex?: number
        motherHash?: string
        motherVersionIndex?: number
      }>,
      PersonVersionEndorsed: [] as Array<{ personHash: string; versionIndex: number }>,
      PersonNFTMinted: [] as Array<{ tokenId?: string | number; versionIndex?: number; personHash?: string }>
    }
    const logs = receipt?.logs
    if (!Array.isArray(logs) || logs.length === 0) return parsed
    const iface = contract?.interface || eventInterfaceRef.current
    for (const log of logs) {
      const logAddr = String((log as any)?.address || '').toLowerCase()
      if (contractAddress && logAddr && logAddr !== contractAddress.toLowerCase()) continue
      try {
        const evt = iface.parseLog(log)
        if (!evt) continue
        switch (evt.name) {
          case 'PersonVersionAdded':
            parsed.PersonVersionAdded.push({
              personHash: String(evt.args.personHash),
              versionIndex: Number(evt.args.versionIndex),
              fatherHash: String(evt.args.fatherHash),
              fatherVersionIndex: Number(evt.args.fatherVersionIndex),
              motherHash: String(evt.args.motherHash),
              motherVersionIndex: Number(evt.args.motherVersionIndex)
            })
            break
          case 'PersonVersionEndorsed':
            parsed.PersonVersionEndorsed.push({
              personHash: String(evt.args.personHash),
              versionIndex: Number(evt.args.versionIndex)
            })
            break
          case 'PersonNFTMinted':
            parsed.PersonNFTMinted.push({
              tokenId: evt.args.tokenId?.toString?.() ?? evt.args.tokenId,
              versionIndex: Number(evt.args.versionIndex),
              personHash: evt.args.personHash ? String(evt.args.personHash) : undefined
            })
            break
        }
      } catch {
        // ignore non-DeepFamily logs
      }
    }
    return parsed
  }, [contract, contractAddress])

  const invalidateByTx = useCallback((input?: {
    receipt?: any
    events?: {
      PersonVersionAdded?: {
        personHash: string
        versionIndex: number
        fatherHash?: string
        fatherVersionIndex?: number
        motherHash?: string
        motherVersionIndex?: number
      } | null
      PersonVersionEndorsed?: {
        personHash: string
        versionIndex: number
      } | null
      PersonNFTMinted?: {
        tokenId?: string | number
        versionIndex?: number
        personHash?: string
      } | null
    }
    hints?: {
      personHash?: string
      versionIndex?: number
      tokenId?: string | number
    }
  } | null) => {
    if (!input) return

    const parsed = input.receipt ? parseTxEvents(input.receipt) : {
      PersonVersionAdded: [] as Array<{
        personHash: string
        versionIndex: number
        fatherHash?: string
        fatherVersionIndex?: number
        motherHash?: string
        motherVersionIndex?: number
      }>,
      PersonVersionEndorsed: [] as Array<{ personHash: string; versionIndex: number }>,
      PersonNFTMinted: [] as Array<{ tokenId?: string | number; versionIndex?: number; personHash?: string }>
    }

    if (input.events?.PersonVersionAdded) parsed.PersonVersionAdded.push(input.events.PersonVersionAdded)
    if (input.events?.PersonVersionEndorsed) parsed.PersonVersionEndorsed.push(input.events.PersonVersionEndorsed)
    if (input.events?.PersonNFTMinted) parsed.PersonNFTMinted.push(input.events.PersonNFTMinted)

    const totalVersionsKeys = new Set<string>()
    const unionKeys = new Set<string>()
    const strictKeys = new Set<string>()
    const strictPrefixes = new Set<string>()
    const versionDetailKeys = new Set<string>()
    const nftKeys = new Set<string>()

    for (const ev of parsed.PersonVersionAdded) {
      const inv = getInvalidateKeysAfterPersonVersionAdded(ev)
      for (const key of inv.totalVersionsKeys) totalVersionsKeys.add(key)
      for (const key of inv.unionKeys) unionKeys.add(key)
      for (const key of inv.strictKeys) strictKeys.add(key)
      for (const key of inv.strictPrefixes) strictPrefixes.add(key)
    }

    for (const ev of parsed.PersonVersionEndorsed) {
      if (!ev.personHash || !Number.isFinite(Number(ev.versionIndex))) continue
      versionDetailKeys.add(vdKey(ev.personHash, ev.versionIndex))
    }

    for (const ev of parsed.PersonNFTMinted) {
      if (ev.tokenId !== undefined && ev.tokenId !== null && String(ev.tokenId) !== '') {
        nftKeys.add(nftKey(ev.tokenId))
      }
      if (ev.personHash && typeof ev.versionIndex === 'number' && Number.isFinite(ev.versionIndex) && ev.versionIndex > 0) {
        versionDetailKeys.add(vdKey(ev.personHash, ev.versionIndex))
      }
    }

    const hintHash = input.hints?.personHash
    const hintVersion = input.hints?.versionIndex
    const hintTokenId = input.hints?.tokenId
    if (hintTokenId !== undefined && hintTokenId !== null && String(hintTokenId) !== '') {
      nftKeys.add(nftKey(hintTokenId))
    }
    if (hintHash && typeof hintVersion === 'number' && Number.isFinite(hintVersion) && hintVersion > 0) {
      versionDetailKeys.add(vdKey(hintHash, hintVersion))
    }

    for (const key of totalVersionsKeys) {
      queryCacheRef.current.clear(key)
    }
    for (const key of versionDetailKeys) {
      queryCacheRef.current.clear(key)
    }
    for (const key of nftKeys) {
      queryCacheRef.current.clear(key)
    }

    // Mark any node version-details as stale so background revalidation runs.
    if (versionDetailKeys.size > 0) {
      const staleIds: string[] = []
      for (const key of versionDetailKeys) {
        const parsedKey = parseVdKey(key)
        if (!parsedKey) continue
        staleIds.push(makeNodeId(parsedKey.hashLower, parsedKey.versionIndex))
      }
      if (staleIds.length) {
        setNodesData(prev => {
          let changed = false
          const next = { ...prev }
          for (const id of staleIds) {
            const cur = next[id]
            if (!cur) continue
            if (!cur.versionDetailsFetchedAt) continue
            next[id] = { ...cur, versionDetailsFetchedAt: 0 }
            changed = true
          }
          return changed ? next : prev
        })
      }
    }

    const invalidation = {
      totalVersionsKeys: Array.from(totalVersionsKeys),
      unionKeys: Array.from(unionKeys),
      strictKeys: Array.from(strictKeys),
      strictPrefixes: Array.from(strictPrefixes)
    }

    if (invalidation.unionKeys.length > 0) {
      setEdgesUnion(prev => {
        let changed = false
        const next = { ...prev }
        for (const key of invalidation.unionKeys) {
          if (key in next) {
            delete next[key]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

    if (invalidation.strictKeys.length > 0 || invalidation.strictPrefixes.length > 0) {
      setEdgesStrict(prev => {
        let changed = false
        const next = { ...prev }
        for (const key of invalidation.strictKeys) {
          if (key in next) {
            delete next[key]
            changed = true
          }
        }
        for (const prefix of invalidation.strictPrefixes) {
          const prefixLower = prefix.toLowerCase()
          for (const key of Object.keys(next)) {
            if (key.toLowerCase().startsWith(prefixLower)) {
              delete next[key]
              changed = true
            }
          }
        }
        return changed ? next : prev
      })
    }

    if (invalidation.unionKeys.length > 0 || invalidation.strictKeys.length > 0 || invalidation.strictPrefixes.length > 0) {
      refreshInvalidatedEdges(invalidation).catch(() => refresh())
    }
  }, [parseTxEvents, refresh, refreshInvalidatedEdges])

  // Function to preload story data in background
  const preloadStoryData = useCallback((tokenId: string) => {
    getStoryData(tokenId).catch(() => { /* silent */ })
  }, [getStoryData])

  const bumpEndorsementCount = useCallback((personHash: string, versionIndex: number, delta: number = 1) => {
    if (!personHash || !Number.isFinite(Number(versionIndex))) return
    setNodesData(prev => {
      let changed = false
      const next: typeof prev = {}
      for (const [id, nd] of Object.entries(prev)) {
        if (nd.personHash === personHash && Number(nd.versionIndex) === Number(versionIndex)) {
          const current = nd.endorsementCount ?? 0
          next[id] = { ...nd, endorsementCount: current + delta }
          changed = true
        } else {
          next[id] = nd
        }
      }
      if (!changed) {
        const nid = makeNodeId(personHash, Number(versionIndex))
        const existing = prev[nid]
        next[nid] = existing ? { ...existing, endorsementCount: (existing.endorsementCount ?? 0) + delta } : {
          personHash,
          versionIndex: Number(versionIndex),
          id: nid,
          endorsementCount: delta
        } as NodeData
        changed = true
      }
      if (changed) return next
      return prev
    })
  }, [])


  // Cached ownerOf lookup
  const getOwnerOf = useCallback(async (tokenId: string): Promise<string | null> => {
    if (!contract) return null
    // Prefer nodesData snapshot first
    for (const nd of Object.values(nodesDataRef.current)) {
      if (nd.tokenId && String(nd.tokenId) === String(tokenId) && nd.owner) {
        return nd.owner
      }
    }
    // Try persisted snapshot (before touching network)
    if (USE_INDEXEDDB_CACHE && isIndexedDBSupported()) {
      try {
        const obj = await readBlob<Record<string, NodeData>>(`${storageNS}::nodesData`)
        if (obj) {
          for (const [id, nd] of Object.entries(obj)) {
            if (nd.tokenId && String(nd.tokenId) === String(tokenId) && nd.owner) {
              // Backfill owner into state
              setNodesData(prev => {
                const cur = prev[id]
                if (!cur) return { ...prev, [id]: nd }
                if (cur.owner === nd.owner) return prev
                return { ...prev, [id]: { ...cur, owner: nd.owner } }
              })
              return nd.owner
            }
          }
        }
      } catch {}
    }
    try {
      const owner = await contract.ownerOf(tokenId)
      setNodesData(prev => {
        let foundId: string | undefined
        for (const [id, nd] of Object.entries(prev)) {
          if (nd.tokenId && String(nd.tokenId) === String(tokenId)) { foundId = id; break }
        }
        if (!foundId) return prev
        const cur = prev[foundId]
        if (cur.owner === owner) return prev
        return { ...prev, [foundId]: { ...cur, owner } }
      })
      return owner
    } catch { return null }
  }, [contract, storageNS])

  const value: TreeDataValue = {
    rootId,
    rootExists,
    reachableNodeIds,
    loading,
    progress,
    contractMessage,
    refresh,
    invalidateTreeRootCache,
    errors,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
    setNodesData,
    getStoryData,
    getDebugStats,
    clearAllCaches,
    preloadStoryData,
    getNodeByTokenId,
    getOwnerOf,
    bumpEndorsementCount,
    invalidateByTx
  }

  return <TreeDataContext.Provider value={value}>{children}</TreeDataContext.Provider>
}

export function useTreeData() {
  const ctx = useContext(TreeDataContext)
  if (!ctx) throw new Error('useTreeData must be used within TreeDataProvider')
  return ctx
}
