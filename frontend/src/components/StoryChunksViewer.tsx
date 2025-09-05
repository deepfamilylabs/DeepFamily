import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  X, 
  User, 
  Calendar, 
  MapPin, 
  Book, 
  FileText, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  Copy,
  Layers,
  Hash,
  Check,
  AlertCircle
} from 'lucide-react'
import { NodeData, StoryChunk } from '../types/graph'
import { useConfig } from '../context/ConfigContext'
import { useToast } from './ToastProvider'
import { ethers } from 'ethers'
import DeepFamily from '../abi/DeepFamily.json'

interface StoryChunksViewerProps {
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
  error?: string
}

function computeStoryIntegrity(chunks: StoryChunk[], metadata: any) {
  const sorted = [...chunks].sort((a,b)=>a.chunkIndex-b.chunkIndex)
  const missing: number[] = []
  
  if (metadata?.totalChunks) {
    for (let i = 0; i < metadata.totalChunks; i++) {
      if (!sorted.find(c => c.chunkIndex === i)) missing.push(i)
    }
  }
  
  const fullStory = sorted.map(c => c.content).join('')
  const encoder = new TextEncoder()
  const computedLength = sorted.reduce((acc, c) => acc + encoder.encode(c.content).length, 0)
  const lengthMatch = metadata?.totalLength ? computedLength === metadata.totalLength : true
  
  let hashMatch: boolean | null = null
  let computedHash: string | undefined
  
  if (missing.length === 0 && metadata?.totalChunks > 0 && metadata?.fullStoryHash && metadata.fullStoryHash !== ethers.ZeroHash) {
    try {
      const concatenated = '0x' + sorted.map(c => c.chunkHash.replace(/^0x/, '')).join('')
      computedHash = ethers.keccak256(concatenated)
      hashMatch = computedHash === metadata.fullStoryHash
    } catch {
      // ignore
    }
  }
  
  return { 
    fullStory, 
    integrity: { 
      missing, 
      lengthMatch, 
      hashMatch, 
      computedLength, 
      computedHash 
    } 
  }
}

