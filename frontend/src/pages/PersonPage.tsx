import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Edit2, Clock, ChevronDown, ChevronRight, FileText, List, GitBranch, Clipboard, Hash, Link, User, Layers } from 'lucide-react'
import { StoryChunk, StoryMetadata, genderText as genderTextFn, formatYMD, formatUnixSeconds, formatHashMiddle, shortAddress } from '../types/graph'
import { useConfig } from '../context/ConfigContext'
import { useTreeData } from '../context/TreeDataContext'
import { useToast } from '../components/ToastProvider'
import { ethers } from 'ethers'
import { computeStoryHash } from '../lib/story'
import { getChunkTypeOptions, getChunkTypeI18nKey, getChunkTypeIcon, getChunkTypeColorClass, getChunkTypeBorderColorClass } from '../constants/chunkTypes'

function computeStoryIntegrity(chunks: StoryChunk[], metadata: StoryMetadata){
  const sorted = [...chunks].sort((a,b)=>a.chunkIndex-b.chunkIndex);
  const missing: number[] = [];
  for (let i=0;i<metadata.totalChunks;i++){ if(!sorted.find(c=>c.chunkIndex===i)) missing.push(i); }
  const fullStory = sorted.map(c=>c.content).join('');
  const encoder = new TextEncoder();
  const computedLength = sorted.reduce((acc,c)=> acc + encoder.encode(c.content).length, 0);
  const lengthMatch = computedLength === metadata.totalLength;
  let hashMatch: boolean | null = null; let computedHash: string | undefined;
  if (missing.length===0 && metadata.totalChunks>0 && metadata.fullStoryHash && metadata.fullStoryHash !== ethers.ZeroHash){
    try {
      computedHash = computeStoryHash(sorted);
      hashMatch = computedHash === metadata.fullStoryHash;
    } catch { /* ignore */ }
  }
  return { fullStory, integrity: { missing, lengthMatch, hashMatch, computedLength, computedHash } };
}

interface StoryDetailData {
  tokenId: string
  personHash?: string
  versionIndex?: number
  fullName?: string
  storyMetadata?: StoryMetadata
  storyChunks?: StoryChunk[]
  fullStory?: string
  owner?: string
  nftCoreInfo?: {
    gender?: number
    birthYear?: number
    birthMonth?: number
    birthDay?: number
    birthPlace?: string
    isBirthBC?: boolean
    deathYear?: number
    deathMonth?: number
    deathDay?: number
    deathPlace?: string
    isDeathBC?: boolean
    story?: string
  }
  integrity?: {
    missing: number[]
    lengthMatch: boolean
    hashMatch: boolean | null
    computedLength: number
    computedHash?: string
  }
}

