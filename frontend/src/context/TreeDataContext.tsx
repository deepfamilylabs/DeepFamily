import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useConfig } from './ConfigContext'
import { useTranslation } from 'react-i18next'
import type { GraphNode } from '../types/graph'
import { makeNodeId } from '../types/graph'
import DeepFamily from '../abi/DeepFamily.json'
import { ethers } from 'ethers'
import { fetchSubtreeStream } from '../components/Visualization'
import { getRuntimeVisualizationConfig } from '../config/visualization'
import { useErrorMonitor } from '../hooks/useErrorMonitor'
import { useVizOptions } from './VizOptionsContext'
import { NodeData } from '../types/graph'

// Reuse provider instances to avoid repeated network detection / socket exhaustion
const providerCache = new Map<string, ethers.JsonRpcProvider>()

export interface TreeProgress { created: number; visited: number; depth: number }
interface TreeDataValue {
  root: GraphNode | null
  loading: boolean
  progress?: TreeProgress
  contractMessage: string
  refresh: () => void
  errors: ReturnType<typeof useErrorMonitor>['errors']
  includeVersionDetails: boolean
  nodesData: Record<string, NodeData>
  setNodesData?: React.Dispatch<React.SetStateAction<Record<string, NodeData>>>
  getStoryData: (tokenId: string) => Promise<any>
  clearStoryCache: (tokenId?: string) => void
  preloadStoryData: (tokenId: string) => void
}

const TreeDataContext = createContext<TreeDataValue | null>(null)

const MULTICALL_ABI = [
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) public returns (tuple(bool success, bytes returnData)[])'
]

