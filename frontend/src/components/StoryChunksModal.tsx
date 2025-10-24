import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  X,
  User,
  Calendar,
  Book,
  FileText,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  Hash,
  AlertCircle,
  Wallet,
  Link,
  Edit2,
  Star,
  Check
} from 'lucide-react'
import { NodeData, StoryChunk, hasDetailedStory as hasDetailedStoryFn, birthDateString, deathDateString, genderText as genderTextFn, isMinted, formatUnixSeconds, shortAddress, formatHashMiddle } from '../types/graph'
import { useTreeData } from '../context/TreeDataContext'
import { getChunkTypeOptions, getChunkTypeI18nKey, getChunkTypeIcon, getChunkTypeColorClass, getChunkTypeBorderColorClass } from '../constants/chunkTypes'
// owner/address will be resolved via TreeDataContext caching

interface StoryChunksModalProps {
  person: NodeData
  isOpen: boolean
  onClose: () => void
}

interface StoryData {
  chunks: StoryChunk[]
  fullStory: string
  integrity: {
    missing: number[]
    lengthMatch: boolean
    hashMatch: boolean | null
    computedLength: number
    computedHash?: string
  }
  loading: boolean
  integrityChecking: boolean
  error?: string
}

// Removed computeStoryIntegrity function as it's now handled in TreeDataContext

