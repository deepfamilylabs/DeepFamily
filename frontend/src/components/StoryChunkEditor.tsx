import React from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Edit2, Save, Lock, Clipboard, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { StoryChunk, StoryMetadata, StoryChunkCreateData, StoryChunkUpdateData, formatUnixSeconds, formatHashMiddle } from '../types/graph'

interface StoryChunkEditorProps {
  open: boolean
  onClose: () => void
  tokenId?: string
  storyMetadata?: StoryMetadata
  storyChunks?: StoryChunk[]
  loading?: boolean
  error?: string | null
  onAddChunk?: (data: StoryChunkCreateData) => Promise<void>
  onUpdateChunk?: (data: StoryChunkUpdateData) => Promise<void>
  onSealStory?: (tokenId: string) => Promise<void>
  layout?: 'modal' | 'page'
  onDirtyChange?: (dirty: boolean) => void
}

interface ChunkFormData {
  content: string
  expectedHash?: string
}

export default function StoryChunkEditor({
  open,
  onClose,
  tokenId,
  storyMetadata,
  storyChunks = [],
  loading = false,
  error,
  onAddChunk,
  onUpdateChunk,
  onSealStory,
  layout = 'modal',
  onDirtyChange,
}: StoryChunkEditorProps) {
  const { t } = useTranslation()
  const [editingChunkIndex, setEditingChunkIndex] = React.useState<number | null>(null)
  const [formData, setFormData] = React.useState<ChunkFormData>({ content: '' })
  const [submitting, setSubmitting] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const [showSealConfirm, setShowSealConfirm] = React.useState(false)
  const [skipSealConfirm, setSkipSealConfirm] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('skipSealConfirm') === '1'
    return false
  })
  const [editSessionId, setEditSessionId] = React.useState(0)
  const [initialEditContent, setInitialEditContent] = React.useState<string>('')
  const [copyHint, setCopyHint] = React.useState<string | null>(null)
  const [expandedChunks, setExpandedChunks] = React.useState<Set<number>>(new Set())
  const [scrollContainerRef, formRef, textareaRef] = [React.useRef<HTMLDivElement | null>(null), React.useRef<HTMLDivElement | null>(null), React.useRef<HTMLTextAreaElement | null>(null)]
  const scrollToForm = React.useCallback(() => {
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
  
  const copyText = React.useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        return true
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
      return ok
    } catch {
      return false
    }
  }, [])
  
  const onCopyHash = async (text: string) => {
    const ok = await copyText(text)
    setCopyHint(ok ? t('search.copied', 'Copied') : t('search.copyFailed', 'Copy failed'))
    window.setTimeout(() => setCopyHint(null), 1200)
  }
  
  const computeContentHash = (content: string): string => {
    // Use encodePacked to match the contract's _hashString function
    return ethers.keccak256(ethers.toUtf8Bytes(content))
  }

  // Format hash (middle ellipsis)
  const formatHash = React.useCallback((hash?: string) => formatHashMiddle(hash), [])
  
  // Dirty detection: changed content vs initial
  const dirty = React.useMemo(() => {
    const trimmed = (formData.content || '').trim()
    if (editingChunkIndex === null) {
      return trimmed.length > 0
    }
    return trimmed !== (initialEditContent || '').trim()
  }, [formData.content, editingChunkIndex, initialEditContent])

  React.useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const sortedChunks = React.useMemo(() => {
    return [...storyChunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  }, [storyChunks])
  
  const handleStartEdit = (chunkIndex: number | null, initialContent = '') => {
    setEditingChunkIndex(chunkIndex)
    setFormData({ 
      content: initialContent,
      expectedHash: initialContent ? computeContentHash(initialContent) : undefined
    })
    setInitialEditContent(initialContent)
    setLocalError(null)
    setEditSessionId(id => id + 1)
    scrollToForm()
  }
  
  const handleCancelEdit = () => {
    setEditingChunkIndex(null)
    setFormData({ content: '' })
    setLocalError(null)
  }

  const toggleChunkExpansion = (chunkIndex: number) => {
    setExpandedChunks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(chunkIndex)) {
        newSet.delete(chunkIndex)
      } else {
        newSet.add(chunkIndex)
      }
      return newSet
    })
  }

  const getByteLength = React.useCallback((str: string) => new TextEncoder().encode(str).length, [])
  
  const handleSubmit = async () => {
    if (!tokenId || !onAddChunk || !onUpdateChunk) return
    
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
        const nextIndex = storyMetadata?.totalChunks || 0
        await onAddChunk({
          tokenId,
          chunkIndex: nextIndex,
          content: trimmedContent,
          expectedHash,
        })
      } else {
        await onUpdateChunk({
          tokenId,
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
  }
  
  const handleSeal = async () => {
    if (!tokenId || !onSealStory) return
    if (skipSealConfirm) {
      await executeSeal()
    } else {
      setShowSealConfirm(true)
    }
  }
  const executeSeal = async () => {
    if (!tokenId || !onSealStory) return
    setSubmitting(true)
    try {
      await onSealStory(tokenId)
      setShowSealConfirm(false)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('storyChunkEditor.sealFailed', 'Seal failed'))
    } finally {
      setSubmitting(false)
    }
  }
  
  const isSealed = storyMetadata?.isSealed || false
  React.useEffect(() => {
    if (!open) return
    if (editSessionId > 0) {
      scrollToForm()
    }
  }, [editSessionId, open, scrollToForm])

  // Do not auto-focus form on initial open for page layout; keep at top

  if (!open) return null

  const getByteWarningColor = (byteLen: number) => {
    if (byteLen > 1000) return 'text-red-600 dark:text-red-400 font-semibold'
    if (byteLen > 900) return 'text-orange-600 dark:text-orange-400 font-medium'
    if (byteLen > 800) return 'text-yellow-600 dark:text-yellow-500'
    return 'text-gray-500 dark:text-gray-400'
  }

  const Card = (
      <div className={`relative bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-3xl w-full ${layout === 'page' ? 'max-w-4xl' : 'max-w-[900px] max-h-[90vh]'} overflow-hidden flex flex-col border border-gray-200/70 dark:border-gray-700/50 backdrop-blur-xl`}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200/70 dark:border-gray-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/30 dark:from-blue-900/20 dark:to-purple-900/15 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            {layout === 'page' && (
              <button
                aria-label={t('common.back', 'Back') as string}
                className="hidden sm:inline-flex p-2 rounded-xl hover:bg-white/30 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300 transition-all duration-200 hover:scale-105"
                onClick={onClose}
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent truncate">
              {t('storyChunkEditor.title', 'Story Chunk Editor')}
              {isSealed && <Lock className="inline ml-2 text-gray-500 dark:text-gray-400" size={16} />}
            </div>
          </div>
          {layout === 'modal' ? (
            <button
              aria-label={t('common.close', 'Close') as string}
              className="p-2 rounded-xl hover:bg-white/30 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300 transition-all duration-200 hover:scale-105"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          ) : (
            // In page layout, show a mobile-only Close (X) on the right
            <button
              aria-label={t('common.close', 'Close') as string}
              className="sm:hidden p-2 rounded-xl hover:bg-white/30 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300 transition-all duration-200 hover:scale-105"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          )}
        </div>
        
        {storyMetadata && (
          <div className="px-4 sm:px-6 py-3 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/60 dark:to-gray-800/40 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {t('storyChunkEditor.chunks', 'Chunks')}:
                  </span>
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-md font-semibold text-sm">
                    {storyMetadata.totalChunks}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {t('storyChunkEditor.totalLength', 'Length')}:
                  </span>
                  <span className="text-gray-600 dark:text-gray-400 font-mono text-sm">
                    {storyMetadata.totalLength}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {isSealed && (
                  <span className="px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 rounded-lg text-xs font-medium flex items-center gap-1.5">
                    <Lock size={12} />
                    {t('storyChunkEditor.sealed', 'Sealed')}
                  </span>
                )}
                {!isSealed && storyMetadata.totalChunks > 0 && (
                  <button
                    onClick={handleSeal}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors shadow-sm hover:shadow"
                  >
                    <Lock size={12} />
                    {t('storyChunkEditor.seal', 'Seal Story')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {copyHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
            <div className="rounded bg-black/80 dark:bg-black/70 text-white px-3 py-1.5 text-xs animate-fade-in">{copyHint}</div>
          </div>
        )}
        
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gradient-to-b from-white/60 via-blue-50/20 to-purple-50/10 dark:from-transparent dark:via-blue-900/5 dark:to-purple-900/5">
          {(error || localError) && (
            <div className="bg-red-50 dark:bg-red-500/10 border-l-4 border-red-500 dark:border-red-400 rounded-lg p-4 text-red-800 dark:text-red-300 text-sm shadow-sm animate-in slide-in-from-top-2 duration-300">
              <div className="font-medium mb-1">Error</div>
              <div>{error || localError}</div>
            </div>
          )}
          
          {editingChunkIndex !== null || (editingChunkIndex === null && !isSealed) ? (
            <div ref={formRef} className="bg-white dark:bg-gray-800 rounded-2xl p-5 sm:p-6 space-y-5 border border-gray-200 dark:border-gray-700 shadow-xl animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  {editingChunkIndex !== null ? (
                    <>
                      <Edit2 size={18} className="text-blue-600 dark:text-blue-400" />
                      {t('storyChunkEditor.editChunk', 'Edit Chunk #{{index}}', { index: editingChunkIndex })}
                    </>
                  ) : (
                    <>
                      <Plus size={18} className="text-green-600 dark:text-green-400" />
                      {t('storyChunkEditor.addChunk', 'Add New Chunk')}
                    </>
                  )}
                </h3>
                {editingChunkIndex !== null && (
                  <button
                    onClick={handleCancelEdit}
                    disabled={submitting}
                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={t('common.close', 'Close') as string}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              
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
                  className="w-full h-40 sm:h-48 p-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all duration-200 text-base leading-relaxed"
                  disabled={submitting}
                />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
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
                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('storyChunkEditor.hashLabel','Hash')}:</span>
                      <code className="font-mono text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">
                        {formatHash(formData.expectedHash)}
                      </code>
                      <button
                        type="button"
                        onClick={() => onCopyHash(formData.expectedHash || '')}
                        className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all"
                        aria-label={t('search.copy', 'Copy') as string}
                      >
                        <Clipboard size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !formData.content.trim() || getByteLength(formData.content) > 1000}
                  className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all duration-200 disabled:hover:shadow-md"
                >
                  <Save size={18} />
                  {submitting ? t('storyChunkEditor.saving', 'Saving...') : t('storyChunkEditor.save', 'Save Chunk')}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={submitting}
                  className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  {t('storyChunkEditor.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          ) : null}
          
          {!isSealed && editingChunkIndex === null && (
            <button
              onClick={() => handleStartEdit(null)}
              className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:border-blue-500 hover:text-blue-600 dark:hover:border-blue-400 dark:hover:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 flex items-center justify-center gap-2 transition-all duration-200 font-medium"
            >
              <Plus size={22} />
              {t('storyChunkEditor.addNewChunk', 'Add New Chunk')}
            </button>
          )}
          
          {sortedChunks.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  {t('storyChunkEditor.chunks', 'Existing Chunks')}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                    ({sortedChunks.length})
                  </span>
                </h3>
              </div>

              <div className="space-y-3">
                {sortedChunks.map((chunk) => {
                  const isExpanded = expandedChunks.has(chunk.chunkIndex)
                  const contentPreview = chunk.content.length > 150 ? chunk.content.substring(0, 150) + '...' : chunk.content
                  const needsExpansion = chunk.content.length > 150

                  return (
                    <div
                      key={chunk.chunkIndex}
                      className="group border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:shadow-lg transition-all duration-200 overflow-hidden"
                    >
                      <div className="p-4 space-y-3">
                        {/* Header */}
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-2.5 py-1 bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-500/20 dark:to-purple-500/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-bold">
                                #{chunk.chunkIndex}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                {formatUnixSeconds(chunk.timestamp)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <span className="font-medium">{t('storyChunkEditor.hashLabel','Hash')}:</span>
                              <code className="font-mono px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300">
                                {formatHash(chunk.chunkHash)}
                              </code>
                              <button
                                type="button"
                                onClick={() => onCopyHash(chunk.chunkHash)}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                aria-label={t('search.copy', 'Copy') as string}
                              >
                                <Clipboard size={12} />
                              </button>
                            </div>
                          </div>

                          {!isSealed && (
                            <button
                              onClick={() => handleStartEdit(chunk.chunkIndex, chunk.content)}
                              className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              disabled={submitting}
                              aria-label={t('storyChunkEditor.editChunk', 'Edit Chunk #{{index}}', { index: chunk.chunkIndex }) as string}
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                        </div>

                        {/* Content */}
                        <div className="relative">
                          <div className={`text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed ${!isExpanded && needsExpansion ? 'max-h-24 overflow-hidden' : ''}`}>
                            {isExpanded ? chunk.content : contentPreview}
                          </div>
                          {!isExpanded && needsExpansion && (
                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-gray-800 to-transparent pointer-events-none" />
                          )}
                        </div>

                        {/* Expand/Collapse Button */}
                        {needsExpansion && (
                          <button
                            onClick={() => toggleChunkExpansion(chunk.chunkIndex)}
                            className="w-full py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center justify-center gap-1 transition-colors"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp size={14} />
                                {t('common.showLess', 'Show less')}
                              </>
                            ) : (
                              <>
                                <ChevronDown size={14} />
                                {t('common.showMore', 'Show more')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
              <div className="w-12 h-12 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin mb-4"></div>
              <p className="text-sm font-medium">{t('storyChunkEditor.loading', 'Loading...')}</p>
            </div>
          )}

          {!loading && sortedChunks.length === 0 && !error && !localError && isSealed && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Lock size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-sm font-medium">{t('storyChunkEditor.noChunksSealed', 'This story is sealed with no chunks.')}</p>
            </div>
          )}
        </div>
        
        {showSealConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 border border-gray-200 dark:border-gray-700 animate-in zoom-in-95 duration-200">
              <div className="flex items-start gap-3">
                <div className="p-3 bg-blue-100 dark:bg-blue-500/20 rounded-xl">
                  <Lock size={24} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
                    {t('storyChunkEditor.sealDialog.title', 'Seal Story')}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {t('storyChunkEditor.sealDialog.description', 'Are you sure you want to seal the story? Once sealed, it cannot be modified.')}
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                  {t('storyChunkEditor.sealDialog.warning', 'This action is permanent and cannot be undone.')}
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300 select-none cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 bg-white dark:bg-gray-700"
                  checked={skipSealConfirm}
                  onChange={(e) => {
                    const v = e.target.checked
                    setSkipSealConfirm(v)
                    try { localStorage.setItem('skipSealConfirm', v ? '1' : '0') } catch {}
                  }}
                />
                <span>{t('storyChunkEditor.sealDialog.dontAskAgain', "Don't ask again")}</span>
              </label>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => setShowSealConfirm(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {t('storyChunkEditor.sealDialog.cancel', 'Cancel')}
                </button>
                <button
                  onClick={executeSeal}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      {t('storyChunkEditor.saving', 'Saving...')}
                    </>
                  ) : (
                    <>
                      <Lock size={16} />
                      {t('storyChunkEditor.sealDialog.confirm', 'Confirm Seal')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  )

  if (layout === 'page') {
    return (
      <div className="w-full" data-story-editor-page>
        <div className="mx-auto flex justify-center">
          {Card}
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[1001] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200" data-story-editor>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full flex justify-center">
        {Card}
      </div>
    </div>,
    document.body
  )
}
