import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { X, Plus, Edit2, Save, Lock, Clipboard, ChevronDown, ChevronRight, Clock, Hash } from 'lucide-react'
import { useConfig } from '../context/ConfigContext'
import { useTreeData } from '../context/TreeDataContext'
import { useWallet } from '../context/WalletContext'
import { useToast } from '../components/ToastProvider'
import { addStoryChunk, updateStoryChunk, sealStory } from '../lib/story'
import type { StoryChunk, StoryChunkCreateData, StoryChunkUpdateData, StoryMetadata, NodeData } from '../types/graph'
import { formatUnixSeconds, formatHashMiddle } from '../types/graph'

interface PrefetchedState {
  prefetchedStory?: {
    tokenId: string
    fullName?: string
    storyMetadata?: StoryMetadata
    storyChunks?: StoryChunk[]
  }
}

interface ChunkFormData {
  content: string
  expectedHash?: string
}

export default function StoryEditorPage() {
  const { tokenId } = useParams<{ tokenId: string }>()
  const location = useLocation()
  const { t } = useTranslation()
  const { contractAddress, strictCacheOnly } = useConfig()
  const { getStoryData, setNodesData, getNodeByTokenId } = useTreeData()
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

  // Editor state
  const [editingChunkIndex, setEditingChunkIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState<ChunkFormData>({ content: '' })
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showSealConfirm, setShowSealConfirm] = useState(false)
  const [editSessionId, setEditSessionId] = useState(0)
  const [initialEditContent, setInitialEditContent] = useState<string>('')
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const [personName, setPersonName] = useState<string | null>(prefetched?.fullName || null)
  const [nodeDetails, setNodeDetails] = useState<NodeData | null>(null)

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const validTokenId = useMemo(() => tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined, [tokenId])

  // Helper function to compute fullStoryHash from chunks (matches contract's _updateFullStoryHash logic)
  const computeFullStoryHash = useCallback((chunkList: StoryChunk[]): string => {
    if (!chunkList || chunkList.length === 0) {
      return ethers.ZeroHash
    }
    // Sort by chunkIndex and concatenate all chunkHash values
    const sorted = [...chunkList].sort((a, b) => a.chunkIndex - b.chunkIndex)
    const concatenated = '0x' + sorted.map(c => c.chunkHash.replace(/^0x/, '')).join('')
    return ethers.keccak256(concatenated)
  }, [])

  const computeContentHash = useCallback((content: string): string => {
    // Use encodePacked to match the contract's _hashString function
    return ethers.keccak256(ethers.toUtf8Bytes(content))
  }, [])

  const formatHash = useCallback((hash?: string) => formatHashMiddle(hash), [])

  const getByteLength = useCallback((str: string) => new TextEncoder().encode(str).length, [])

  const copyText = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        toast.show(t('search.copied'))
        return
      }
    } catch {}
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      toast.show(ok ? t('search.copied') : t('search.copyFailed'))
    } catch {
      toast.show(t('search.copyFailed'))
    }
  }, [toast, t])

  const scrollToForm = useCallback(() => {
    const doScroll = () => {
      if (scrollContainerRef.current) {
        try { scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' }) } catch {}
      }
      if (formRef.current) {
        try { formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch {}
      }
      if (textareaRef.current) {
        try { textareaRef.current.focus({ preventScroll: true }) } catch {}
      }
    }
    requestAnimationFrame(() => {
      doScroll()
      requestAnimationFrame(() => {
        doScroll()
        setTimeout(doScroll, 60)
      })
    })
  }, [])

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
  }, [validTokenId, getStoryData, meta, chunks, t, strictCacheOnly])

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

  // Dirty detection: changed content vs initial
  const isDirty = useMemo(() => {
    const trimmed = (formData.content || '').trim()
    if (editingChunkIndex === null) {
      return trimmed.length > 0
    }
    return trimmed !== (initialEditContent || '').trim()
  }, [formData.content, editingChunkIndex, initialEditContent])

  useEffect(() => { setDirty(isDirty) }, [isDirty])

  const sortedChunks = useMemo(() => {
    return [...(chunks || [])].sort((a, b) => a.chunkIndex - b.chunkIndex)
  }, [chunks])

  const isSealed = meta?.isSealed || false

  const handleStartEdit = useCallback((chunkIndex: number | null, initialContent = '') => {
    setEditingChunkIndex(chunkIndex)
    setFormData({
      content: initialContent,
      expectedHash: initialContent ? computeContentHash(initialContent) : undefined
    })
    setInitialEditContent(initialContent)
    setLocalError(null)
    setEditSessionId(id => id + 1)
    scrollToForm()
  }, [computeContentHash, scrollToForm])

  const handleCancelEdit = useCallback(() => {
    setEditingChunkIndex(null)
    setFormData({ content: '' })
    setLocalError(null)
  }, [])

  const toggleChunkExpansion = useCallback((chunkIndex: number) => {
    setExpandedChunks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(chunkIndex)) {
        newSet.delete(chunkIndex)
      } else {
        newSet.add(chunkIndex)
      }
      return newSet
    })
  }, [])

  const onAddChunk = useCallback(async (data: StoryChunkCreateData) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    try {
      // Execute blockchain operation
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

      // Update total chunks count and fullStoryHash in metadata
      const newFullStoryHash = computeFullStoryHash(newChunks)
      const newMeta: StoryMetadata | undefined = meta ? {
        ...meta,
        totalChunks: (meta.totalChunks || 0) + 1,
        lastUpdateTime: result.newChunk.timestamp,
        totalLength: (meta.totalLength || 0) + result.contentLength,
        fullStoryHash: newFullStoryHash
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
    } catch (err) {
      const message = err instanceof Error ? err.message : t('storyChunkEditor.operationFailed', 'Operation failed')
      toast.error(message)
      throw err
    }
  }, [contractAddress, signer, address, toast, t, chunks, meta, validTokenId, setNodesData, computeFullStoryHash])

  const onUpdateChunk = useCallback(async (data: StoryChunkUpdateData) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    try {
      // Execute blockchain operation
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

      // Update last update time and fullStoryHash in metadata
      const newFullStoryHash = computeFullStoryHash(newChunks)
      const newMeta: StoryMetadata | undefined = meta ? {
        ...meta,
        lastUpdateTime: result.updatedChunk.timestamp,
        fullStoryHash: newFullStoryHash
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
    } catch (err) {
      const message = err instanceof Error ? err.message : t('storyChunkEditor.operationFailed', 'Operation failed')
      toast.error(message)
      throw err
    }
  }, [contractAddress, signer, address, toast, t, chunks, meta, validTokenId, setNodesData, computeFullStoryHash])

  const onSealStory = useCallback(async (tid: string) => {
    if (!contractAddress) throw new Error('Missing contract')
    if (!signer) throw new Error('No wallet connected')
    if (!address) throw new Error('No wallet address')

    try {
      // Execute blockchain operation
      const result = await sealStory(signer, contractAddress, tid)

      // After successful operation, immediately update sealed status and fullStoryHash in metadata
      const newMeta: StoryMetadata | undefined = meta ? {
        ...meta,
        isSealed: true,
        totalChunks: result.totalChunks,
        fullStoryHash: result.fullStoryHash
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
    } catch (err) {
      const message = err instanceof Error ? err.message : t('storyChunkEditor.operationFailed', 'Operation failed')
      toast.error(message)
      throw err
    }
  }, [contractAddress, signer, address, toast, t, meta, validTokenId, setNodesData])

  const handleSubmit = useCallback(async () => {
    if (!validTokenId) return

    const trimmedContent = formData.content.trim()
    if (!trimmedContent) {
      setLocalError(t('storyChunkEditor.contentRequired', 'Content cannot be empty'))
      return
    }
    const byteLen = getByteLength(trimmedContent)
    if (byteLen > 1000) {
      setLocalError(t('storyChunkEditor.contentTooLongBytes', 'Content cannot exceed 1000 bytes'))
      return
    }

    setSubmitting(true)
    setLocalError(null)

    try {
      const expectedHash = computeContentHash(trimmedContent)

      if (editingChunkIndex === null) {
        const nextIndex = meta?.totalChunks || 0
        await onAddChunk({
          tokenId: validTokenId,
          chunkIndex: nextIndex,
          content: trimmedContent,
          expectedHash,
        })
      } else {
        await onUpdateChunk({
          tokenId: validTokenId,
          chunkIndex: editingChunkIndex,
          newContent: trimmedContent,
          expectedHash,
        })
      }

      handleCancelEdit()
    } catch (err: any) {
      const errorType = err?.type || err?.code
      let message = err instanceof Error ? err.message : t('storyChunkEditor.operationFailed', 'Operation failed')

      if (errorType === 'USER_REJECTED') {
        message = t('storyChunkEditor.errors.userRejected', 'Transaction was rejected by user')
      } else if (errorType === 'WALLET_POPUP_TIMEOUT') {
        message = t('storyChunkEditor.errors.walletTimeout', 'Wallet confirmation timed out. Please reopen your wallet and confirm in Fluent.')
      } else if (errorType === 'WALLET_REQUEST_PENDING') {
        message = t('storyChunkEditor.errors.walletPending', 'Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.')
      }

      setLocalError(message)
    } finally {
      setSubmitting(false)
    }
  }, [validTokenId, formData.content, getByteLength, computeContentHash, editingChunkIndex, meta, onAddChunk, onUpdateChunk, handleCancelEdit, t])

  const handleSeal = useCallback(async () => {
    if (!validTokenId) return
    setShowSealConfirm(true)
  }, [validTokenId])

  const executeSeal = useCallback(async () => {
    if (!validTokenId) return
    setSubmitting(true)
    setLocalError(null)
    try {
      await onSealStory(validTokenId)
      setShowSealConfirm(false)
    } catch (err: any) {
      const errorMessage = err?.message || String(err)
      const errorType = err?.type || err?.code
      let translatedError: string

      // Check for specific error patterns
      if (errorMessage.toLowerCase().includes('no wallet connected') || errorType === 'NO_WALLET') {
        translatedError = t('storyChunkEditor.errors.noWallet', 'No wallet connected. Please connect your wallet first.')
      } else if (errorType === 'USER_REJECTED') {
        translatedError = t('storyChunkEditor.errors.userRejected', 'Transaction was rejected by user')
      } else if (errorType === 'WALLET_POPUP_TIMEOUT') {
        translatedError = t('storyChunkEditor.errors.walletTimeout', 'Wallet confirmation timed out. Please reopen your wallet and confirm.')
      } else if (errorType === 'WALLET_REQUEST_PENDING') {
        translatedError = t('storyChunkEditor.errors.walletPending', 'Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.')
      } else {
        translatedError = err instanceof Error ? err.message : t('storyChunkEditor.sealFailed', 'Seal failed')
      }

      setLocalError(translatedError)
      setShowSealConfirm(false)
    } finally {
      setSubmitting(false)
    }
  }, [validTokenId, onSealStory, t])

  useEffect(() => {
    if (editSessionId > 0) {
      scrollToForm()
    }
  }, [editSessionId, scrollToForm])

  const getByteWarningColor = (byteLen: number) => {
    if (byteLen > 1000) return 'text-red-600 dark:text-red-400 font-semibold'
    if (byteLen > 900) return 'text-orange-600 dark:text-orange-400 font-medium'
    if (byteLen > 800) return 'text-yellow-600 dark:text-yellow-500'
    return 'text-gray-500 dark:text-gray-400'
  }

  useEffect(() => {
    if (prefetched?.fullName) {
      setPersonName(prefetched.fullName)
    }
  }, [prefetched?.fullName])

  useEffect(() => {
    if (!validTokenId) return
    let cancelled = false
    ;(async () => {
      try {
        const node = await getNodeByTokenId(validTokenId)
        if (cancelled) return
        setNodeDetails(node || null)
        if (node?.fullName) {
          setPersonName(node.fullName)
        }
      } catch {
        if (!cancelled) setNodeDetails(null)
      }
    })()
    return () => { cancelled = true }
  }, [validTokenId, getNodeByTokenId])

  const titleText = personName
    ? t('storyChunkEditor.titleWithName', { name: personName, defaultValue: '{{name}} Biography' })
    : t('storyChunkEditor.titleFallback', { defaultValue: 'Biography' })

  const metadataItems = useMemo(() => {
    if (!meta) return []
    return [
      {
        key: 'chunks',
        label: t('storyChunkEditor.chunks', 'Chunks'),
        value: meta.totalChunks ?? 0,
        mono: true,
      },
      {
        key: 'length',
        label: t('storyChunkEditor.totalLength', 'Length'),
        value: meta.totalLength ?? 0,
        mono: true,
      },
    ]
  }, [meta, t])

  const showEditorForm = editingChunkIndex !== null || !isSealed
  const showError = Boolean(error || localError)
  const showEmptySealed = !loading && sortedChunks.length === 0 && !showError && isSealed
  const errorMessage = error || localError

  return (
    <>
      <main data-story-editor-page className="mx-auto w-full max-w-7xl">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
          <section className="xl:col-span-3 flex flex-col">
            <header className="rounded-t-lg border border-b-0 border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {titleText}
                    {isSealed && <Lock className="text-gray-500 dark:text-gray-400" size={16} />}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {meta?.isSealed && (
                    <div className="text-xs px-2 py-0.5 rounded font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {t('person.sealed', 'Sealed')}
                    </div>
                  )}
                  {!isSealed && meta && meta.totalChunks > 0 && (
                    <button
                      onClick={handleSeal}
                      disabled={submitting}
                      className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      type="button"
                    >
                      <Lock size={12} />
                      {t('storyChunkEditor.seal', 'Seal Story')}
                    </button>
                  )}
                </div>
              </div>
            </header>

            <div ref={scrollContainerRef} className="flex flex-col gap-4 rounded-b-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
                {showError && (
                  <section className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/30 dark:text-red-400">
                    <p className="mb-1 font-semibold text-red-800 dark:text-red-300">{t('common.error', 'Error')}</p>
                    <p>{errorMessage}</p>
                  </section>
                )}

                {showEditorForm && (
                  <section ref={formRef} className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-800">
                    <header className="flex items-center justify-between border-b border-gray-200 pb-3 dark:border-gray-700">
                      <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                        {editingChunkIndex !== null ? (
                          <>
                            <Edit2 size={16} className="text-blue-600 dark:text-blue-400" />
                            {t('storyChunkEditor.editChunk', 'Edit Chunk')} #{editingChunkIndex}
                          </>
                        ) : (
                          <>
                            <Plus size={16} className="text-gray-600 dark:text-gray-400" />
                            {t('storyChunkEditor.addChunk', 'Add New Chunk')}
                          </>
                        )}
                      </h3>
                      {editingChunkIndex !== null && (
                        <button
                          onClick={handleCancelEdit}
                          disabled={submitting}
                          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                          aria-label={t('common.close', 'Close') as string}
                          type="button"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </header>

                    <div className="space-y-3">
                      <textarea
                        ref={textareaRef}
                        value={formData.content}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          content: e.target.value,
                          expectedHash: e.target.value ? computeContentHash(e.target.value) : undefined
                        }))}
                        placeholder={t('storyChunkEditor.contentPlaceholderBytes', 'Enter chunk content (max 1000 bytes, approximately 1000 English characters or ~333 Chinese characters)')}
                        className="h-[500px] w-full resize-none rounded border border-gray-300 bg-white p-3 text-sm leading-relaxed text-gray-900 transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
                        disabled={submitting}
                      />

                      <div className="flex flex-col justify-between gap-3 text-sm sm:flex-row sm:items-center">
                        <div className={`font-medium ${getByteWarningColor(getByteLength(formData.content))}`}>
                          {getByteLength(formData.content)}/1000 bytes
                          {getByteLength(formData.content) > 900 && getByteLength(formData.content) <= 1000 && (
                            <span className="ml-2 text-xs">({1000 - getByteLength(formData.content)} remaining)</span>
                          )}
                          {getByteLength(formData.content) > 1000 && (
                            <span className="ml-2 text-xs">({getByteLength(formData.content) - 1000} over limit!)</span>
                          )}
                        </div>

                        {formData.expectedHash && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">{t('storyChunkEditor.hashLabel','Hash')}:</span>
                            <code className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                              {formatHash(formData.expectedHash)}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyText(formData.expectedHash || '')}
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                              aria-label={t('search.copy', 'Copy') as string}
                            >
                              <Clipboard size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <footer className="flex flex-col gap-2 pt-2 sm:flex-row">
                      <button
                        onClick={handleSubmit}
                        disabled={submitting || !formData.content.trim() || getByteLength(formData.content) > 1000}
                        className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                      >
                        <Save size={16} />
                        {submitting ? t('storyChunkEditor.saving', 'Saving...') : t('storyChunkEditor.save', 'Save Chunk')}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={submitting}
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        type="button"
                      >
                        {t('storyChunkEditor.cancel', 'Cancel')}
                      </button>
                    </footer>
                  </section>
                )}

                {loading && (
                  <section className="flex flex-col items-center justify-center gap-4 py-12 text-gray-500 dark:text-gray-400">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400"></div>
                    <p className="text-sm font-medium">{t('storyChunkEditor.loading', 'Loading...')}</p>
                  </section>
                )}

                {showEmptySealed && (
                  <section className="py-12 text-center text-gray-500 dark:text-gray-400">
                    <Lock size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-sm font-medium">{t('storyChunkEditor.noChunksSealed', 'This story is sealed with no chunks.')}</p>
                  </section>
                )}
            </div>
          </section>
          <aside className="xl:col-span-1 flex flex-col gap-4">
            {sortedChunks.length > 0 ? (
              <section className="flex flex-col flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <header className="flex items-center justify-between border-b border-gray-200 px-4 pt-5 pb-3 dark:border-gray-800">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {t('storyChunkEditor.chunks', 'Existing Chunks')}
                  </h3>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {sortedChunks.length}
                  </span>
                </header>
                <ul className="max-h-[500px] overflow-y-auto pb-2">
                  {sortedChunks.map((chunk) => {
                    const isExpanded = expandedChunks.has(chunk.chunkIndex)
                    const preview = chunk.content.length > 60 ? `${chunk.content.slice(0, 60)}...` : chunk.content
                    return (
                      <li key={chunk.chunkIndex} className="border-b border-gray-200 dark:border-gray-800 last:border-b-0">
                        <div className="w-full text-left flex items-start gap-2 p-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleChunkExpansion(chunk.chunkIndex)
                            }}
                            className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            type="button"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div 
                            className="flex-1 min-w-0 cursor-pointer" 
                            onClick={() => toggleChunkExpansion(chunk.chunkIndex)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">#{chunk.chunkIndex}</span>
                              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <span className="text-xs text-gray-400 dark:text-gray-500">{chunk.content.length}</span>
                                {!isSealed && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleStartEdit(chunk.chunkIndex, chunk.content)
                                    }}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                                    disabled={submitting}
                                    aria-label={t('storyChunkEditor.editChunk')}
                                    title={t('storyChunkEditor.editChunk')}
                                    type="button"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className={`text-xs text-gray-600 dark:text-gray-400 ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                              {isExpanded ? chunk.content : preview}
                            </p>
                            {isExpanded && (
                              <div className="space-y-2 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                  <Clock size={12} />
                                  {formatUnixSeconds(chunk.timestamp)}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                                  <Hash size={12} className="flex-shrink-0" />
                                  <span className="font-mono truncate" title={chunk.chunkHash}>{formatHash(chunk.chunkHash)}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      copyText(chunk.chunkHash)
                                    }}
                                    className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                    aria-label={t('search.copy')}
                                    title={t('search.copy')}
                                    type="button"
                                  >
                                    <Clipboard size={12} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : (
              <div className="overflow-hidden rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
                {t('storyChunkEditor.noChunks', 'No story chunks yet.')}
              </div>
            )}

            {meta && (
              <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <header className="border-b border-gray-200 px-4 pt-5 pb-3 dark:border-gray-800">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {t('person.metadata', 'Metadata')}
                  </h3>
                </header>
                <div className="p-4 space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.tokenId', 'Token ID')}</span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">#{validTokenId || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.totalChunks', 'Total Chunks')}</span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{meta.totalChunks}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.totalLength', 'Total Length')}</span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{meta.totalLength}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.lastUpdate', 'Last Update')}</span>
                    <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                      {meta.lastUpdateTime ? formatUnixSeconds(meta.lastUpdateTime) : t('common.na', 'N/A')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.status', 'Status')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${meta.isSealed ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                      {meta.isSealed ? t('person.sealed', 'Sealed') : t('person.editable', 'Editable')}
                    </span>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.storyHash', 'Story Hash')}</div>
                    <div className="flex items-center">
                      <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                        {meta.fullStoryHash || '-'}
                      </div>
                      {meta.fullStoryHash && (
                        <button
                          onClick={() => copyText(meta.fullStoryHash!)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t('search.copy') as string}
                          title={t('search.copy') as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  {nodeDetails?.personHash && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.personHashLabel', 'Person Hash')}</div>
                      <div className="flex items-center">
                        <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                          {nodeDetails.personHash}
                        </div>
                        <button
                          onClick={() => copyText(nodeDetails.personHash!)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t('search.copy') as string}
                          title={t('search.copy') as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                  {nodeDetails?.versionIndex !== undefined && nodeDetails.versionIndex > 0 && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.versionLabel', 'Version:')}</div>
                      <div className="flex items-center">
                        <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                          {nodeDetails.versionIndex}
                        </div>
                        <button
                          onClick={() => copyText(`${nodeDetails.versionIndex}`)}
                          className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          aria-label={t('search.copy') as string}
                          title={t('search.copy') as string}
                          type="button"
                        >
                          <Clipboard size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>

      {/* Seal Confirmation Dialog */}
      {showSealConfirm && createPortal(
        <div className="fixed inset-0 z-[1002] flex items-center justify-center p-4" data-seal-dialog>
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-800">
            <div className="p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                  <Lock size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    {t('storyChunkEditor.sealDialog.title', 'Seal Story')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {t('storyChunkEditor.sealDialog.description', 'Are you sure you want to seal the story? Once sealed, it cannot be modified.')}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowSealConfirm(false)}
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md disabled:opacity-50 transition-colors"
                >
                  {t('storyChunkEditor.sealDialog.cancel', 'Cancel')}
                </button>
                <button
                  onClick={executeSeal}
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>{t('storyChunkEditor.saving', 'Saving...')}</span>
                    </>
                  ) : (
                    <>
                      <Lock size={16} />
                      <span>{t('storyChunkEditor.sealDialog.confirm', 'Confirm Seal')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
