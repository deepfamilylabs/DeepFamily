import { useEffect, useMemo, useState, useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StoryChunkEditor from '../components/StoryChunkEditor'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfig } from '../context/ConfigContext'
import { useTreeData } from '../context/TreeDataContext'
import { useWallet } from '../context/WalletContext'
import { useToast } from '../components/ToastProvider'
import { addStoryChunk, updateStoryChunk, sealStory } from '../lib/story'
import type { StoryChunk, StoryChunkCreateData, StoryChunkUpdateData, StoryMetadata } from '../types/graph'

interface PrefetchedState {
  prefetchedStory?: {
    tokenId: string
    storyMetadata?: StoryMetadata
    storyChunks?: StoryChunk[]
  }
}

export default function StoryEditorPage() {
  const { tokenId } = useParams<{ tokenId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { contractAddress, strictCacheOnly } = useConfig()
  const { getStoryData, setNodesData } = useTreeData()
  const { signer, address } = useWallet()
  const toast = useToast()

  const prefetched = (location.state as PrefetchedState | undefined)?.prefetchedStory

  // Ensure window starts at top when entering the editor page
  useEffect(() => { try { window.scrollTo({ top: 0, behavior: 'instant' as any }) } catch { window.scrollTo(0, 0) } }, [])

  const [meta, setMeta] = useState<StoryMetadata | undefined>(prefetched?.storyMetadata)
  const [chunks, setChunks] = useState<StoryChunk[] | undefined>(prefetched?.storyChunks)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState<boolean>(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState<boolean>(false)

  const validTokenId = useMemo(() => tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined, [tokenId])


  const loadIfNeeded = useCallback(async () => {
    if (!validTokenId) { setError(t('person.invalidTokenId', 'Invalid token ID')); return }
    if (meta && chunks) return
    setLoading(true)
    setError(null)
    try {
      const data = await getStoryData(validTokenId)
      if (!data) {
        setMeta(undefined)
        setChunks(undefined)
        setError(strictCacheOnly ? t('storyChunkEditor.offlineNoData', 'Offline mode: story not cached locally') : t('storyChunkEditor.loading', 'Loading...'))
        return
      }
      setMeta(data.metadata as StoryMetadata)
      setChunks(data.chunks as StoryChunk[])
    } catch (e: any) {
      setError(e?.message || t('storyChunkEditor.loading', 'Loading...'))
    } finally {
      setLoading(false)
    }
  }, [validTokenId, getStoryData, meta, chunks, t])

  useEffect(() => { loadIfNeeded() }, [loadIfNeeded])

  // Warn before unload if there are unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    if (dirty) window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const refetch = useCallback(async () => {
    if (!validTokenId) return
    // Invalidate NodeData story cache for this token to force fresh fetch
    if (setNodesData) {
      setNodesData(prev => {
        let foundId: string | undefined
        for (const [id, nd] of Object.entries(prev)) {
          if (nd.tokenId && String(nd.tokenId) === String(validTokenId)) { foundId = id; break }
        }
        if (!foundId) return prev
        const cur = prev[foundId]
        return {
          ...prev,
          [foundId]: { ...cur, storyFetchedAt: 0, storyMetadata: undefined, storyChunks: undefined }
        }
      })
    }
    try {
      const data = await getStoryData(validTokenId)
      if (!data) {
        if (strictCacheOnly) setError(t('storyChunkEditor.offlineNoData', 'Offline mode: story not cached locally'))
        return
      }
      setMeta(data.metadata as StoryMetadata)
      setChunks(data.chunks as StoryChunk[])
    } catch {}
  }, [validTokenId, getStoryData, setNodesData, strictCacheOnly, t])

  const onAddChunk = useCallback(async (data: StoryChunkCreateData) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    // 执行区块链操作
    const result = await addStoryChunk(
      signer,
      contractAddress,
      data.tokenId,
      data.chunkIndex,
      data.content,
      data.expectedHash || ''
    )

    // After successful operation, immediately update local state
    const newChunks = chunks ? [...chunks, result.newChunk] : [result.newChunk]
    setChunks(newChunks)

    // Update total chunks count in metadata
    const newMeta: StoryMetadata | undefined = meta ? {
      ...meta,
      totalChunks: (meta.totalChunks || 0) + 1,
      lastUpdateTime: result.newChunk.timestamp,
      totalLength: (meta.totalLength || 0) + result.contentLength
    } : undefined
    setMeta(newMeta)

    // Synchronize updates to TreeDataContext node data cache
    if (setNodesData && validTokenId) {
      setNodesData(prev => {
        let foundId: string | undefined
        for (const [id, nd] of Object.entries(prev)) {
          if (nd.tokenId && String(nd.tokenId) === String(validTokenId)) {
            foundId = id
            break
          }
        }
        if (!foundId) return prev

        const cur = prev[foundId]
        return {
          ...prev,
          [foundId]: {
            ...cur,
            storyMetadata: newMeta,
            storyChunks: newChunks
          }
        }
      })
    }

    // Show success message with event data if available
    if (result.events.StoryChunkAdded) {
      toast.success(
        t('storyChunkEditor.success.chunkAdded', 'Chunk #{{index}} added successfully ({{bytes}} bytes)', {
          index: result.events.StoryChunkAdded.chunkIndex,
          bytes: result.events.StoryChunkAdded.contentLength
        })
      )
    } else {
      toast.success(t('storyChunkEditor.success.chunkAddedGeneric', 'Story chunk added successfully'))
    }
  }, [contractAddress, signer, address, toast, t, chunks, meta, validTokenId, setNodesData])

  const onUpdateChunk = useCallback(async (data: StoryChunkUpdateData) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    // 执行区块链操作
    const result = await updateStoryChunk(
      signer,
      contractAddress,
      data.tokenId,
      data.chunkIndex,
      data.newContent,
      data.expectedHash || ''
    )

    // After successful operation, immediately update local state and replace chunk at corresponding index
    const newChunks = chunks ? [...chunks] : []
    const index = newChunks.findIndex(c => c.chunkIndex === data.chunkIndex)
    if (index !== -1) {
      newChunks[index] = result.updatedChunk
    }
    setChunks(newChunks)

    // Update last update time in metadata
    const newMeta: StoryMetadata | undefined = meta ? {
      ...meta,
      lastUpdateTime: result.updatedChunk.timestamp
    } : undefined
    setMeta(newMeta)

    // Synchronize updates to TreeDataContext node data cache
    if (setNodesData && validTokenId) {
      setNodesData(prev => {
        let foundId: string | undefined
        for (const [id, nd] of Object.entries(prev)) {
          if (nd.tokenId && String(nd.tokenId) === String(validTokenId)) {
            foundId = id
            break
          }
        }
        if (!foundId) return prev

        const cur = prev[foundId]
        return {
          ...prev,
          [foundId]: {
            ...cur,
            storyMetadata: newMeta,
            storyChunks: newChunks
          }
        }
      })
    }

    // Show success message with event data if available
    if (result.events.StoryChunkUpdated) {
      toast.success(
        t('storyChunkEditor.success.chunkUpdated', 'Chunk #{{index}} updated successfully', {
          index: result.events.StoryChunkUpdated.chunkIndex
        })
      )
    } else {
      toast.success(t('storyChunkEditor.success.chunkUpdatedGeneric', 'Story chunk updated successfully'))
    }
  }, [contractAddress, signer, address, toast, t, chunks, meta, validTokenId, setNodesData])

  const onSealStory = useCallback(async (tid: string) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    // Execute blockchain operation
    const result = await sealStory(signer, contractAddress, tid)

    // After successful operation, immediately update sealed status in metadata
    const newMeta: StoryMetadata | undefined = meta ? {
      ...meta,
      isSealed: true,
      totalChunks: result.totalChunks
    } : undefined
    setMeta(newMeta)

    // Synchronize updates to TreeDataContext node data cache
    if (setNodesData && validTokenId) {
      setNodesData(prev => {
        let foundId: string | undefined
        for (const [id, nd] of Object.entries(prev)) {
          if (nd.tokenId && String(nd.tokenId) === String(validTokenId)) {
            foundId = id
            break
          }
        }
        if (!foundId) return prev

        const cur = prev[foundId]
        return {
          ...prev,
          [foundId]: {
            ...cur,
            storyMetadata: newMeta
          }
        }
      })
    }

    // Show success message with event data if available
    if (result.events.StorySealed) {
      toast.success(
        t('storyChunkEditor.success.storySealed', 'Story sealed successfully ({{total}} chunks)', {
          total: result.events.StorySealed.totalChunks
        })
      )
    } else {
      toast.success(t('storyChunkEditor.success.storySealedGeneric', 'Story sealed successfully'))
    }
  }, [contractAddress, signer, address, toast, t, meta, validTokenId, setNodesData])

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowLeaveConfirm(true)
      return
    }
    // If the tab has history, go back; otherwise try to close the tab.
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    try {
      window.close()
    } catch {}
    // Fallback: navigate to person page or home if the tab couldn't be closed
    if (validTokenId) {
      navigate(`/person/${validTokenId}`, { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [dirty, navigate, validTokenId])

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false)
    // If the tab has history, go back; otherwise try to close the tab.
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    try {
      window.close()
    } catch {}
    // Fallback: navigate to person page or home if the tab couldn't be closed
    if (validTokenId) {
      navigate(`/person/${validTokenId}`, { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [navigate, validTokenId])

  const handleCancelLeave = useCallback(() => {
    setShowLeaveConfirm(false)
  }, [])

  return (
    <>
      <StoryChunkEditor
        layout="page"
        open={true}
        onClose={handleClose}
        tokenId={validTokenId}
        storyMetadata={meta}
        storyChunks={chunks}
        loading={loading}
        error={error || undefined}
        onDirtyChange={setDirty}
        onAddChunk={onAddChunk}
        onUpdateChunk={onUpdateChunk}
        onSealStory={onSealStory}
      />
      <ConfirmDialog
        open={showLeaveConfirm}
        title={t('storyChunkEditor.leaveConfirmTitle', 'Leave Editor')}
        message={t('storyChunkEditor.leaveConfirm', 'Unsaved changes will be lost. Leave editor?')}
        confirmText={t('storyChunkEditor.leaveConfirmButton', 'Leave')}
        cancelText={t('common.cancel', 'Cancel')}
        onConfirm={handleConfirmLeave}
        onCancel={handleCancelLeave}
        type="danger"
      />
    </>
  )
}
