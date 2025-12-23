import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useTreeData } from './TreeDataContext'
import NodeDetailModal from '../components/NodeDetailModal'
import { NodeData, makeNodeId } from '../types/graph'
import { ethers } from 'ethers'
import DeepFamily from '../abi/DeepFamily.json'
import { useConfig } from './ConfigContext'
import { makeProvider } from '../utils/provider'
import { createDeepFamilyApi } from '../utils/deepFamilyApi'
import { QueryCache } from '../utils/queryCache'

export interface NodeKeyMinimal { personHash: string; versionIndex: number }

interface NodeDetailState {
  open: boolean
  selected: NodeKeyMinimal | null
  selectedNodeData: NodeData | null
  loading: boolean
  error: string | null
  openNode: (k: NodeKeyMinimal) => void
  close: () => void
}

const Ctx = createContext<NodeDetailState | undefined>(undefined)

export function NodeDetailProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<NodeKeyMinimal | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { nodesData, setNodesData } = useTreeData() as any
  const { rpcUrl, contractAddress, chainId } = useConfig()
  const queryCacheRef = useRef(new QueryCache())

  const openNode = useCallback((k: NodeKeyMinimal) => { setSelected(k) }, [])
  const close = useCallback(() => { setSelected(null) }, [])
  
  const selectedNodeData = selected ? nodesData?.[makeNodeId(selected.personHash, selected.versionIndex)] || null : null

  useEffect(() => {
    if (!selected) { setError(null); setLoading(false); return }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    if (!rpcUrl || !contractAddress || !setNodesData) return
    let cancelled = false
    const run = async () => {
      const id = makeNodeId(selected.personHash, selected.versionIndex)
      const nd = nodesData?.[id]
      const needVersion = !nd || nd.addedBy === undefined || nd.fatherHash === undefined || nd.metadataCID === undefined
      const provider = makeProvider(rpcUrl, chainId)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const api = createDeepFamilyApi(contract, queryCacheRef.current)
      try {
        setLoading(true)
        setError(null)
        let tokenId: string | undefined = nd?.tokenId
        if (needVersion) {
          const ret = await api.getVersionDetails(selected.personHash, selected.versionIndex)
          tokenId = ret.tokenId
          const versionFields = ret.version
          const endorsementCount = ret.endorsementCount
          if (!cancelled) setNodesData((prev: any) => prev[id] ? ({
            ...prev,
            [id]: {
              ...prev[id],
              fatherHash: versionFields.fatherHash,
              motherHash: versionFields.motherHash,
              fatherVersionIndex: versionFields.fatherVersionIndex ?? 0,
              motherVersionIndex: versionFields.motherVersionIndex ?? 0,
              addedBy: versionFields.addedBy,
              timestamp: versionFields.timestamp,
              tag: (versionFields.tag || prev[id].tag),
              metadataCID: versionFields.metadataCID,
              endorsementCount,
              tokenId
            }
          }) : prev)
        }
        const ndAfter = () => (nodesData?.[id])
        await Promise.resolve()
        const ndCur = ndAfter()
        const effectiveTokenId = tokenId || ndCur?.tokenId
        const needNFT = effectiveTokenId && effectiveTokenId !== '0' && (!ndCur || ndCur.fullName === undefined || ndCur.nftTokenURI === undefined || ndCur.story === undefined)
        if (needNFT) {
          const nftRet = await api.getNFTDetails(effectiveTokenId)
          const versionFields = nftRet.version
          const coreFields = nftRet.core
          const endorsementCount2 = nftRet.endorsementCount
          const nftTokenURI = nftRet.nftTokenURI
          
          let storyMetadata = null
          let storyChunks = null
          try {
            const metadata = await contract.getStoryMetadata(effectiveTokenId)
            storyMetadata = {
              totalChunks: Number(metadata.totalChunks),
              totalLength: Number(metadata.totalLength),
              isSealed: Boolean(metadata.isSealed),
              lastUpdateTime: Number(metadata.lastUpdateTime),
              fullStoryHash: metadata.fullStoryHash
            }
            
            if (storyMetadata.totalChunks > 0) {
              storyChunks = []
              for (let i = 0; i < storyMetadata.totalChunks; i++) {
                const chunk = await contract.getStoryChunk(effectiveTokenId, i)
                storyChunks.push({
                  chunkIndex: Number(chunk.chunkIndex),
                  chunkHash: chunk.chunkHash,
                  content: chunk.content,
                  timestamp: Number(chunk.timestamp),
                  editor: chunk.editor,
                  chunkType: Number(chunk.chunkType),
                  attachmentCID: chunk.attachmentCID
                })
              }
            }
          } catch (e) {
            console.warn('Failed to fetch story chunks:', e)
          }
          
          if (!cancelled) setNodesData((prev: any) => prev[id] ? ({
            ...prev,
            [id]: {
              ...prev[id],
              fatherHash: versionFields.fatherHash,
              motherHash: versionFields.motherHash,
              fatherVersionIndex: versionFields.fatherVersionIndex ?? 0,
              motherVersionIndex: versionFields.motherVersionIndex ?? 0,
              addedBy: versionFields.addedBy,
              timestamp: versionFields.timestamp,
              tag: (versionFields.tag || prev[id].tag),
              metadataCID: versionFields.metadataCID,
              endorsementCount: endorsementCount2 ?? prev[id].endorsementCount,
              tokenId: effectiveTokenId,
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
              storyMetadata, storyChunks
            }
          }) : prev)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rpcUrl, contractAddress, chainId])
  return (
    <Ctx.Provider value={{ open: !!selected, selected, selectedNodeData, loading, error, openNode, close }}>
      {children}
      <NodeDetailModal
        open={!!selected}
        onClose={close}
        nodeData={selectedNodeData}
        fallback={{ hash: selected?.personHash || '', versionIndex: selected?.versionIndex }}
        loading={loading}
        error={error}
      />
    </Ctx.Provider>
  )
}

export function useNodeDetail() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNodeDetail must be used within NodeDetailProvider')
  return ctx
}