export default function PersonPage() {
  const { tokenId } = useParams<{ tokenId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  // Config used in child components (HashAndIndexLine) via useConfig
  const { getStoryData, getNodeByTokenId, getOwnerOf, nodesData } = useTreeData()
  const config = useConfig()
  const { strictCacheOnly } = config
  const toast = useToast()
  
  const [data, setData] = useState<StoryDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'sections' | 'paragraph' | 'raw'>('sections')
  const [activeSection, setActiveSection] = useState<string | number | null>(null)
  const prefetched = (location.state as any)?.prefetchedStory as Partial<StoryDetailData> | undefined
  const dataRef = useRef<StoryDetailData | null>(null)
  const sectionRefs = useRef<Map<string | number, HTMLElement>>(new Map())
  const [leftNavHeight, setLeftNavHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'instant' as any })
    } catch {
      window.scrollTo(0, 0)
    }
  }, [tokenId])

  useEffect(() => {
    const mainEl = document.querySelector('.xl\\:col-span-3.space-y-6') as HTMLElement | null
    if (!mainEl) return
    const update = () => setLeftNavHeight(mainEl.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(mainEl)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [viewMode, data?.storyChunks?.length])

  // Dynamic title: person name + archive
  useEffect(()=>{
    if (data?.fullName) {
      document.title = t('person.pageTitle', { name: data.fullName })
    }
  }, [data?.fullName, t])

  const formatDate = (ts?: number) => formatUnixSeconds(ts)

  const chunkTypeOptions = useMemo(() => getChunkTypeOptions(t), [t])

  const convertChunkTypeToNumber = useCallback((type: number | string | null | undefined): number => {
    if (type === null || type === undefined || type === '') return 0
    if (typeof type === 'number' && Number.isFinite(type)) return type
    if (typeof type === 'string') {
      const trimmed = type.trim()
      if (!trimmed) return 0
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const parsed = Number(type as any)
    return Number.isFinite(parsed) ? parsed : 0
  }, [])

  const getChunkTypeLabel = useCallback(
    (type: number | string | null | undefined) => {
      const numericType = convertChunkTypeToNumber(type)
      const match = chunkTypeOptions.find(opt => opt.value === numericType)
      return match ? match.label : t('storyChunkEditor.chunkTypes.unknown', 'Unknown')
    },
    [chunkTypeOptions, convertChunkTypeToNumber, t]
  )

  const resolveAttachmentUrl = useCallback((cid: string) => {
    if (!cid) return ''
    if (cid.startsWith('ipfs://')) {
      return `https://ipfs.io/ipfs/${cid.slice(7)}`
    }
    return cid
  }, [])

  const fullStoryParagraphs = useMemo(() => {
    if (!data?.fullStory) return []
    if (viewMode === 'raw') return []
    const raw = data.fullStory.replace(/\r\n/g, '\n').trim()
    let parts = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    if (parts.length <= 1) {
      const sentencePieces = raw
        .split(/(?<=[。．\.?!！？])\s+(?=\S)/)
        .map(s => s.trim())
        .filter(Boolean)
      if (sentencePieces.length > 1) {
        const grouped: string[] = []
        let buffer = ''
        for (const s of sentencePieces) {
          if (buffer && (buffer + ' ' + s).length > 240) {
            grouped.push(buffer.trim())
            buffer = s
          } else {
            buffer = buffer ? buffer + ' ' + s : s
          }
        }
        if (buffer) grouped.push(buffer.trim())
        parts = grouped
      }
    }
    if (parts.length <= 1) {
      const lineSplit = raw.split(/\n/).map(l => l.trim()).filter(Boolean)
      if (lineSplit.length > 1 && lineSplit.length < 50) {
        parts = lineSplit
      }
    }
    return parts
  }, [data?.fullStory, viewMode])

  const chunkParagraphs = useMemo(() => {
    if (!data?.storyChunks || data.storyChunks.length === 0) return []
    return [...data.storyChunks]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(c => c.content)
  }, [data?.storyChunks])

  // Group chunks by type for sections view
  const groupedChunks = useMemo(() => {
    if (!data?.storyChunks || data.storyChunks.length === 0) return []
    
    const groups = new Map<number, StoryChunk[]>()
    data.storyChunks.forEach(chunk => {
      const type = chunk.chunkType ?? 0
      if (!groups.has(type)) {
        groups.set(type, [])
      }
      groups.get(type)!.push(chunk)
    })
    
    // Sort groups by type value, then sort chunks within each group by index
    return Array.from(groups.entries())
      .sort(([typeA], [typeB]) => typeA - typeB)
      .map(([type, chunks]) => ({
        type,
        chunks: chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
      }))
  }, [data?.storyChunks])

  const toggleChunk = (idx: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  // When ?edit=1 is present, navigate to editor in the same tab with prefetched data,
  // and clean the current URL first to avoid redirect loop on back navigation.
  useEffect(() => {
    const qs = new URLSearchParams(location.search)
    const wantEdit = qs.get('edit') === '1'
    if (wantEdit && tokenId) {
      // 1) Clean current URL (remove edit=1) in-place
      const params = new URLSearchParams(location.search)
      params.delete('edit')
      const nextSearch = params.toString()
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
      // 2) Push editor route with optional prefetched data
      const state: any = {}
      if (data?.storyMetadata || data?.storyChunks) {
        state.prefetchedStory = { tokenId, storyMetadata: data?.storyMetadata, storyChunks: data?.storyChunks }
      }
      navigate(`/editor/${tokenId}`, { state })
    }
  }, [location.search, tokenId, data, navigate])

  // If we navigated here with prefetched story data (from StoryChunksModal), hydrate immediately
  useEffect(() => {
    if (!tokenId) return
    if (!prefetched) return
    if (prefetched.tokenId && String(prefetched.tokenId) !== String(tokenId)) return
    const initialFullStory =
      prefetched.fullStory ||
      (prefetched.storyChunks && prefetched.storyChunks.length > 0
        ? prefetched.storyChunks.map(c => c.content).join('')
        : undefined)
    setData(prev => prev || ({
      tokenId,
      personHash: prefetched.personHash,
      versionIndex: prefetched.versionIndex,
      fullName: prefetched.fullName,
      owner: prefetched.owner,
      nftCoreInfo: prefetched.nftCoreInfo,
      storyMetadata: prefetched.storyMetadata,
      storyChunks: prefetched.storyChunks?.map(chunk => ({
        ...chunk,
        chunkType: convertChunkTypeToNumber(chunk.chunkType),
        attachmentCID: chunk.attachmentCID ?? ''
      })),
      fullStory: initialFullStory
    } as StoryDetailData))
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetched?.tokenId])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Inline editor removed; navigation handles edit flow

  const fetchStoryData = useCallback(async () => {
    if (!tokenId) {
      setError(t('person.invalidTokenId', 'Invalid token ID'))
      setLoading(false)
      return
    }
    // Simple format validation: only allow non-negative integers
    if (!/^\d+$/.test(tokenId)) {
      setError(t('person.invalidTokenId', 'Invalid token ID'))
      setLoading(false)
      return
    }
    try {
      const hasExistingData = !!dataRef.current
      if (!hasExistingData) {
        setLoading(true)
      }
      setError(null)
      // 1) First try to hit in memory nodesData (no network required)
      let node: any | null = null
      for (const nd of Object.values(nodesData || {})) {
        if (nd?.tokenId && String(nd.tokenId) === String(tokenId)) { node = nd; break }
      }

      // 2) If no node found in memory, use getNodeByTokenId (internally checks local cache first, then decides whether to access network)
      if (!node) {
        node = await getNodeByTokenId(tokenId)
      }

      // 3) Story data: if node already has storyMetadata + storyChunks and not expired, use directly; otherwise call getStoryData
      let story: any | null = null
      if (node?.storyMetadata && Array.isArray(node?.storyChunks)) {
        const fetchedAt = Number(node.storyFetchedAt || 0)
        const isSealed = Boolean(node.storyMetadata?.isSealed)
        const ttl = isSealed ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 1000
        const expired = !fetchedAt || (Date.now() - fetchedAt > ttl)
        if (!expired || strictCacheOnly) {
          const { fullStory, integrity } = computeStoryIntegrity(node.storyChunks, node.storyMetadata)
          story = { metadata: node.storyMetadata, chunks: node.storyChunks, fullStory, integrity }
        }
      }
      if (!story) {
        story = await getStoryData(tokenId)
      }

      // 4) Owner: prefer cache, query chain if not available
      let ownerAddr: string | undefined = node?.owner
      if (!ownerAddr) ownerAddr = (await getOwnerOf(tokenId)) || undefined

      const nftCoreInfo = node ? {
        gender: node.gender,
        birthYear: node.birthYear,
        birthMonth: node.birthMonth,
        birthDay: node.birthDay,
        birthPlace: node.birthPlace,
        isBirthBC: node.isBirthBC,
        deathYear: node.deathYear,
        deathMonth: node.deathMonth,
        deathDay: node.deathDay,
        deathPlace: node.deathPlace,
        isDeathBC: node.isDeathBC,
        story: node.story || ''
      } : undefined

      setData({
        tokenId,
        personHash: node?.personHash,
        versionIndex: node?.versionIndex,
        fullName: node?.fullName,
        nftCoreInfo,
        storyMetadata: story?.metadata as StoryMetadata,
        storyChunks: story?.chunks as StoryChunk[],
        fullStory: story?.fullStory,
        owner: ownerAddr,
        integrity: story?.integrity as any
      })
    } catch (err: any) {
      // Parse error message
      const raw = err?.message || err?.shortMessage || ''
      const full = (typeof err === 'object') ? JSON.stringify(err) : ''
      const lower = (raw + full).toLowerCase()
      let friendly: string | null = null
      if (lower.includes('invalidtokenid') || lower.includes('invalid token id')) {
        friendly = t('person.invalidTokenId', 'Invalid token ID')
      } else if (lower.includes('nonexistent token') || lower.includes('query for nonexistent token') || lower.includes('token does not exist')) {
        friendly = t('person.nonexistentToken', 'Token does not exist')
      } else if (lower.includes('execution reverted')) {
        // Generic revert type
        friendly = t('person.fetchFailed', 'Failed to load token')
      }
      setError(friendly || raw || 'Failed to fetch story data')
    } finally {
      setLoading(false)
    }
  }, [tokenId, t, nodesData, strictCacheOnly])

  useEffect(() => {
    fetchStoryData()
  }, [fetchStoryData])

  // Scroll spy for sections (supports top-level anchors and prioritizes group sections)
  useEffect(() => {
    if (viewMode !== 'sections' || groupedChunks.length === 0) return

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 80 // align with scrollToSection offset

      const entries: Array<{ key: string | number; top: number }> = []
      sectionRefs.current.forEach((el, key) => {
        entries.push({ key, top: el.offsetTop })
      })

      let nextActive: string | number | null = null

      // 1) Prioritize numeric group sections, compute ranges by next section top
      const numericEntries = entries.filter(e => typeof e.key === 'number').sort((a, b) => a.top - b.top)
      for (let i = 0; i < numericEntries.length; i++) {
        const curr = numericEntries[i]
        const nextTop = i < numericEntries.length - 1 ? numericEntries[i + 1].top : Number.POSITIVE_INFINITY
        if (scrollPosition >= curr.top && scrollPosition < nextTop) {
          nextActive = curr.key
          break
        }
      }
      // If at document bottom, force last numeric group active
      if (nextActive === null && numericEntries.length) {
        const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
        if (nearBottom) {
          nextActive = numericEntries[numericEntries.length - 1].key
        }
      }

      // 2) Basic Info
      if (nextActive === null) {
        const basic = entries.find(e => e.key === 'basicInfo')
        if (basic && scrollPosition >= basic.top) {
          const anchorTops = entries.filter(e => typeof e.key === 'number' || e.key === 'profileTop').map(e => e.top)
          const firstAnchorTop = anchorTops.length ? Math.min(...anchorTops) : Number.POSITIVE_INFINITY
          if (scrollPosition < firstAnchorTop) nextActive = 'basicInfo'
        }
      }

      // 3) Person Profile container
      if (nextActive === null) {
        const prof = entries.find(e => e.key === 'profileTop')
        if (prof && scrollPosition >= prof.top) {
          const firstGroupTop = numericEntries.length ? numericEntries[0].top : Number.POSITIVE_INFINITY
          if (scrollPosition < firstGroupTop) nextActive = 'profileTop'
        }
      }

      if (nextActive !== null && nextActive !== activeSection) {
        setActiveSection(nextActive)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll() // Initial check

    return () => window.removeEventListener('scroll', handleScroll)
  }, [viewMode, groupedChunks, activeSection])

  // Scroll to section
  const scrollToSection = useCallback((key: number | string) => {
    const element = sectionRefs.current.get(key)
    if (element) {
      setActiveSection(key) // immediate highlight on click
      const top = element.offsetTop - 80 // offset for header
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }, [setActiveSection])

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
  }, [t, toast])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse w-full max-w-4xl px-4">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-6" />
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-2/3" />
          </div>
        </div>
      </div>
    )
  }

  // Removed full-page error return; show inline alert instead
  // if (error || !data) { ... }

  return (
    <div>

      {/* Inline error alert (content area) */}
      {error && (
        <div className="pb-4">
          <div
            role="alert"
            className="mb-6 flex flex-col sm:flex-row sm:items-start gap-4 rounded-xl border border-red-300 dark:border-red-700/50 bg-red-50/80 dark:bg-red-900/30 p-5 shadow-sm"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
                {t('person.fetchFailed', 'Failed to load token')}
              </p>
              <p className="text-sm text-red-600 dark:text-red-200 break-words">{error}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => fetchStoryData()}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 text-white shadow-sm"
              >
                {t('common.retry', 'Retry')}
              </button>
              <button
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1)
                  } else {
                    navigate('/')
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800/40 bg-white dark:bg-transparent"
              >
                {t('common.goBack', 'Go Back')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content only if data present and no error */}
      {!error && data && (
        <>
          {/* Section Navigation - Left Sidebar (only for sections mode with chunks) */}
          {viewMode === 'sections' && groupedChunks.length > 0 && (
            <div className="hidden xl:block fixed left-[calc((100vw-1280px)/2-204px)] top-[104px] w-56 max-h-[calc(100vh-104px-64px)] z-10" style={{ height: leftNavHeight ? `${leftNavHeight}px` : undefined }}>
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col h-full">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 rounded-t-lg">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('person.sectionNav', '目录')}
                  </h4>
                </div>
                <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] overscroll-y-contain">
                  {/* 一级：基本信息 */}
                  {(() => {
                    const isActive = activeSection === 'basicInfo'
                    return (
                      <button
                        onClick={() => scrollToSection('basicInfo')}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-600 dark:border-blue-400'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-transparent'
                        }`}
                      >
                        <User size={14} className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'} />
                        <span className={`flex-1 truncate ${isActive ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {t('person.basicInfo','基本信息')}
                        </span>
                      </button>
                    )
                  })()}

                  {/* 一级：人物资料 */}
                  {(() => {
                    const isGroupActive = typeof activeSection === 'number' || activeSection === 'profileTop'
                    const totalCount = data?.storyChunks?.length || 0
                    return (
                      <button
                        onClick={() => scrollToSection('profileTop')}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                          isGroupActive
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-600 dark:border-blue-400'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-transparent'
                        }`}
                      >
                        <Layers size={14} className={isGroupActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'} />
                        <span className={`flex-1 truncate ${isGroupActive ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {t('person.profileData','Profile Data')}
                        </span>
                        <span className={`text-xs ${isGroupActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>{totalCount}</span>
                      </button>
                    )
                  })()}

                  {/* 二级：人物资料下的分组 */}
                  {groupedChunks.map(({ type, chunks }) => {
                    const ChunkIcon = getChunkTypeIcon(type)
                    const colorClass = getChunkTypeColorClass(type)
                    const typeLabel = t(getChunkTypeI18nKey(type), chunkTypeOptions.find(opt => opt.value === type)?.label || 'Unknown')
                    const isActive = activeSection === type
                    
                    return (
                      <button
                        key={type}
                        onClick={() => scrollToSection(type)}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors pl-7 ${
                          isActive 
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-600 dark:border-blue-400' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-transparent'
                        }`}
                      >
                        <ChunkIcon size={14} className={isActive ? 'text-blue-600 dark:text-blue-400' : colorClass} />
                        <span className={`flex-1 truncate ${isActive ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {typeLabel}
                        </span>
                        <span className={`text-xs ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                          {chunks.length}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          
          {/* Existing body content below */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start pb-[67vh]">
              <div className="xl:col-span-3 space-y-6">
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  {data && (data.fullName || data.nftCoreInfo) && (
                    <div className="p-5 border-b border-gray-200 dark:border-gray-800">
                      {/* Title row */}
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <h1 className="text-2xl sm:text-3xl font-normal text-gray-900 dark:text-gray-100" title={data.fullName || `Token #${data.tokenId}`}>
                              {data.fullName || `Token #${data.tokenId}`}
                            </h1>
                            <span className="text-sm sm:text-3xl text-gray-500 dark:text-gray-400 font-normal whitespace-nowrap">
                              {t('person.encyclopedia', 'Encyclopedia')}
                            </span>
                          </div>
                        </div>
                        {/* Family Tree View Button */}
                        {data.personHash && data.versionIndex !== undefined && (
                          <button
                            onClick={() => {
                              config.update({ rootHash: data.personHash, rootVersionIndex: data.versionIndex })
                              navigate(`/familyTree?root=${data.personHash}&v=${data.versionIndex}`)
                            }}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors"
                            title={t('person.viewFamilyTree', 'View Family Tree') as string}
                          >
                            <GitBranch size={16} />
                            <span className="hidden sm:inline">{t('person.viewFamilyTree', 'View Family Tree')}</span>
                          </button>
                        )}
                      </div>

                      {/* Integrity warnings - only if has issues */}
                      {data.integrity && data.storyMetadata && data.storyMetadata.totalChunks > 0 &&
                       (data.integrity.missing.length > 0 || !data.integrity.lengthMatch || data.integrity.hashMatch === false) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-4 pb-4 border-b border-gray-200 dark:border-gray-800">
                          {data.integrity.missing.length>0 && <span>⚠ {t('person.integrityMissing', 'Missing indices: {{indices}}', { indices: data.integrity.missing.join(',') })}</span>}
                          {!data.integrity.lengthMatch && <span>⚠ {t('person.integrityLenDiff', 'Length mismatch local={{local}} bytes', { local: data.integrity.computedLength })}</span>}
                          {data.integrity.hashMatch === false && <span>⚠ {t('person.integrityLocalHashMismatch', 'Local hash mismatch')}</span>}
                        </div>
                      )}

                      {/* Divider - full width */}
                      <div className="-mx-5 border-t border-gray-200 dark:border-gray-800 mb-4"></div>

                      {/* Basic Info section */}
                      <h3
                        ref={(el) => {
                          if (el) {
                            sectionRefs.current.set('basicInfo', el)
                          } else {
                            sectionRefs.current.delete('basicInfo')
                          }
                        }}
                        id="basic-info"
                        className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 scroll-mt-20"
                      >
                        {t('person.basicInfo','Basic Info')}
                      </h3>
                      <div className="space-y-3 text-sm sm:text-base">
                        {data.fullName && (
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                            <span className="text-gray-500 dark:text-gray-400 sm:w-24 flex-shrink-0">{t('familyTree.nodeDetail.fullName', 'Full Name')}</span>
                            <span className="text-gray-900 dark:text-gray-100 font-medium">{data.fullName}</span>
                          </div>
                        )}

                        {data.nftCoreInfo?.gender !== undefined && data.nftCoreInfo.gender > 0 && (
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                            <span className="text-gray-500 dark:text-gray-400 sm:w-24 flex-shrink-0">{t('familyTree.nodeDetail.gender', 'Gender')}</span>
                            <span className="text-gray-900 dark:text-gray-100 font-medium">{genderTextFn(data.nftCoreInfo.gender, t as any) || '-'}</span>
                          </div>
                        )}

                        {data.nftCoreInfo && (data.nftCoreInfo.birthYear || data.nftCoreInfo.birthPlace) && (
                          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                            <span className="text-gray-500 dark:text-gray-400 sm:w-24 flex-shrink-0">{t('familyTree.nodeDetail.birth', 'Birth')}</span>
                            <span className="text-gray-900 dark:text-gray-100 font-medium">
                              {(() => {
                                const d = formatYMD(data.nftCoreInfo!.birthYear, data.nftCoreInfo!.birthMonth, data.nftCoreInfo!.birthDay, data.nftCoreInfo!.isBirthBC)
                                const parts = [d, data.nftCoreInfo!.birthPlace].filter(Boolean)
                                return parts.join(' · ')
                              })()}
                            </span>
                          </div>
                        )}

                        {data.nftCoreInfo && (data.nftCoreInfo.deathYear || data.nftCoreInfo.deathPlace) && (
                          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                            <span className="text-gray-500 dark:text-gray-400 sm:w-24 flex-shrink-0">{t('familyTree.nodeDetail.death', 'Death')}</span>
                            <span className="text-gray-900 dark:text-gray-100 font-medium">
                              {(() => {
                                const d = formatYMD(data.nftCoreInfo!.deathYear, data.nftCoreInfo!.deathMonth, data.nftCoreInfo!.deathDay, data.nftCoreInfo!.isDeathBC)
                                const parts = [d, data.nftCoreInfo!.deathPlace].filter(Boolean)
                                return parts.join(' · ')
                              })()}
                            </span>
                          </div>
                        )}

                        {data.nftCoreInfo?.story && data.nftCoreInfo.story.trim() !== '' && (
                          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 pt-1">
                            <span className="text-gray-500 dark:text-gray-400 sm:w-24 flex-shrink-0">{t('familyTree.nodeDetail.story', 'Story')}</span>
                            <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                              {data.nftCoreInfo.story}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
                          {t('person.profileData', 'Profile Data')}
                        </h3>
                        {data?.storyMetadata?.isSealed ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20">
                            {t('person.sealed', 'Sealed')}
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              if (!tokenId) return
                              window.open(`/editor/${tokenId}`, '_blank', 'noopener,noreferrer')
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 border border-green-200/60 dark:border-green-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                            aria-label={t('familyTree.nodeDetail.editStory', 'Edit Story') as string}
                            title={t('familyTree.nodeDetail.editStory', 'Edit Story') as string}
                          >
                            <Edit2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                            <span className="hidden sm:inline text-[13px] font-semibold text-green-700 dark:text-green-400">
                              {t('familyTree.nodeDetail.edit', 'Edit')}
                            </span>
                          </button>
                        )}
                      </div>
                      {data && data.fullStory && data.fullStory.length > 0 && (
                        <div className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600">
                          <button
                            onClick={() => setViewMode('sections')}
                            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${viewMode === 'sections' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            title={t('person.viewSections', 'Sections Mode') as string}
                          >
                            <Layers size={14} />
                            <span className="hidden sm:inline">{t('person.sections', 'Sections')}</span>
                          </button>
                          <div className="w-px h-4 bg-gray-300 dark:border-gray-600"></div>
                          <button
                            onClick={() => setViewMode('paragraph')}
                            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${viewMode === 'paragraph' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            title={t('person.viewParagraph', 'Paragraph Mode') as string}
                          >
                            <List size={14} />
                            <span className="hidden sm:inline">{t('person.paragraph', 'Paragraph')}</span>
                          </button>
                          <div className="w-px h-4 bg-gray-300 dark:border-gray-600"></div>
                          <button
                            onClick={() => setViewMode('raw')}
                            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${viewMode === 'raw' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            title={t('person.viewRaw', 'Raw Mode') as string}
                          >
                            <FileText size={14} />
                            <span className="hidden sm:inline">{t('person.raw', 'Raw')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {/* Integrity warning - only show if there are issues */}
                    {data && data.storyMetadata && data.storyMetadata.totalChunks > 0 && data.integrity && (() => {
                      const integ = data.integrity
                      const hasIssues = integ.missing.length > 0 || !integ.lengthMatch || integ.hashMatch === false
                      if (!hasIssues) return null
                      return (
                        <div className="mb-4">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            ⚠ {t('person.integrityWarn','Integrity Warning')}
                          </span>
                        </div>
                      )
                    })()}
                    
                    {viewMode === 'sections' && groupedChunks.length > 0 ? (
                      <div
                        ref={(el) => {
                          if (el) {
                            sectionRefs.current.set('profileTop', el)
                          } else {
                            sectionRefs.current.delete('profileTop')
                          }
                        }}
                        id="person-profile-top"
                        className="space-y-6"
                      >
                        {groupedChunks.map(({ type, chunks }) => {
                          const ChunkIcon = getChunkTypeIcon(type)
                          const colorClass = getChunkTypeColorClass(type)
                          const typeLabel = t(getChunkTypeI18nKey(type), chunkTypeOptions.find(opt => opt.value === type)?.label || 'Unknown')
                          
                          return (
                            <div 
                              key={type} 
                              ref={(el) => {
                                if (el) {
                                  sectionRefs.current.set(type, el)
                                } else {
                                  sectionRefs.current.delete(type)
                                }
                              }}
                              id={`section-${type}`}
                              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden scroll-mt-20"
                            >
                              <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                                <div className="flex items-center gap-2">
                                  <ChunkIcon size={18} className={colorClass} />
                                  <h4 className={`text-base font-semibold ${colorClass}`}>
                                    {typeLabel}
                                  </h4>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-full">
                                    {chunks.length}
                                  </span>
                                </div>
                              </div>
                              <div className="p-4 space-y-3">
                                {chunks.map(chunk => (
                                  <div key={chunk.chunkIndex} className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                                    <p className="whitespace-pre-wrap">{chunk.content}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : viewMode === 'paragraph' && fullStoryParagraphs.length > 0 ? (
                      <div className="space-y-4 text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                        {chunkParagraphs.length > 0 ? (
                          chunkParagraphs.map((content, i) => (
                            <p key={i} className="whitespace-pre-wrap">{content}</p>
                          ))
                        ) : (
                          fullStoryParagraphs.map((p, i) => (
                            <p key={i} className="whitespace-pre-wrap">{p}</p>
                          ))
                        )}
                      </div>
                    ) : viewMode === 'paragraph' && fullStoryParagraphs.length === 0 && data && data.fullStory ? (
                      <div className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                        <p className="whitespace-pre-wrap">{data.fullStory}</p>
                      </div>
                    ) : viewMode === 'raw' && data && data.fullStory ? (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700">
                        <pre className="font-mono text-xs sm:text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto">{data.fullStory}</pre>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-gray-400 dark:text-gray-500 text-sm">
                          {t('person.noProfileData', 'No profile data')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                {data && data.storyMetadata && (
                  <div className="xl:hidden bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {t('person.metadata', 'Metadata')}
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">{t('person.tokenId', 'Token ID')}</div>
                          <div className="font-mono font-medium text-gray-900 dark:text-gray-100">#{data.tokenId}</div>
                        </div>
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">{t('person.totalChunks', 'Total Chunks')}</div>
                          <div className="font-mono font-medium text-gray-900 dark:text-gray-100">{data.storyMetadata.totalChunks}</div>
                        </div>
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">{t('person.totalLength', 'Total Length')}</div>
                          <div className="font-mono font-medium text-gray-900 dark:text-gray-100">{data.storyMetadata.totalLength}</div>
                        </div>
                      </div>
                      <div className="text-sm mb-3 pb-3 border-b border-gray-200 dark:border-gray-800">
                        <div className="text-gray-500 dark:text-gray-400 mb-1 text-xs">{t('person.lastUpdate', 'Last Update')}</div>
                        <div className="font-mono text-xs text-gray-700 dark:text-gray-300">{formatDate(data.storyMetadata.lastUpdateTime)}</div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.storyHash', 'Story Hash')}</div>
                          <div className="flex items-center">
                            <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 min-w-0 border border-gray-200 dark:border-gray-700">
                              {data.storyMetadata.fullStoryHash}
                            </div>
                            <button
                              onClick={() => copyText(data.storyMetadata!.fullStoryHash)}
                              aria-label={t('search.copy')}
                              className="shrink-0 ml-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                              title={t('search.copy')}
                            >
                              <Clipboard size={14} />
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.owner', 'Owner Address')}</div>
                          <div className="flex items-center">
                            <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 min-w-0 border border-gray-200 dark:border-gray-700" title={data.owner}>
                              {data.owner || '-'}
                            </div>
                            {data.owner && (
                              <button
                                onClick={() => copyText(data.owner!)}
                                aria-label={t('search.copy')}
                                className="shrink-0 ml-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                title={t('search.copy')}
                              >
                                <Clipboard size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {data.personHash && (
                          <div>
                            <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.personHashLabel', 'Person Hash')}</div>
                            <div className="flex items-center">
                              <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 min-w-0 border border-gray-200 dark:border-gray-700">
                                {data.personHash}
                              </div>
                              <button
                                onClick={() => copyText(data.personHash!)}
                                aria-label={t('search.copy')}
                                className="shrink-0 ml-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                title={t('search.copy')}
                              >
                                <Clipboard size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                        {data.versionIndex !== undefined && data.versionIndex > 0 && (
                          <div>
                            <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.versionLabel', 'Version:')}</div>
                            <div className="flex items-center">
                              <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 min-w-0 border border-gray-200 dark:border-gray-700">
                                {data.versionIndex}
                              </div>
                              <button
                                onClick={() => copyText(`${data.versionIndex}`)}
                                aria-label={t('search.copy')}
                                className="shrink-0 ml-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                title={t('search.copy')}
                              >
                                <Clipboard size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {t('person.chunkList', 'Chunk List')}
                      {data && data.storyChunks && data.storyChunks.length > 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                          {data.storyChunks.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  {data && data.storyChunks && data.storyChunks.length > 0 ? (
                    <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[500px] overflow-y-auto [scrollbar-gutter:stable]">
                      {data.storyChunks
                        .sort((a, b) => a.chunkIndex - b.chunkIndex)
                        .map((chunk) => {
                          const open = expandedChunks.has(chunk.chunkIndex)
                          const preview = chunk.content.length > 60 ? `${chunk.content.slice(0, 60)}...` : chunk.content
                          return (
                            <div key={chunk.chunkIndex} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
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
                                <span className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0">
                                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
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
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                      {chunk.content.length}
                                    </span>
                                  </div>
                                  <div className={`text-xs text-gray-600 dark:text-gray-400 ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                                    {open ? chunk.content : preview}
                                  </div>
                                  {open && (
                                    <div className="space-y-1 mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <User size={12} className="flex-shrink-0" />
                                        {chunk.editor ? (
                                          <>
                                            <span className="truncate" title={chunk.editor}>{shortAddress(chunk.editor)}</span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                copyText(chunk.editor)
                                              }}
                                              className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                              aria-label={t('search.copy')}
                                              title={t('search.copy')}
                                            >
                                              <Clipboard size={12} />
                                            </button>
                                          </>
                                        ) : (
                                          <span>-</span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <Clock size={12} className="flex-shrink-0" />
                                        <span>{formatUnixSeconds(chunk.timestamp)}</span>
                                      </div>
                                      {chunk.attachmentCID && chunk.attachmentCID.trim().length > 0 && (
                                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                          <Link size={12} className="flex-shrink-0" />
                                          <span className="truncate font-mono" title={chunk.attachmentCID}>
                                            {chunk.attachmentCID.length > 20 ? `${chunk.attachmentCID.slice(0, 8)}...${chunk.attachmentCID.slice(-8)}` : chunk.attachmentCID}
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              copyText(chunk.attachmentCID)
                                            }}
                                            className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                            aria-label={t('search.copy')}
                                            title={t('search.copy')}
                                          >
                                            <Clipboard size={12} />
                                          </button>
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <Hash size={12} className="flex-shrink-0" />
                                        <span className="font-mono truncate" title={chunk.chunkHash}>{formatHashMiddle(chunk.chunkHash)}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            copyText(chunk.chunkHash)
                                          }}
                                          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                          aria-label={t('search.copy')}
                                          title={t('search.copy')}
                                        >
                                          <Clipboard size={12} />
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
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-gray-400 dark:text-gray-500 text-sm">
                        {t('person.noChunks', 'No chunks')}
                      </p>
                    </div>
                  )}
                </div>

                {data && data.storyMetadata && (
                  <div className="hidden xl:block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <div className="px-4 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {t('person.metadata', 'Metadata')}
                      </h3>
                    </div>
                    <div className="p-4 space-y-2.5 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.tokenId', 'Token ID')}</span>
                        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">#{data.tokenId}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.totalChunks', 'Total Chunks')}</span>
                        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{data.storyMetadata.totalChunks}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.totalLength', 'Total Length')}</span>
                        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{data.storyMetadata.totalLength}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 dark:text-gray-400 text-xs">{t('person.lastUpdate', 'Last Update')}</span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{formatDate(data.storyMetadata.lastUpdateTime)}</span>
                      </div>
                    </div>
                    <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                      <div>
                        <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.storyHash', 'Story Hash')}</div>
                        <div className="flex items-center">
                          <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded-md select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                            {data.storyMetadata.fullStoryHash}
                          </div>
                          <button
                            onClick={() => copyText(data.storyMetadata!.fullStoryHash)}
                            aria-label={t('search.copy')}
                            className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            title={t('search.copy')}
                          >
                            <Clipboard size={12} />
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.owner', 'Owner Address')}</div>
                        <div className="flex items-center">
                          <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700" title={data.owner}>
                            {data.owner || '-'}
                          </div>
                          {data.owner && (
                            <button
                              onClick={() => copyText(data.owner!)}
                              aria-label={t('search.copy')}
                              className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                              title={t('search.copy')}
                            >
                              <Clipboard size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      {data.personHash && (
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.personHashLabel', 'Person Hash')}</div>
                          <div className="flex items-center">
                            <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded select-all text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                              {data.personHash}
                            </div>
                            <button
                              onClick={() => copyText(data.personHash!)}
                              aria-label={t('search.copy')}
                              className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                              title={t('search.copy')}
                            >
                              <Clipboard size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                      {data.versionIndex !== undefined && data.versionIndex > 0 && (
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 text-xs mb-1.5">{t('person.versionLabel', 'Version:')}</div>
                          <div className="flex items-center">
                            <div className="font-mono text-xs break-all leading-snug bg-gray-50 dark:bg-gray-800 px-1.5 py-1.5 rounded text-gray-600 dark:text-gray-400 flex-1 border border-gray-200 dark:border-gray-700">
                              {data.versionIndex}
                            </div>
                            <button
                              onClick={() => copyText(`${data.versionIndex}`)}
                              aria-label={t('search.copy')}
                              className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                              title={t('search.copy')}
                            >
                              <Clipboard size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
        </>
      )}

      {/* Editor moved to /editor/:tokenId */}
    </div>
  )
}