export default function StoryChunksModal({ person, isOpen, onClose }: StoryChunksModalProps) {
  const { t } = useTranslation()
  const { getStoryData, getOwnerOf } = useTreeData()
  const nameContainerRef = useRef<HTMLDivElement | null>(null)
  const nameTextRef = useRef<HTMLSpanElement | null>(null)
  const [marquee, setMarquee] = useState(false)
  const navigate = useNavigate()

  const [storyData, setStoryData] = useState<StoryData>({
    chunks: [],
    fullStory: '',
    integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
    loading: false,
    integrityChecking: false
  })
  
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'chunks' | 'full'>('chunks')
  const [centerHint, setCenterHint] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  const [owner, setOwner] = useState<string | undefined>(person.owner)
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(min-width: 640px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(min-width: 640px)')
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsDesktop((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches)
    try {
      mql.addEventListener('change', onChange as any)
    } catch {
      ;(mql as any).addListener(onChange)
    }
    onChange(mql as any)
    return () => {
      try {
        mql.removeEventListener('change', onChange as any)
      } catch {
        ;(mql as any).removeListener(onChange)
      }
    }
  }, [])

  const personHasDetailedStory = useMemo(() => hasDetailedStoryFn(person), [person])

  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t])

  const getChunkTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      if (type === null || type === undefined || type === '') {
        return chunkTypeOptions[0]?.label || t('storyChunkEditor.chunkTypes.unknown', 'Unknown')
      }
      const numericType = Number(type)
      if (Number.isFinite(numericType)) {
        const match = chunkTypeOptions.find(opt => opt.value === numericType)
        if (match) return match.label
      }
      return t('storyChunkEditor.chunkTypes.unknown', 'Unknown')
    },
    [chunkTypeOptions, t]
  )

  const resolveAttachmentUrl = useCallback((cid: string) => {
    if (!cid) return ''
    if (cid.startsWith('ipfs://')) {
      return `https://ipfs.io/ipfs/${cid.slice(7)}`
    }
    return cid
  }, [])

  // Keep local owner state in sync with NodeData updates
  useEffect(() => {
    if (isOpen) setOwner(person.owner)
  }, [person.owner, isOpen])

  // Computed meta for compact row under Detailed Story
  const chunksCount = useMemo(() => (
    person.storyMetadata?.totalChunks ?? storyData.chunks.length
  ), [person.storyMetadata, storyData.chunks])
  const lengthBytes = useMemo(() => (
    person.storyMetadata?.totalLength ?? (storyData.integrity.computedLength || storyData.fullStory.length)
  ), [person.storyMetadata, storyData.integrity.computedLength, storyData.fullStory.length])
  const integrityOk = useMemo(() => (
    !!storyData.integrity && storyData.integrity.missing.length === 0 && storyData.integrity.lengthMatch && storyData.integrity.hashMatch === true
  ), [storyData.integrity])

  // Format dates
  const formatDate = useMemo(() => ({
    birth: birthDateString(person),
    death: deathDateString(person)
  }), [person])

  // Gender text
  const genderText = useMemo(() => genderTextFn(person.gender, t as any), [person.gender, t])

  // Copy function
  const copyText = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        setCenterHint(t('common.copied', 'Copied'))
        setTimeout(() => setCenterHint(null), 1200)
        return true
      }
    } catch {}
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      // Using deprecated execCommand as fallback for older browsers
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      setCenterHint(ok ? t('common.copied', 'Copied') : t('common.copyFailed', 'Failed to copy'))
      setTimeout(() => setCenterHint(null), 1200)
      return ok
    } catch {
      setCenterHint(t('common.copyFailed', 'Failed to copy'))
      setTimeout(() => setCenterHint(null), 1200)
      return false
    }
  }, [t])

  const SmartHash: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const measureRef = useRef<HTMLSpanElement | null>(null)
    const [useAbbrev, setUseAbbrev] = useState<boolean>(() => !isDesktop)
    const fullText = text ?? ''
    useEffect(() => {
      if (!text) { setUseAbbrev(false); return }
      if (!isDesktop) { setUseAbbrev(true); return }
      const container = containerRef.current
      const measure = measureRef.current
      if (!container || !measure) return
      const available = container.clientWidth
      const needed = measure.scrollWidth
      setUseAbbrev(needed > available + 1)
    }, [fullText, isDesktop])
    useEffect(() => {
      if (!isDesktop) return
      const onResize = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 1)
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [isDesktop])
    if (!text) return <span>-</span>
    return (
      <div ref={containerRef} className="relative min-w-0" title={text}>
        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">{useAbbrev ? formatHashMiddle(text) : text}</span>
        <span ref={measureRef} className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap">{text}</span>
      </div>
    )
  }

  const SmartAddress: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const measureRef = useRef<HTMLSpanElement | null>(null)
    const [useAbbrev, setUseAbbrev] = useState<boolean>(() => !isDesktop)
    const fullText = text ?? ''
    useEffect(() => {
      if (!text) { setUseAbbrev(false); return }
      if (!isDesktop) { setUseAbbrev(true); return }
      const container = containerRef.current
      const measure = measureRef.current
      if (!container || !measure) return
      const available = container.clientWidth
      const needed = measure.scrollWidth
      setUseAbbrev(needed > available + 1)
    }, [fullText, isDesktop])
    useEffect(() => {
      if (!isDesktop) return
      const onResize = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 1)
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [isDesktop])
    if (!text) return <span>-</span>
    return (
      <div ref={containerRef} className="relative min-w-0" title={text}>
        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">{useAbbrev ? shortAddress(text) : text}</span>
        <span ref={measureRef} className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap">{text}</span>
      </div>
    )
  }

  // Fetch story data using TreeDataContext
  const fetchStoryData = useCallback(async () => {
    if (!person.tokenId) {
      return
    }

    setStoryData(prev => ({ ...prev, loading: true, integrityChecking: false, error: undefined }))

    try {
      const data = await getStoryData(person.tokenId)
      // Handle offline mode with no cached data
      if (!data) {
        setStoryData({
          chunks: [],
          fullStory: '',
          integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
          loading: false,
          integrityChecking: false,
          error: t('storyChunksModal.noStoryData', 'No story data available')
        })
        return
      }
      
      // If there are chunks, show integrity checking status first
      if (data.chunks.length > 0) {
        setStoryData(prev => ({
          ...prev,
          chunks: data.chunks,
          fullStory: data.fullStory,
          loading: false,
          integrityChecking: true
        }))
        
        // Small delay to show "checking..." status
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      
      setStoryData({
        chunks: data.chunks,
        fullStory: data.fullStory,
        integrity: data.integrity,
        loading: false,
        integrityChecking: false
      })
    } catch (err: any) {
      console.error('Failed to fetch story chunks:', err)
      setStoryData(prev => ({
        ...prev,
        loading: false,
        integrityChecking: false,
        error: err.message || t('storyChunksModal.fetchError', 'Failed to load story data')
      }))
    }
  }, [person.tokenId, getStoryData, t])

  // Load data when opened
  useEffect(() => {
    if (isOpen) {
      fetchStoryData()
    }
  }, [isOpen, fetchStoryData])

  // Fetch owner address for token when modal opens (uses cached getter and backfills NodeData)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!isOpen) return
        if (!person.tokenId || person.tokenId === '0') return
        const addr = await getOwnerOf(person.tokenId)
        if (!cancelled) setOwner(addr || undefined)
      } catch {
        if (!cancelled) setOwner(undefined)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, person.tokenId, getOwnerOf])

  // Toggle chunk expansion
  const toggleChunk = (index: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // Remove unused handlePreload function - preloading is handled in PersonStoryCard

  // Determine if name overflows to enable marquee
  useEffect(() => {
    if (!isOpen) return
    const check = () => {
      if (nameContainerRef.current && nameTextRef.current) {
        const need = nameTextRef.current.scrollWidth > nameContainerRef.current.clientWidth + 4
        setMarquee(need)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [isOpen, person.fullName])

  // Prevent background scroll when open
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  if (!isOpen) return null

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Enter animation for mobile bottom sheet
  useEffect(() => { if (isOpen) { requestAnimationFrame(() => setEntered(true)) } else { setEntered(false) } }, [isOpen])

  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm overflow-x-hidden" onClick={onClose} style={{ touchAction: 'pan-y' }}>
      {/* Modal Container (responsive: bottom sheet on mobile, dialog on desktop) */}
      <div className="flex items-end sm:items-center justify-center h-full w-full p-3 sm:p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div
          className={`relative flex flex-col w-full max-w-[860px] h-[92vh] sm:h-auto sm:max-h-[85vh] bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'} will-change-transform`}
          onClick={(e) => e.stopPropagation()}
          style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
        >
          {/* Center Hint */}
          {centerHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
              <div className="rounded-lg bg-black/80 dark:bg-black/70 text-white px-4 py-2 text-sm font-medium animate-fade-in shadow-lg">
                {centerHint}
              </div>
            </div>
          )}
          {/* Header (sticky for mobile) */}
          <div
            className="sticky top-0 bg-gradient-to-br from-blue-100/80 via-purple-100/60 to-blue-50/40 dark:from-gray-800 dark:via-gray-800/95 dark:to-gray-900 px-5 py-4 pt-7 sm:pt-5 sm:px-6 border-b border-gray-200 dark:border-gray-700 z-20 backdrop-blur-sm supports-[backdrop-filter]:bg-white/90 dark:supports-[backdrop-filter]:bg-gray-900/80 relative touch-none cursor-grab active:cursor-grabbing select-none"
            onPointerDown={(e) => { (e.currentTarget as any).setPointerCapture?.(e.pointerId); startYRef.current = e.clientY; setDragging(true) }}
            onPointerMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.clientY - startYRef.current); setDragOffset(dy) }}
            onPointerUp={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) onClose() }}
            onPointerCancel={() => { setDragging(false); setDragOffset(0) }}
            onTouchStart={(e) => { startYRef.current = e.touches[0].clientY; setDragging(true) }}
            onTouchMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.touches[0].clientY - startYRef.current); setDragOffset(dy) }}
            onTouchEnd={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) onClose() }}
          >
            {/* Drag handle */}
            <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <User className="w-7 h-7 sm:w-8 sm:h-8 text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  {/* Name with conditional marquee when overflow */}
                  <div ref={nameContainerRef} className="relative max-w-[56vw] sm:max-w-xs md:max-w-md overflow-hidden">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 mb-1 whitespace-nowrap">
                      <span
                        ref={nameTextRef}
                        className={`inline-block pr-8 ${marquee ? 'will-change-transform animate-[marquee_12s_linear_infinite]' : ''}`}
                      >
                        {person.fullName || `Person ${person.personHash.slice(0, 8)}...`}
                      </span>
                    </h2>
                    {marquee && (
                      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white dark:from-gray-900 to-transparent" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    {genderText && <span className="whitespace-nowrap font-medium">{genderText}</span>}
                    {isMinted(person) && <span className="font-mono whitespace-nowrap font-semibold">#{person.tokenId}</span>}
                    {person.endorsementCount !== undefined && person.endorsementCount > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const params = new URLSearchParams()
                          if (person.personHash) params.set('hash', person.personHash)
                          if (person.versionIndex) params.set('vi', person.versionIndex.toString())
                          window.open(`/actions?tab=endorse&${params.toString()}`, '_blank', 'noopener,noreferrer')
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                        title={t('people.clickToEndorse', 'Click to endorse this version')}
                      >
                        <Star className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500 dark:text-emerald-400 dark:fill-emerald-400" strokeWidth={0} />
                        <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {person.endorsementCount}
                        </span>
                      </button>
                    )}
                    {isMinted(person) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(`/person/${person.tokenId || person.id}`, '_blank', 'noopener,noreferrer')
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 border border-blue-200/60 dark:border-blue-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                        title={t('storyChunksModal.peopleEncyclopedia', 'People Encyclopedia')}
                      >
                        <Book className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span className="hidden sm:inline text-[13px] font-semibold text-blue-700 dark:text-blue-400">
                          {t('familyTree.nodeDetail.encyclopedia', 'Encyclopedia')}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <button
                aria-label={t('common.close', 'Close')}
                className="p-1.5 -mt-0.5 rounded-lg hover:bg-gray-200/80 dark:hover:bg-gray-700/80 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); onClose() }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <X size={22} strokeWidth={2} />
              </button>
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
            <div className="p-4 sm:p-6 pb-24 sm:pb-6 space-y-6">{/* extra bottom space for safe touch area */}
              {/* Life Events Section */}
              {((formatDate.birth || person.birthPlace) || (formatDate.death || person.deathPlace)) && (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 px-1">
                    <Calendar className="w-4.5 h-4.5 text-blue-600" />
                    {t('storyChunksModal.lifeEvents', 'Life Events')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(formatDate.birth || person.birthPlace) && (
                      <div className="flex items-start gap-3 p-3.5 bg-green-50/60 dark:bg-green-900/10 rounded-xl border border-green-200/60 dark:border-green-800/30 hover:border-green-300 dark:hover:border-green-700/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                          <Calendar className="w-4.5 h-4.5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-green-900 dark:text-green-100 mb-1.5">
                            {t('storyChunksModal.born', 'Born')}
                          </div>
                          <div className="text-[15px] text-green-700 dark:text-green-300 font-medium leading-relaxed">
                            {[formatDate.birth, person.birthPlace].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    )}

                    {(formatDate.death || person.deathPlace) && (
                      <div className="flex items-start gap-3 p-3.5 bg-gray-50/60 dark:bg-gray-800/30 rounded-xl border border-gray-200/60 dark:border-gray-700/30 hover:border-gray-300 dark:hover:border-gray-600/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800/50 flex items-center justify-center flex-shrink-0">
                          <Calendar className="w-4.5 h-4.5 text-gray-600 dark:text-gray-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
                            {t('storyChunksModal.died', 'Died')}
                          </div>
                          <div className="text-[15px] text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                            {[formatDate.death, person.deathPlace].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Blockchain Identity Section */}
              {(person.personHash || isMinted(person) || person.tag || person.nftTokenURI) && (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 px-1">
                    <Hash className="w-4.5 h-4.5 text-purple-600" />
                    {t('storyChunksModal.blockchainIdentity', 'Blockchain Identity')}
                  </h3>
                  <div className="space-y-2.5">
                    {person.personHash && (
                      <div className="flex items-center gap-3 p-3.5 bg-purple-50/60 dark:bg-purple-900/10 rounded-xl border border-purple-200/60 dark:border-purple-800/30 hover:border-purple-300 dark:hover:border-purple-700/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                          <Hash className="w-4.5 h-4.5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-1.5 flex items-center gap-2">
                            {t('storyChunksModal.personHash', 'Person Hash')}
                            {person.versionIndex && (
                              <span className="px-1.5 py-0.5 text-[9px] font-mono bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-300 rounded">
                                v{person.versionIndex}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-purple-700 dark:text-purple-300 font-mono min-w-0 flex-1">
                              <SmartHash text={person.personHash} />
                            </div>
                            <button
                              onClick={() => copyText(person.personHash)}
                              className="p-1.5 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded-lg transition-colors flex-shrink-0"
                              title={t('common.copy', 'Copy')}
                            >
                              <Copy className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {isMinted(person) && (
                      <div className="flex items-center gap-3 p-3.5 bg-indigo-50/60 dark:bg-indigo-900/10 rounded-xl border border-indigo-200/60 dark:border-indigo-800/30 hover:border-indigo-300 dark:hover:border-indigo-700/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                          <Wallet className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-1.5">
                            {t('person.owner', 'Owner Address')}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-indigo-700 dark:text-indigo-300 font-mono min-w-0 flex-1">
                              <SmartAddress text={owner} />
                            </div>
                            {owner && (
                              <button
                                onClick={() => copyText(owner)}
                                className="p-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg transition-colors flex-shrink-0"
                                title={t('common.copy', 'Copy')}
                              >
                                <Copy className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {person.tag && (
                      <div className="flex items-center gap-3 p-3.5 bg-emerald-50/60 dark:bg-emerald-900/10 rounded-xl border border-emerald-200/60 dark:border-emerald-800/30 hover:border-emerald-300 dark:hover:border-emerald-700/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <Hash className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1.5">
                            {t('storyChunksModal.tag', 'Tag')}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full font-medium">
                              {person.tag}
                            </div>
                            <button
                              onClick={() => copyText(person.tag!)}
                              className="p-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg transition-colors flex-shrink-0"
                              title={t('common.copy', 'Copy')}
                            >
                              <Copy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {person.nftTokenURI && (
                      <div className="flex items-center gap-3 p-3.5 bg-blue-50/60 dark:bg-blue-900/10 rounded-xl border border-blue-200/60 dark:border-blue-800/30 hover:border-blue-300 dark:hover:border-blue-700/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                          <Link className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1.5">
                            {t('familyTree.nodeDetail.uri', 'Token URI')}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-blue-700 dark:text-blue-300 font-mono break-all line-clamp-2 flex-1">
                              {person.nftTokenURI}
                            </div>
                            <button
                              onClick={() => copyText(person.nftTokenURI!)}
                              className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors flex-shrink-0"
                              title={t('common.copy', 'Copy')}
                            >
                              <Copy className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Story Content */}
              <div className="space-y-6">
                {/* Basic Story must reflect person.story exactly */}
                {person.story && (
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 px-1">
                      <FileText className="w-4.5 h-4.5 text-blue-600" />
                      {t('storyChunksModal.basicStory', 'Basic Story')}
                    </h3>
                    <div className="bg-gradient-to-br from-blue-50/50 via-white to-purple-50/30 dark:from-gray-800/50 dark:via-gray-800/30 dark:to-gray-800/50 rounded-xl p-4 sm:p-5 border border-blue-200/50 dark:border-gray-700/50 shadow-sm">
                      <p className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                        {person.story}
                      </p>
                    </div>
                  </div>
                )}
                {(personHasDetailedStory || person.storyMetadata || storyData.loading || storyData.chunks.length > 0 || !!storyData.fullStory || storyData.integrity.computedLength > 0 || isMinted(person)) && (
                  <div className="space-y-4">
                    {/* Header with View Mode Toggle */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 px-1">
                          <Book className="w-4.5 h-4.5 text-blue-600" />
                          {t('storyChunksModal.detailedStory', 'Detailed Story')}
                        </h3>
                        {chunksCount > 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                            {t('storyChunksModal.chunksCount', '{{count}} chunks, {{length}} bytes', {
                              count: chunksCount,
                              length: lengthBytes
                            })}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                          onClick={() => setViewMode('chunks')}
                          className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                            viewMode === 'chunks'
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
                          }`}
                        >
                          <Layers className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                          <span className="hidden sm:inline">{t('storyChunksModal.chunks', 'Chunks')}</span>
                        </button>
                        <button
                          onClick={() => setViewMode('full')}
                          className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                            viewMode === 'full'
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
                          }`}
                        >
                          <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                          <span className="hidden sm:inline">{t('storyChunksModal.fullText', 'Full Text')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Status Badges Row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        {person.storyMetadata?.isSealed ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/70 dark:border-blue-400/60 text-blue-600 dark:text-blue-300 text-xs font-semibold bg-blue-50/50 dark:bg-blue-900/20">
                            <Check className="w-3.5 h-3.5" />
                            {t('person.sealed', 'Sealed')}
                          </span>
                        ) : (
                          person.tokenId && (
                            <button
                              onClick={() => {
                                if (!person.tokenId) return
                                window.open(`/editor/${person.tokenId}`, '_blank', 'noopener,noreferrer')
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 border border-green-200/60 dark:border-green-800/50 text-green-700 dark:text-green-400 text-xs font-semibold transition-all duration-200"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              {t('person.editable', 'Editable')}
                            </button>
                          )
                        )}
                      </div>
                      {chunksCount > 0 && !storyData.loading && (
                        storyData.integrityChecking ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/70 dark:border-blue-400/60 text-blue-600 dark:text-blue-300 text-xs font-medium bg-blue-50/50 dark:bg-blue-900/20">
                            <div className="animate-spin w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                            {t('storyChunksModal.integrityChecking', 'Checking...')}
                          </span>
                        ) : storyData.integrity && (
                          integrityOk ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-500/70 dark:border-green-400/60 text-green-600 dark:text-green-300 text-xs font-medium bg-green-50/50 dark:bg-green-900/20">
                              <Check className="w-3.5 h-3.5" />
                              {t('storyChunksModal.integrityVerified', 'Integrity verified')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/70 dark:border-amber-400/60 text-amber-600 dark:text-amber-300 text-xs font-medium bg-amber-50/50 dark:bg-amber-900/20">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t('storyChunksModal.integrityWarning', 'Integrity failed')}
                            </span>
                          )
                        )
                      )}
                    </div>

                    {/* Story Data Display */}
                    {storyData.loading ? (
                      <div className="flex items-center justify-center py-16 bg-gradient-to-br from-blue-50/30 to-purple-50/20 dark:from-gray-800/30 dark:to-gray-800/20 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                        <div className="text-center">
                          <div className="animate-spin w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {t('storyChunksModal.loading', 'Loading story chunks...')}
                          </span>
                        </div>
                      </div>
                    ) : storyData.error ? (
                      <div className="text-center py-16 bg-red-50/50 dark:bg-red-900/10 rounded-xl border border-red-200/50 dark:border-red-800/30">
                        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                        <p className="text-sm font-medium text-red-600 dark:text-red-400">{storyData.error}</p>
                      </div>
                    ) : viewMode === 'chunks' && storyData.chunks.length > 0 ? (
                      <div className="space-y-2.5">
                        {storyData.chunks.map((chunk) => {
                          const isExpanded = expandedChunks.has(chunk.chunkIndex)
                          const preview = chunk.content.length > 120 ? `${chunk.content.slice(0, 120)}...` : chunk.content

                          return (
                            <div
                              key={chunk.chunkIndex}
                              className={`border rounded-xl p-4 transition-all ${
                                isExpanded
                                  ? 'border-blue-300 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-900/10 shadow-sm'
                                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-blue-200 dark:hover:border-blue-700'
                              }`}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleChunk(chunk.chunkIndex)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    toggleChunk(chunk.chunkIndex)
                                  }
                                }}
                                className="w-full text-left flex items-start gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                              >
                                <span className={`mt-0.5 transition-colors ${isExpanded ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {isExpanded ? <ChevronDown className="w-4.5 h-4.5" /> : <ChevronRight className="w-4.5 h-4.5" />}
                                </span>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[15px] font-semibold ${isExpanded ? 'text-blue-900 dark:text-blue-100' : 'text-gray-900 dark:text-gray-100'}`}>
                                        #{chunk.chunkIndex}
                                      </span>
                                      {(() => {
                                        const ChunkIcon = getChunkTypeIcon(chunk.chunkType)
                                        const iconColor = getChunkTypeColorClass(chunk.chunkType)
                                        const borderColor = getChunkTypeBorderColorClass(chunk.chunkType)
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            <ChunkIcon size={14} className={iconColor} />
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${iconColor} ${borderColor} bg-white dark:bg-gray-900`}>
                                              {getChunkTypeLabel(chunk.chunkType)}
                                            </span>
                                          </div>
                                        )
                                      })()}
                                    </div>
                                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-full">
                                      {chunk.content.length} {t('storyChunksModal.characters', 'chars')}
                                    </span>
                                  </div>

                                  <div className={`text-[13px] leading-relaxed ${isExpanded ? 'text-gray-800 dark:text-gray-200 whitespace-pre-wrap' : 'text-gray-700 dark:text-gray-300 line-clamp-2'}`}>
                                    {isExpanded ? chunk.content : preview}
                                  </div>

                                  {isExpanded && (
                                    <div className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <User className="w-3.5 h-3.5 flex-shrink-0" />
                                        {chunk.editor ? (
                                          <>
                                            <span className="truncate" title={chunk.editor}>{shortAddress(chunk.editor)}</span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                copyText(chunk.editor)
                                              }}
                                              className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                              type="button"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          </>
                                        ) : (
                                          <span>-</span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span>{formatUnixSeconds(chunk.timestamp)}</span>
                                      </div>
                                      {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
                                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                          <Link className="w-3.5 h-3.5 flex-shrink-0" />
                                          <span className="truncate font-mono" title={chunk.attachmentCID}>
                                            {chunk.attachmentCID.length > 20 ? `${chunk.attachmentCID.slice(0, 8)}...${chunk.attachmentCID.slice(-8)}` : chunk.attachmentCID}
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              copyText(chunk.attachmentCID)
                                            }}
                                            className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                            type="button"
                                          >
                                            <Copy className="w-3 h-3" />
                                          </button>
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span className="font-mono truncate" title={chunk.chunkHash}>{formatHashMiddle(chunk.chunkHash)}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            copyText(chunk.chunkHash)
                                          }}
                                          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                          type="button"
                                        >
                                          <Copy className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : viewMode === 'full' && storyData.fullStory ? (
                      <div className="bg-gradient-to-br from-gray-50/50 via-white to-gray-50/30 dark:from-gray-800/50 dark:via-gray-800/30 dark:to-gray-800/50 rounded-xl p-5 sm:p-6 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                            {storyData.fullStory}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gradient-to-br from-gray-50/30 to-gray-100/20 dark:from-gray-800/30 dark:to-gray-800/20 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {t('storyChunksModal.noStoryData', 'No story data available')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {/* Empty state only if no basic or detailed content */}
                {!person.story && !(personHasDetailedStory || person.storyMetadata || storyData.chunks.length > 0 || !!storyData.fullStory || storyData.integrity.computedLength > 0 || storyData.loading) && (
                  <div className="text-center py-16 bg-gradient-to-br from-gray-50/30 to-gray-100/20 dark:from-gray-800/30 dark:to-gray-800/20 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Book className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {t('storyChunksModal.noStory', 'No story content available')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