export default function StoryChunksViewer({ person, isOpen, onClose }: StoryChunksViewerProps) {
  const { t } = useTranslation()
  const { rpcUrl, contractAddress } = useConfig()
  const toast = useToast()
  const nameContainerRef = useRef<HTMLDivElement | null>(null)
  const nameTextRef = useRef<HTMLSpanElement | null>(null)
  const [marquee, setMarquee] = useState(false)

  const [storyData, setStoryData] = useState<StoryData>({
    chunks: [],
    fullStory: '',
    integrity: { missing: [], lengthMatch: true, hashMatch: null, computedLength: 0 },
    loading: false
  })
  
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'chunks' | 'full'>('chunks')
  const [centerHint, setCenterHint] = useState<string | null>(null)

  // Format dates
  const formatDate = useMemo(() => {
    const formatDatePart = (year?: number, month?: number, day?: number, isBC?: boolean) => {
      if (!year) return ''
      let dateStr = isBC ? `BC ${year}` : year.toString()
      if (month && month > 0) {
        dateStr += `-${month.toString().padStart(2, '0')}`
        if (day && day > 0) {
          dateStr += `-${day.toString().padStart(2, '0')}`
        }
      }
      return dateStr
    }

    const birth = formatDatePart(person.birthYear, person.birthMonth, person.birthDay, person.isBirthBC)
    const death = formatDatePart(person.deathYear, person.deathMonth, person.deathDay, person.isDeathBC)
    
    return { birth, death }
  }, [person])

  // Gender text
  const genderText = useMemo(() => {
    switch (person.gender) {
      case 1: return t('visualization.nodeDetail.genders.male', 'Male')
      case 2: return t('visualization.nodeDetail.genders.female', 'Female')
      case 3: return t('visualization.nodeDetail.genders.other', 'Other')
      default: return ''
    }
  }, [person.gender, t])

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

  // Fetch story data
  const fetchStoryData = useCallback(async () => {
    if (!person.tokenId || !person.hasDetailedStory || !rpcUrl || !contractAddress) {
      return
    }

    setStoryData(prev => ({ ...prev, loading: true, error: undefined }))

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      
      const metadata = await contract.getStoryMetadata(person.tokenId)
      const storyMetadata = {
        totalChunks: Number(metadata.totalChunks),
        totalLength: Number(metadata.totalLength),
        isSealed: Boolean(metadata.isSealed),
        lastUpdateTime: Number(metadata.lastUpdateTime),
        fullStoryHash: metadata.fullStoryHash
      }

      const chunks: StoryChunk[] = []
      if (storyMetadata.totalChunks > 0) {
        for (let i = 0; i < storyMetadata.totalChunks; i++) {
          try {
            const chunk = await contract.getStoryChunk(person.tokenId, i)
            chunks.push({
              chunkIndex: Number(chunk.chunkIndex),
              chunkHash: chunk.chunkHash,
              content: chunk.content,
              timestamp: Number(chunk.timestamp),
              lastEditor: chunk.lastEditor
            })
          } catch (e) {
            // Skip missing chunks
            console.warn(`Missing chunk ${i} for token ${person.tokenId}`)
          }
        }
      }

      const { fullStory, integrity } = computeStoryIntegrity(chunks, storyMetadata)

      setStoryData({
        chunks: chunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
        fullStory,
        integrity,
        loading: false
      })

    } catch (err: any) {
      console.error('Failed to fetch story chunks:', err)
      setStoryData(prev => ({
        ...prev,
        loading: false,
        error: err.message || t('storyChunksViewer.fetchError', 'Failed to load story data')
      }))
    }
  }, [person.tokenId, person.hasDetailedStory, rpcUrl, contractAddress, t])

  // Load data when opened
  useEffect(() => {
    if (isOpen && person.hasDetailedStory) {
      fetchStoryData()
    }
  }, [isOpen, person.hasDetailedStory, fetchStoryData])

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

  // Navigate to detailed story page in new tab
  const goToDetailPage = () => {
    if (person.tokenId) {
      window.open(`/person/${person.tokenId}`, '_blank', 'noopener,noreferrer')
      onClose()
    }
  }

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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Modal Container (flex to allow full height on mobile) */}
      <div className="relative flex h-full w-full sm:min-h-screen sm:items-center sm:justify-center p-0 sm:p-4">
        <div className="relative flex flex-col w-full h-full sm:h-auto sm:max-h-[90vh] max-w-none sm:max-w-4xl bg-white dark:bg-gray-900 rounded-none sm:rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          {/* Center Hint */}
          {centerHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
              <div className="rounded-lg bg-black/80 dark:bg-black/70 text-white px-4 py-2 text-sm font-medium animate-fade-in shadow-lg">
                {centerHint}
              </div>
            </div>
          )}
          {/* Header (sticky for mobile) */}
          <div className="sticky top-0 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-indigo-500/10 dark:from-blue-600/20 dark:via-purple-600/15 dark:to-indigo-600/20 p-4 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
                  <User className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="min-w-0">
                  {/* Name with conditional marquee when overflow */}
                  <div ref={nameContainerRef} className="relative max-w-[56vw] sm:max-w-xs md:max-w-md overflow-hidden">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 whitespace-nowrap">
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
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                    {genderText && <span>{genderText}</span>}
                    {person.tokenId && person.tokenId !== '0' && (
                      <div className="flex items-center gap-2">
                        <span className="font-mono">#{person.tokenId}</span>
                        {person.endorsementCount !== undefined && person.endorsementCount > 0 && (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-full">
                            <span className="text-yellow-500">⭐</span>
                            <span className="text-[10px] sm:text-xs font-medium text-yellow-700 dark:text-yellow-300">
                              {person.endorsementCount}
                            </span>
                          </div>
                        )}
                        {/* Moved People Encyclopedia button here after endorsement info */}
                        <button
                          onClick={() => window.open(`/person/${person.tokenId || person.id}`, '_blank', 'noopener,noreferrer')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] sm:text-xs font-medium rounded-full transition-colors"
                        >
                          <Book className="w-3.5 h-3.5" />
                          {t('storyChunksViewer.peopleEncyclopedia', '人物百科')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Removed encyclopedia button from here; now only close */}
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="p-4 sm:p-6 pb-24 sm:pb-6">{/* extra bottom space for safe touch area */}
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gray-50/70 dark:bg-gray-800/30 rounded-2xl">
                {(formatDate.birth || person.birthPlace) && (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.born', 'Born')}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                        {[formatDate.birth, person.birthPlace].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                )}

                {(formatDate.death || person.deathPlace) && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-gray-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.died', 'Died')}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                        {[formatDate.death, person.deathPlace].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                )}

                {person.storyMetadata && (
                  <div className="flex items-center gap-3">
                    <Layers className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.storyInfo', 'Story Info')}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {t('storyChunksViewer.chunksCount', '{{count}} chunks, {{length}} bytes', {
                          count: person.storyMetadata.totalChunks,
                          length: person.storyMetadata.totalLength
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {person.addedBy && (
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-indigo-500" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.addedBy', 'Added By')}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-600 dark:text-gray-400 font-mono truncate">
                          {person.addedBy}
                        </div>
                        <button
                          onClick={() => copyText(person.addedBy!)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {person.tag && (
                  <div className="flex items-center gap-3">
                    <Hash className="w-5 h-5 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.tag', 'Tag')}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-600 dark:text-gray-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">
                          {person.tag}
                        </div>
                        <button
                          onClick={() => copyText(person.tag!)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {person.personHash && (
                  <div className="flex items-center gap-3">
                    <Hash className="w-5 h-5 text-purple-500" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('storyChunksViewer.personHash', 'Person Hash')}
                        {person.versionIndex && (
                          <span className="ml-2 text-xs font-mono text-gray-500 dark:text-gray-400">
                            v{person.versionIndex}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-600 dark:text-gray-400 font-mono truncate">
                          {person.personHash}
                        </div>
                        <button
                          onClick={() => copyText(person.personHash)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Story Content */}
              {person.hasDetailedStory ? (
                <div>
                  {/* Basic Story / Overview still visible when detailed story exists */}
                  {person.story && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-600" />
                        {t('storyChunksViewer.basicStory', 'Basic Story')}
                      </h3>
                      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                        <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                          {person.story}
                        </p>
                      </div>
                    </div>
                  )}
                  {/* View Mode Toggle */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Book className="w-5 h-5 text-blue-600" />
                      {t('storyChunksViewer.detailedStory', 'Detailed Story')}
                    </h3>
                    
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                      <button
                        onClick={() => setViewMode('chunks')}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                          viewMode === 'chunks'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                        }`}
                      >
                        <Layers className="w-4 h-4 inline mr-1" />
                        {t('storyChunksViewer.chunks', 'Chunks')}
                      </button>
                      <button
                        onClick={() => setViewMode('full')}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                          viewMode === 'full'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                        }`}
                      >
                        <FileText className="w-4 h-4 inline mr-1" />
                        {t('storyChunksViewer.fullText', 'Full Text')}
                      </button>
                    </div>
                  </div>

                  {/* Integrity Status */}
                  {storyData.integrity && (
                    <div className="mb-4">
                      {storyData.integrity.missing.length === 0 && storyData.integrity.lengthMatch && storyData.integrity.hashMatch === true ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-500/70 dark:border-green-400/60 text-green-600 dark:text-green-300 text-xs sm:text-sm font-medium bg-transparent">
                          <Check className="w-4 h-4" />
                          <span>{t('storyChunksViewer.integrityVerified')}</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/70 dark:border-amber-400/60 text-amber-600 dark:text-amber-300 text-xs sm:text-sm font-medium bg-transparent">
                          <AlertCircle className="w-4 h-4" />
                          <span>{t('storyChunksViewer.integrityWarning')}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {storyData.loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span className="ml-3 text-gray-600 dark:text-gray-400">
                        {t('storyChunksViewer.loading', 'Loading story chunks...')}
                      </span>
                    </div>
                  ) : storyData.error ? (
                    <div className="text-center py-12">
                      <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                      <p className="text-red-600 dark:text-red-400">{storyData.error}</p>
                    </div>
                  ) : viewMode === 'chunks' && storyData.chunks.length > 0 ? (
                    <div className="space-y-3">
                      {storyData.chunks.map((chunk) => {
                        const isExpanded = expandedChunks.has(chunk.chunkIndex)
                        const preview = chunk.content.length > 150 ? `${chunk.content.slice(0, 150)}...` : chunk.content
                        
                        return (
                          <div key={chunk.chunkIndex} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                            <button
                              onClick={() => toggleChunk(chunk.chunkIndex)}
                              className="w-full text-left flex items-start gap-3"
                            >
                              <span className="mt-1 text-gray-400">
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </span>
                              
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-medium text-gray-900 dark:text-gray-100">
                                    {t('storyChunksViewer.chunkTitle', 'Chunk #{{index}}', { index: chunk.chunkIndex })}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {chunk.content.length} {t('storyChunksViewer.characters', 'characters')}
                                  </span>
                                </div>
                                
                                <div className={`text-sm text-gray-700 dark:text-gray-300 ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}>
                                  {isExpanded ? chunk.content : preview}
                                </div>
                                
                                <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(chunk.timestamp * 1000).toLocaleString()}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <User className="w-3 h-3" />
                                    {chunk.lastEditor.slice(0, 8)}...
                                  </span>
                                </div>
                              </div>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : viewMode === 'full' && storyData.fullStory ? (
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                          {storyData.fullStory}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">
                        {t('storyChunksViewer.noStoryData', 'No story data available')}
                      </p>
                    </div>
                  )}
                </div>
              ) : person.story ? (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    {t('storyChunksViewer.basicStory', 'Basic Story')}
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                    <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {person.story}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Book className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {t('storyChunksViewer.noStory', 'No story content available')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}