export function TreeDataProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { rpcUrl, contractAddress, rootHash, rootVersionIndex } = useConfig()
  const { traversal, includeVersionDetails } = useVizOptions()
  const [root, setRoot] = useState<GraphNode | null>(null)
  const [nodesData, setNodesData] = useState<Record<string, NodeData>>({})
  const nodesDataRef = useRef(nodesData)
  const storyDataCache = useRef<Map<string, any>>(new Map())
  useEffect(() => { nodesDataRef.current = nodesData }, [nodesData])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<TreeProgress | undefined>(undefined)
  const [contractMessage, setContractMessage] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = useCallback(() => setRefreshTick(t => t + 1), [])
  useEffect(() => { refresh() }, [refresh])
  const { errors, push } = useErrorMonitor()
  const stageLoggedRef = useRef<Set<string>>(new Set())
  const [loadOptionsSnapshot, setLoadOptionsSnapshot] = useState({ includeVersionDetails })
  useEffect(() => {
    if (includeVersionDetails && !loadOptionsSnapshot.includeVersionDetails) {
      setLoadOptionsSnapshot(s => s.includeVersionDetails ? s : { ...s, includeVersionDetails: true })
    }
  }, [includeVersionDetails, loadOptionsSnapshot.includeVersionDetails])
  const optionsRef = useRef({ traversal })
  useEffect(() => { const o = optionsRef.current; if (o.traversal !== traversal) { o.traversal = traversal; refresh() } }, [traversal, refresh])

  // Provider + contract (memoized & cached)
  const provider = useMemo(() => {
    if (!rpcUrl) return null
    if (providerCache.has(rpcUrl)) return providerCache.get(rpcUrl) as ethers.JsonRpcProvider
    try {
      const p = new ethers.JsonRpcProvider(rpcUrl)
      providerCache.set(rpcUrl, p)
      return p
    } catch { return null }
  }, [rpcUrl])

  const contract = useMemo(() => {
    if (!provider || !contractAddress) return null
    try { return new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider) } catch { return null }
  }, [provider, contractAddress])

  const fetchRunKeyRef = useRef<string | null>(null)

  // Root + base streaming load
  useEffect(() => {
    if (refreshTick === 0) return
    if (!contract) return
    const runKey = `contract-${rootHash}-${rootVersionIndex}-${refreshTick}`
    if (fetchRunKeyRef.current === runKey) return
    fetchRunKeyRef.current = runKey
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      setLoading(true)
      setLoadOptionsSnapshot({ includeVersionDetails })
      // Reset state on new load
      setRoot(null)
      setNodesData({})
      setContractMessage('')
      setProgress(undefined)
      try { await contract.getVersionDetails(rootHash, rootVersionIndex) } catch (e) {
        if (!cancelled) {
          setRoot(null); setContractMessage(t('visualization.status.contractModeRootNotFound'))
          if (!stageLoggedRef.current.has('root_check')) { stageLoggedRef.current.add('root_check'); push(e as any, { stage: 'root_check' }) }
        }
        setLoading(false)
        return
      }
      try {
        let rootNode: GraphNode | undefined
        let lastUpdate = performance.now()
        let emitted = 0
        const { traversal: trv } = optionsRef.current
        for await (const _ of fetchSubtreeStream(contract, rootHash, rootVersionIndex, {
          signal: controller.signal,
          traversal: trv,
          maxDepth: getRuntimeVisualizationConfig().DEFAULT_MAX_DEPTH,
          hardNodeLimit: getRuntimeVisualizationConfig().DEFAULT_HARD_NODE_LIMIT,
          onProgress: stats => { if (!cancelled) setProgress(stats) },
          onNode: n => {
            if (!rootNode) rootNode = n
            const id = makeNodeId(n.personHash, Number(n.versionIndex))
            setNodesData(prev => prev[id] ? prev : ({ ...prev, [id]: { personHash: n.personHash, versionIndex: Number(n.versionIndex), id, tag: n.tag } }))
          }
        })) {
          if (cancelled) break
          if (!rootNode) continue
          const now = performance.now()
            emitted++
          if (now - lastUpdate > 60 || emitted % 25 === 0) {
            setRoot(prev => {
              if (!prev) return rootNode ? { ...rootNode } : null
              // shallow compare child count & hash/version to skip redundant updates
              if (prev.personHash === rootNode!.personHash && prev.versionIndex === rootNode!.versionIndex && (prev.children?.length || 0) === (rootNode!.children?.length || 0)) return prev
              return { ...rootNode! }
            })
            lastUpdate = now
          }
        }
        if (!cancelled && rootNode) setRoot(prev => {
          const rn = rootNode as GraphNode
          if (!prev) return { ...rn }
          if (prev.personHash === rn.personHash && prev.versionIndex === rn.versionIndex && (prev.children?.length || 0) === (rn.children?.length || 0)) return prev
          return { ...rn }
        })
      } catch (e: any) {
        if (!cancelled && e?.name !== 'AbortError') { setContractMessage(e.message || 'error'); push(e, { stage: 'stream_fetch' }) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { 
      cancelled = true 
      controller.abort() 
      setLoading(l => l ? false : l)
      // Clear story cache when refreshing data
      storyDataCache.current.clear()
    }
  }, [contract, rootHash, rootVersionIndex, refreshTick, traversal, t, push, includeVersionDetails])

  const nodePairs = useMemo(() => {
    if (!root) return [] as Array<{ h: string; v: number }>
    const acc: Array<{ h: string, v: number }> = []
    const stack: GraphNode[] = [root]
    while (stack.length) {
      const n = stack.pop() as GraphNode
      acc.push({ h: n.personHash, v: Number(n.versionIndex) })
      if (n.children) for (const c of n.children) stack.push(c)
    }
    return acc
  }, [root])

  // Endorsement counts
  useEffect(() => {
    if (!loadOptionsSnapshot.includeVersionDetails) return
    if (loading || !contract || !root) return
    const endorseEnabledSnapshot = loadOptionsSnapshot.includeVersionDetails
    let cancelled = false
    ;(async () => {
      if (!endorseEnabledSnapshot) return
      const BATCH = getRuntimeVisualizationConfig().ENDORSEMENT_STATS_BATCH
      const iface = new ethers.Interface((DeepFamily as any).abi)
      const multicallAddress = (import.meta as any).env.VITE_MULTICALL_ADDRESS
      const useMulticall = !!multicallAddress && provider
      const multicall = useMulticall ? new ethers.Contract(multicallAddress, MULTICALL_ABI, provider) : null
      for (let i = 0; i < nodePairs.length && !cancelled; i += BATCH) {
        const slice = nodePairs.slice(i, i + BATCH)
        try {
          const calls = slice.map(p => ({ target: contractAddress, callData: iface.encodeFunctionData('getVersionDetails', [p.h, p.v]) }))
          let returned: any[] = []
          if (multicall && useMulticall) {
            try { returned = await multicall.tryAggregate(false, calls) } catch (e) {
              if (!stageLoggedRef.current.has('multicall_tryAggregate_counts')) { stageLoggedRef.current.add('multicall_tryAggregate_counts'); push(e as any, { stage: 'multicall_tryAggregate_counts' }) }
              returned = await Promise.all(calls.map(c => contract.getVersionDetails(...iface.decodeFunctionData('getVersionDetails', c.callData))))
              returned = returned.map(r => [true, iface.encodeFunctionResult('getVersionDetails', r)])
            }
          } else {
            returned = await Promise.all(calls.map(c => contract.getVersionDetails(...iface.decodeFunctionData('getVersionDetails', c.callData))))
            returned = returned.map(r => [true, iface.encodeFunctionResult('getVersionDetails', r)])
          }
          const pendingNFTs: Array<{ id: string; tokenId: string }> = []
          returned.forEach((entry: any, idx: number) => {
            if (cancelled) return
            const original = slice[idx]
            try {
              const success = Array.isArray(entry) ? entry[0] : entry.success
              const returnData = Array.isArray(entry) ? entry[1] : entry.returnData
              if (success && returnData && returnData !== '0x') {
                const decoded: any = iface.decodeFunctionResult('getVersionDetails', returnData)
                // decoded: [PersonVersion version, uint256 endorsementCount, uint256 tokenId]
                const versionStruct: any = decoded?.[0]
                const endorsementCount = Number(decoded?.[1] ?? 0)
                const tokenIdVal = decoded?.[2]
                const tokenId = tokenIdVal !== undefined && tokenIdVal !== null ? tokenIdVal.toString() : '0'
                const id = makeNodeId(original.h, original.v)
                setNodesData(prev => {
                  if (!prev[id]) return prev
                  const vs = versionStruct || {}
                  const fatherHash = vs.fatherHash || vs[1]
                  const motherHash = vs.motherHash || vs[2]
                  const fatherVersionIndex = vs.fatherVersionIndex !== undefined ? Number(vs.fatherVersionIndex) : (vs[4] !== undefined ? Number(vs[4]) : undefined)
                  const motherVersionIndex = vs.motherVersionIndex !== undefined ? Number(vs.motherVersionIndex) : (vs[5] !== undefined ? Number(vs[5]) : undefined)
                  const addedBy = vs.addedBy || vs[6]
                  const timestampRaw = vs.timestamp !== undefined ? vs.timestamp : vs[7]
                  const timestamp = timestampRaw !== undefined && timestampRaw !== null ? Number(timestampRaw) : undefined
                  const tag = vs.tag || vs[8] || prev[id].tag
                  const metadataCID = vs.metadataCID || vs[9]
                  return {
                    ...prev,
                    [id]: {
                      ...prev[id],
                      endorsementCount,
                      tokenId,
                      fatherHash,
                      motherHash,
                      fatherVersionIndex,
                      motherVersionIndex,
                      addedBy,
                      timestamp,
                      tag,
                      metadataCID
                    }
                  }
                })
                if (tokenId !== '0') pendingNFTs.push({ id, tokenId })
              }
            } catch (e) { if (!stageLoggedRef.current.has('decode_counts')) { stageLoggedRef.current.add('decode_counts'); push(e as any, { stage: 'decode_counts' }) } }
          })
          for (const item of pendingNFTs) {
            if (cancelled) break
            const current = nodesDataRef.current[item.id]
            if (!current || current.fullName !== undefined) continue
            try {
              const nftRet = await contract.getNFTDetails(item.tokenId)
              // nftRet: [personHash, versionIndex, version(PersonVersion), coreInfo, endorsementCount, nftTokenURI]
              const versionStruct2: any = nftRet[2]
              const coreInfo: any = nftRet[3]
              const endorsementCountBN2: any = nftRet[4]
              const nftTokenURI: any = nftRet[5]
              const vs2 = versionStruct2 || {}
              const fatherHash = vs2.fatherHash || vs2[1]
              const motherHash = vs2.motherHash || vs2[2]
              const fatherVersionIndex = vs2.fatherVersionIndex !== undefined ? Number(vs2.fatherVersionIndex) : (vs2[4] !== undefined ? Number(vs2[4]) : undefined)
              const motherVersionIndex = vs2.motherVersionIndex !== undefined ? Number(vs2.motherVersionIndex) : (vs2[5] !== undefined ? Number(vs2[5]) : undefined)
              const addedBy = vs2.addedBy || vs2[6]
              const timestampRaw = vs2.timestamp !== undefined ? vs2.timestamp : vs2[7]
              const timestamp = timestampRaw !== undefined && timestampRaw !== null ? Number(timestampRaw) : undefined
              const tag = vs2.tag || vs2[8]
              const metadataCID = vs2.metadataCID || vs2[9]
              const fullName = coreInfo?.basicInfo?.fullName
              const gender = coreInfo?.basicInfo?.gender !== undefined ? Number(coreInfo.basicInfo.gender) : undefined
              const birthYear = coreInfo?.basicInfo?.birthYear !== undefined ? Number(coreInfo.basicInfo.birthYear) : undefined
              const birthMonth = coreInfo?.basicInfo?.birthMonth !== undefined ? Number(coreInfo.basicInfo.birthMonth) : undefined
              const birthDay = coreInfo?.basicInfo?.birthDay !== undefined ? Number(coreInfo.basicInfo.birthDay) : undefined
              const birthPlace = coreInfo?.supplementInfo?.birthPlace
              const isBirthBC = coreInfo?.basicInfo?.isBirthBC !== undefined ? Boolean(coreInfo.basicInfo.isBirthBC) : undefined
              const deathYear = coreInfo?.supplementInfo?.deathYear !== undefined ? Number(coreInfo.supplementInfo.deathYear) : undefined
              const deathMonth = coreInfo?.supplementInfo?.deathMonth !== undefined ? Number(coreInfo.supplementInfo.deathMonth) : undefined
              const deathDay = coreInfo?.supplementInfo?.deathDay !== undefined ? Number(coreInfo.supplementInfo.deathDay) : undefined
              const deathPlace = coreInfo?.supplementInfo?.deathPlace
              const isDeathBC = coreInfo?.supplementInfo?.isDeathBC !== undefined ? Boolean(coreInfo.supplementInfo.isDeathBC) : undefined
              const story = coreInfo?.supplementInfo?.story
              const endorsementCount2 = endorsementCountBN2 !== undefined && endorsementCountBN2 !== null ? Number(endorsementCountBN2) : undefined
              
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
                    fatherHash: fatherHash ?? cur.fatherHash,
                    motherHash: motherHash ?? cur.motherHash,
                    fatherVersionIndex: fatherVersionIndex ?? cur.fatherVersionIndex,
                    motherVersionIndex: motherVersionIndex ?? cur.motherVersionIndex,
                    addedBy: addedBy ?? cur.addedBy,
                    timestamp: timestamp ?? cur.timestamp,
                    tag: (tag || cur.tag),
                    metadataCID: metadataCID ?? cur.metadataCID,
                    endorsementCount: endorsementCount2 ?? cur.endorsementCount,
                    tokenId: item.tokenId,
                    fullName,
                    gender,
                    birthYear,
                    birthMonth,
                    birthDay,
                    birthPlace,
                    isBirthBC,
                    deathYear,
                    deathMonth,
                    deathDay,
                    deathPlace,
                    isDeathBC,
                    story,
                    nftTokenURI,
                    storyMetadata
                  }
                }
              })
            } catch (e) {
              if (!stageLoggedRef.current.has('nft_details_batch')) { stageLoggedRef.current.add('nft_details_batch'); push(e as any, { stage: 'nft_details_batch' }) }
            }
          }
        } catch (e) { if (!stageLoggedRef.current.has('counts_batch')) { stageLoggedRef.current.add('counts_batch'); push(e as any, { stage: 'counts_batch' }) } }
      }
    })()
    return () => { cancelled = true }
  }, [loadOptionsSnapshot.includeVersionDetails, loading, contract, root, nodePairs, contractAddress, provider, push])

  // Function to get story data with caching
  const getStoryData = useCallback(async (tokenId: string) => {
    // Check cache first
    if (storyDataCache.current.has(tokenId)) {
      return storyDataCache.current.get(tokenId)
    }

    if (!provider || !contractAddress) {
      throw new Error('Provider or contract address not available')
    }

    try {
      const metadata = await contract!.getStoryMetadata(tokenId)
      const storyMetadata = {
        totalChunks: Number(metadata.totalChunks),
        totalLength: Number(metadata.totalLength),
        isSealed: Boolean(metadata.isSealed),
        lastUpdateTime: Number(metadata.lastUpdateTime),
        fullStoryHash: metadata.fullStoryHash
      }

      const chunks: any[] = []
      if (storyMetadata.totalChunks > 0) {
        for (let i = 0; i < storyMetadata.totalChunks; i++) {
          try {
            const chunk = await contract!.getStoryChunk(tokenId, i)
            chunks.push({
              chunkIndex: Number(chunk.chunkIndex),
              chunkHash: chunk.chunkHash,
              content: chunk.content,
              timestamp: Number(chunk.timestamp),
              lastEditor: chunk.lastEditor
            })
          } catch (e) {
            console.warn(`Missing chunk ${i} for token ${tokenId}`)
          }
        }
      }

      // Compute story integrity
      const sorted = [...chunks].sort((a,b)=>a.chunkIndex-b.chunkIndex)
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
        try {
          const concatenated = '0x' + sorted.map(c => c.chunkHash.replace(/^0x/, '')).join('')
          computedHash = ethers.keccak256(concatenated)
          hashMatch = computedHash === storyMetadata.fullStoryHash
        } catch {
          // ignore
        }
      }

      const storyData = {
        chunks: chunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
        fullStory,
        integrity: {
          missing,
          lengthMatch,
          hashMatch,
          computedLength,
          computedHash
        },
        metadata: storyMetadata,
        loading: false
      }

      // Cache the result
      storyDataCache.current.set(tokenId, storyData)
      return storyData
    } catch (error: any) {
      console.error('Failed to fetch story chunks:', error)
      throw error
    }
  }, [provider, contractAddress, contract])

  // Function to clear story cache
  const clearStoryCache = useCallback((tokenId?: string) => {
    if (tokenId) {
      storyDataCache.current.delete(tokenId)
    } else {
      storyDataCache.current.clear()
    }
  }, [])

  // Function to preload story data in background
  const preloadStoryData = useCallback((tokenId: string) => {
    if (!storyDataCache.current.has(tokenId)) {
      getStoryData(tokenId).catch(() => {
        // Silent fail for preloading
      })
    }
  }, [getStoryData])

  const value: TreeDataValue = {
    root,
    loading,
    progress,
    contractMessage,
    refresh,
    errors,
    includeVersionDetails,
    nodesData,
    setNodesData,
    getStoryData,
    clearStoryCache,
    preloadStoryData
  }

  return <TreeDataContext.Provider value={value}>{children}</TreeDataContext.Provider>
}

export function useTreeData() {
  const ctx = useContext(TreeDataContext)
  if (!ctx) throw new Error('useTreeData must be used within TreeDataProvider')
  return ctx
}
