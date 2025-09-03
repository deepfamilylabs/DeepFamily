import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useLocation, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Edit2, Clock, User, ChevronDown, ChevronRight, FileText, List, Copy, GitBranch, Clipboard } from 'lucide-react'
import { StoryChunk, StoryMetadata } from '../types/graph'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../components/ToastProvider'
import { ethers } from 'ethers'
import DeepFamily from '../abi/DeepFamily.json'
import StoryChunkEditor from '../components/StoryChunkEditor'
import Logo from '../components/Logo'
import HeaderControls from '../components/HeaderControls'

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
      // Contract logic: concatenation of all chunkHash (bytes32) values then keccak256
      const concatenated = '0x' + sorted.map(c => c.chunkHash.replace(/^0x/, '')).join('');
      computedHash = ethers.keccak256(concatenated);
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

export default function StoryDetailPage() {
  const { tokenId } = useParams<{ tokenId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { mode, rpcUrl, contractAddress } = useConfig()
  const toast = useToast()
  
  const [data, setData] = useState<StoryDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'paragraph' | 'raw'>('paragraph')

  const formatDate = (ts?: number) => {
    if (!ts) return '-'
    const d = new Date(ts * 1000)
    return d.toLocaleString()
  }

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

  // New: open editor automatically if ?edit=1 present
  useEffect(() => {
    const qs = new URLSearchParams(location.search)
    const wantEdit = qs.get('edit') === '1'
    setEditorOpen(wantEdit)
  }, [location.search])

  const closeEditor = () => {
    setEditorOpen(false)
    // Remove edit param if present
    if (location.search.includes('edit=1')) {
      const qs = new URLSearchParams(location.search)
      qs.delete('edit')
      navigate({ pathname: location.pathname, search: qs.toString() ? `?${qs.toString()}` : '' }, { replace: true })
    }
  }

  const fetchStoryData = useCallback(async () => {
    if (!tokenId || mode !== 'contract' || !rpcUrl || !contractAddress) {
      setError('Missing required configuration')
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, provider)
      const nftRet = await contract.getNFTDetails(tokenId)
      const personHash = nftRet[0]
      const versionIndex = Number(nftRet[1])
      const coreInfo = nftRet[3]
      const fullName = coreInfo.basicInfo.fullName
      const nftCoreInfo = {
        gender: Number(coreInfo.basicInfo.gender),
        birthYear: Number(coreInfo.basicInfo.birthYear),
        birthMonth: Number(coreInfo.basicInfo.birthMonth),
        birthDay: Number(coreInfo.basicInfo.birthDay),
        birthPlace: coreInfo.supplementInfo.birthPlace,
        isBirthBC: Boolean(coreInfo.basicInfo.isBirthBC),
        deathYear: Number(coreInfo.supplementInfo.deathYear),
        deathMonth: Number(coreInfo.supplementInfo.deathMonth),
        deathDay: Number(coreInfo.supplementInfo.deathDay),
        deathPlace: coreInfo.supplementInfo.deathPlace,
        isDeathBC: Boolean(coreInfo.supplementInfo.isDeathBC),
        story: coreInfo.supplementInfo.story || ''
      }
      const ownerAddr = await contract.ownerOf(tokenId)
      const metadata = await contract.getStoryMetadata(tokenId)
      const storyMetadata: StoryMetadata = {
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
            const chunk = await contract.getStoryChunk(tokenId, i)
            chunks.push({
              chunkIndex: Number(chunk.chunkIndex),
              chunkHash: chunk.chunkHash,
              content: chunk.content,
              timestamp: Number(chunk.timestamp),
              lastEditor: chunk.lastEditor
            })
          } catch (e) {
            // skip missing
          }
        }
      }
      const { fullStory, integrity } = computeStoryIntegrity(chunks, storyMetadata);
      setData({ tokenId, personHash, versionIndex, fullName, nftCoreInfo, storyMetadata, storyChunks: [...chunks].sort((a,b)=>a.chunkIndex-b.chunkIndex), fullStory, owner: ownerAddr, integrity })
    } catch (err: any) {
      setError(err.message || 'Failed to fetch story data')
    } finally {
      setLoading(false)
    }
  }, [tokenId, mode, rpcUrl, contractAddress])

  useEffect(() => {
    fetchStoryData()
  }, [fetchStoryData])

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

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">{error || t('storyDetail.notFound', 'Story not found')}</div>
          <button
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1)
              } else {
                window.close();
                setTimeout(() => navigate('/'), 100)
              }
            }}
            className="text-blue-600 hover:text-blue-800 underline"
          >
            {t('common.goBack', 'Go Back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900">
      <div className="bg-gradient-to-br from-blue-400/50 via-indigo-500/55 via-purple-500/50 to-violet-600/45 dark:from-blue-500/80 dark:via-indigo-600/85 dark:via-purple-600/80 dark:to-violet-700/75 backdrop-blur-3xl border-b border-white/20 dark:border-white/10 shadow-2xl shadow-blue-500/30 dark:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)] sticky top-0 z-30 relative">
        {/* Enhanced floating background shapes */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Primary floating orbs */}
          <div className="absolute -top-3 left-1/4 w-16 h-16 bg-gradient-to-br from-blue-400/20 via-cyan-400/15 to-teal-400/12 dark:from-blue-400/35 dark:via-cyan-400/30 dark:to-teal-400/25 rounded-full blur-xl animate-pulse-soft"></div>
          <div className="absolute -top-4 right-1/3 w-20 h-20 bg-gradient-to-br from-purple-400/15 via-violet-400/12 to-pink-400/10 dark:from-purple-400/30 dark:via-violet-400/25 dark:to-pink-400/20 rounded-full blur-2xl animate-float"></div>
          <div className="absolute -bottom-2 left-2/3 w-12 h-12 bg-gradient-to-br from-indigo-400/25 via-blue-400/20 to-cyan-400/15 dark:from-indigo-400/40 dark:via-blue-400/35 dark:to-cyan-400/30 rounded-full blur-lg animate-bounce-gentle"></div>
          
          {/* Secondary accent orbs */}
          <div className="absolute top-1 left-1/6 w-6 h-6 bg-gradient-to-br from-emerald-400/15 to-green-400/12 dark:from-emerald-400/25 dark:to-green-400/20 rounded-full blur-md animate-float delay-1000"></div>
          <div className="absolute -bottom-1 right-1/4 w-8 h-8 bg-gradient-to-br from-rose-400/12 to-orange-400/10 dark:from-rose-400/20 dark:to-orange-400/15 rounded-full blur-lg animate-pulse-soft delay-1000"></div>
        </div>
        
        {/* Multi-layer gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/2 to-white/5 dark:via-black/3 dark:to-black/8 pointer-events-none"></div>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-indigo-500/3 via-purple-500/5 to-violet-500/4 dark:from-blue-500/12 dark:via-indigo-500/8 dark:via-purple-500/12 dark:to-violet-500/8 pointer-events-none"></div>
        
        <div className="relative max-w-6xl mx-auto px-4 py-3">
          {/* Header container */}
          <div className="flex flex-col gap-4">
            {/* Row 1: Logo + brand / Language + Theme */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <NavLink to="/" className="flex items-center gap-3 group flex-shrink-0">
                  <Logo className="w-8 h-8 text-white dark:text-gray-100 group-hover:-rotate-90 transition-transform duration-300" />
                  <span className="text-lg sm:text-xl font-light tracking-widest uppercase text-white dark:text-gray-100" style={{fontFamily: 'system-ui, -apple-system, \"Segoe UI\", sans-serif', letterSpacing: '0.2em'}}>DeepFamily</span>
                </NavLink>
                <span className="text-sm sm:text-base md:text-lg text-white/85 dark:text-gray-200/85 font-medium tracking-wide whitespace-nowrap">{t('storyDetail.encyclopedia', 'Person Encyclopedia')}</span>
              </div>
              <HeaderControls variant="home" />
            </div>
            {/* Row 2: Title + stats / Actions (verify + edit) */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100 flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                  <span className="truncate max-w-[calc(100vw-120px)] sm:max-w-[calc(60vw-80px)] md:max-w-sm text-sm sm:text-base md:text-lg leading-none" title={data.fullName || `Token #${data.tokenId}`}>{data.fullName || `Token #${data.tokenId}`}</span>
                  <span className="text-gray-400 dark:text-gray-500 hidden xs:inline">/</span>
                  <span className="text-blue-600 dark:text-blue-400 font-semibold whitespace-nowrap text-sm sm:text-base md:text-lg leading-none">{t('storyDetail.title', "'s Biography")}</span>
                  {data.storyMetadata && data.storyMetadata.totalChunks > 0 && data.integrity && (() => {
                        const integ = data.integrity
                        const localOk = integ.missing.length === 0 && integ.lengthMatch && (integ.hashMatch === true)
                        let cls = 'inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full border text-[9px] sm:text-[10px] leading-tight'
                        let label: string | undefined
                        if (localOk) {
                          cls += ' bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-600/50 dark:text-green-300'
                          label = t('storyDetail.integrityFrontendOk','Integrity Frontend Verified') as string
                        } else {
                          cls += ' bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-600/50 dark:text-amber-300'
                          label = t('storyDetail.integrityWarn','Integrity Possibly Inconsistent') as string
                        }
                        return (<span className={cls}>{label}</span>)
                      })()}
                  {/* Moved HashAndIndexLine here to appear right after integrity badge */}
                  {data.personHash && (
                    <HashAndIndexLine
                      personHash={data.personHash}
                      versionIndex={data.versionIndex}
                      t={t}
                    />
                  )}
                </h1>
                {/* Removed original HashAndIndexLine placement below h1 */}
                {data.integrity && data.storyMetadata && data.storyMetadata.totalChunks > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 dark:text-gray-500/70 font-mono">
                    {data.integrity.missing.length>0 && <span>{t('storyDetail.integrityMissing', 'Missing indices: {{indices}}', { indices: data.integrity.missing.join(',') })}</span>}
                    {!data.integrity.lengthMatch && <span>{t('storyDetail.integrityLenDiff', 'Length mismatch local={{local}} bytes', { local: data.integrity.computedLength })}</span>}
                    {data.integrity.hashMatch === false && <span>{t('storyDetail.integrityLocalHashMismatch', 'Local hash mismatch')}</span>}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 md:pt-1">
                {data?.storyMetadata?.isSealed ? (
                  <div className="flex items-center justify-center px-3 h-7 bg-green-500 text-white rounded-md text-[10px] font-medium">
                    {t('storyDetail.sealed', 'Sealed')}
                  </div>
                ) : (
                  <button
                    onClick={() => setEditorOpen(true)}
                    aria-label={t('storyDetail.edit', 'Edit Biography') as string}
                    title={t('storyDetail.edit', 'Edit Biography') as string}
                    className="flex items-center justify-center w-8 h-7 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-[10px]"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          <div className="xl:col-span-3 space-y-6">
            <div className="bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-2xl shadow-gray-500/5 dark:shadow-gray-900/20 border border-gray-200/70 dark:border-gray-700/50 p-6 card-surface backdrop-blur-xl relative overflow-hidden group hover:shadow-3xl hover:shadow-gray-500/10 dark:hover:shadow-gray-900/30 transition-all duration-300">
              {/* Subtle background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-purple-50/20 dark:from-blue-900/10 dark:via-transparent dark:to-purple-900/5 pointer-events-none"></div>
              
              {data && (data.fullName || data.nftCoreInfo) && (
                <div className="relative mb-8 pb-8 border-b border-gray-100/80 dark:border-gray-700/40">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-8 tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                    {t('storyDetail.basicInfo','Basic Info')}
                  </h3>
                  <div className="space-y-5 font-mono text-gray-700 dark:text-gray-200 text-sm leading-relaxed tracking-wide selection:bg-indigo-100/70 dark:selection:bg-indigo-800/30">
                    {data.fullName && (
                      <div className="flex items-center gap-8 p-3 rounded-xl bg-gradient-to-r from-blue-50/50 to-cyan-50/30 dark:from-blue-900/20 dark:to-cyan-900/10 border border-blue-200/30 dark:border-blue-700/30">
                        <span className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold w-16 flex-shrink-0">{t('visualization.nodeDetail.fullName', 'Full Name')}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-bold text-lg">{data.fullName}</span>
                      </div>
                    )}

                    {data.nftCoreInfo?.gender !== undefined && data.nftCoreInfo.gender > 0 && (
                      <div className="flex items-center gap-8 p-3 rounded-xl bg-gradient-to-r from-purple-50/50 to-pink-50/30 dark:from-purple-900/20 dark:to-pink-900/10 border border-purple-200/30 dark:border-purple-700/30">
                        <span className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold w-16 flex-shrink-0">{t('visualization.nodeDetail.gender', 'Gender')}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-semibold">
                          {data.nftCoreInfo.gender === 1 ? t('visualization.nodeDetail.genders.male', 'Male') :
                           data.nftCoreInfo.gender === 2 ? t('visualization.nodeDetail.genders.female', 'Female') :
                           data.nftCoreInfo.gender === 3 ? t('visualization.nodeDetail.genders.other', 'Other') : '-'}
                        </span>
                      </div>
                    )}

                    {data.nftCoreInfo && (data.nftCoreInfo.birthYear || data.nftCoreInfo.birthPlace) && (
                      <div className="flex items-center gap-8 p-3 rounded-xl bg-gradient-to-r from-green-50/50 to-emerald-50/30 dark:from-green-900/20 dark:to-emerald-900/10 border border-green-200/30 dark:border-green-700/30">
                        <span className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold w-16 flex-shrink-0">{t('visualization.nodeDetail.birth', 'Birth')}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-semibold">
                          {(() => {
                            const parts: string[] = []
                            if (data.nftCoreInfo!.birthYear) {
                              let dateStr = `${data.nftCoreInfo!.isBirthBC ? t('visualization.nodeDetail.bcPrefix', 'BC') + ' ' : ''}${data.nftCoreInfo!.birthYear}`
                              if (data.nftCoreInfo!.birthMonth && data.nftCoreInfo!.birthMonth > 0) {
                                dateStr += `-${data.nftCoreInfo!.birthMonth.toString().padStart(2, '0')}`
                                if (data.nftCoreInfo!.birthDay && data.nftCoreInfo!.birthDay > 0) {
                                  dateStr += `-${data.nftCoreInfo!.birthDay.toString().padStart(2, '0')}`
                                }
                              }
                              parts.push(dateStr)
                            }
                            if (data.nftCoreInfo!.birthPlace) parts.push(data.nftCoreInfo!.birthPlace)
                            return parts.join(' · ')
                          })()}
                        </span>
                      </div>
                    )}

                    {data.nftCoreInfo && (data.nftCoreInfo.deathYear || data.nftCoreInfo.deathPlace) && (
                      <div className="flex items-center gap-8 p-3 rounded-xl bg-gradient-to-r from-gray-50/50 to-slate-50/30 dark:from-gray-900/20 dark:to-slate-900/10 border border-gray-200/30 dark:border-gray-700/30">
                        <span className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold w-16 flex-shrink-0">{t('visualization.nodeDetail.death', 'Death')}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-semibold">
                          {(() => {
                            const parts: string[] = []
                            if (data.nftCoreInfo!.deathYear) {
                              let dateStr = `${data.nftCoreInfo!.isDeathBC ? t('visualization.nodeDetail.bcPrefix', 'BC') + ' ' : ''}${data.nftCoreInfo!.deathYear}`
                              if (data.nftCoreInfo!.deathMonth && data.nftCoreInfo!.deathMonth > 0) {
                                dateStr += `-${data.nftCoreInfo!.deathMonth.toString().padStart(2, '0')}`
                                if (data.nftCoreInfo!.deathDay && data.nftCoreInfo!.deathDay > 0) {
                                  dateStr += `-${data.nftCoreInfo!.deathDay.toString().padStart(2, '0')}`
                                }
                              }
                              parts.push(dateStr)
                            }
                            if (data.nftCoreInfo!.deathPlace) parts.push(data.nftCoreInfo!.deathPlace)
                            return parts.join(' · ')
                          })()}
                        </span>
                      </div>
                    )}

                    {data.nftCoreInfo?.story && data.nftCoreInfo.story.trim() !== '' && (
                      <div className="flex items-start gap-8 flex-wrap sm:flex-nowrap p-4 rounded-xl bg-gradient-to-r from-amber-50/50 to-yellow-50/30 dark:from-amber-900/20 dark:to-yellow-900/10 border border-amber-200/30 dark:border-amber-700/30">
                        <span className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold w-16 flex-shrink-0 pt-1">{t('visualization.nodeDetail.story', 'Story')}</span>
                        <div className="text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap font-medium flex-1 min-w-0 break-words break-all sm:break-words">
                          {data.nftCoreInfo.story}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div className="relative flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                  {t('storyDetail.fullStory', 'Biography')}
                </h2>
                <div className="flex items-center gap-3">
                  {data && data.fullStory && data.fullStory.length > 0 && (
                    <div className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-700/50 bg-blue-50/50 dark:bg-blue-900/20 p-0.5 transition-colors">
                      <button
                        onClick={() => setViewMode('paragraph')}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'paragraph' ? 'bg-blue-600 text-white shadow-sm dark:shadow-blue-900/40' : 'text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40'}`}
                        title={t('storyDetail.viewParagraph', 'Paragraph Mode') as string}
                      >
                        <List size={14} />{t('storyDetail.paragraph', 'Paragraph')}
                      </button>
                      <button
                        onClick={() => setViewMode('raw')}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'raw' ? 'bg-blue-600 text-white shadow-sm dark:shadow-blue-900/40' : 'text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40'}`}
                        title={t('storyDetail.viewRaw', 'Raw Mode') as string}
                      >
                        <FileText size={14} />{t('storyDetail.raw', 'Raw')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {viewMode === 'paragraph' && fullStoryParagraphs.length > 0 ? (
                <div className="font-mono text-gray-700 dark:text-gray-200 text-xs sm:text-sm leading-loose tracking-wide space-y-3">
                  {chunkParagraphs.length > 0 ? (
                    chunkParagraphs.map((content, i) => (
                      <p key={i} className="whitespace-pre-wrap m-0 selection:bg-indigo-100/70 dark:selection:bg-indigo-800/30">{content}</p>
                    ))
                  ) : (
                    fullStoryParagraphs.map((p, i) => (
                      <p key={i} className="whitespace-pre-wrap m-0 selection:bg-indigo-100/70 dark:selection:bg-indigo-800/30">{p}</p>
                    ))
                  )}
                </div>
              ) : viewMode === 'paragraph' && fullStoryParagraphs.length === 0 && data && data.fullStory ? (
                <div className="font-mono text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-loose tracking-wide text-xs sm:text-sm selection:bg-indigo-100/70 dark:selection:bg-indigo-800/30">{data.fullStory}</div>
              ) : viewMode === 'raw' && data && data.fullStory ? (
                <div className="font-mono text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-loose tracking-wide text-xs sm:text-sm selection:bg-indigo-100/70 dark:selection:bg-indigo-800/30 overflow-x-auto p-4 story-content-surface dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">{data.fullStory}</div>
              ) : (
                <div className="text-gray-400 italic text-sm py-6 text-center">
                  {t('storyDetail.noStory', 'No biographical content')}
                </div>
              )}
            </div>
            {data && data.storyMetadata && (
              <div className="xl:hidden bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-2xl shadow-gray-500/5 dark:shadow-gray-900/20 border border-gray-200/70 dark:border-gray-700/50 p-6 space-y-5 card-surface backdrop-blur-xl relative overflow-hidden">
                {/* Subtle background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-cyan-50/15 dark:from-blue-900/10 dark:via-transparent dark:to-cyan-900/5 pointer-events-none rounded-2xl"></div>
                
                <h3 className="relative text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-4 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">{t('storyDetail.metadata', 'Metadata')}</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.tokenId', 'Token ID')}</dt><dd className="font-mono text-gray-800 dark:text-gray-200">#{data.tokenId}</dd></div>
                  <div><dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.totalChunks', 'Total Chunks')}</dt><dd className="font-mono text-gray-800 dark:text-gray-200">{data.storyMetadata.totalChunks}</dd></div>
                  <div><dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.totalLength', 'Total Length')}</dt><dd className="font-mono text-gray-800 dark:text-gray-200">{data.storyMetadata.totalLength}</dd></div>
                  <div className="col-span-2"><dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.lastUpdate', 'Last Update')}</dt><dd className="font-mono text-xs">{formatDate(data.storyMetadata.lastUpdateTime)}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.storyHash', 'Story Hash')}</dt>
                    <dd className="mt-1 flex items-center gap-1">
                      <div className="font-mono text-[9px] break-all bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded select-all text-gray-700 dark:text-gray-300">
                        {data.storyMetadata.fullStoryHash}
                      </div>
                      <button
                        onClick={() => copyText(data.storyMetadata!.fullStoryHash)}
                        aria-label={t('search.copy')}
                        className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        title={t('search.copy')}
                      >
                        <Clipboard size={14} />
                      </button>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.owner', 'Owner Address')}</dt>
                    <dd className="mt-1 flex items-center gap-1">
                      <div className="font-mono text-[9px] break-all bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded select-all text-gray-700 dark:text-gray-300" title={data.owner}>{data.owner || '-'}</div>
                      {data.owner && (
                        <button
                          onClick={() => copyText(data.owner!)}
                          aria-label={t('search.copy')}
                          className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          title={t('search.copy')}
                        >
                          <Clipboard size={14} />
                        </button>
                      )}
                    </dd>
                  </div>
                  {data.personHash && (
                    <div className="col-span-2">
                      <dt className="text-gray-500 dark:text-gray-400">{t('storyDetail.personHash', 'Person Hash')}</dt>
                      <dd className="mt-1 flex items-center gap-1">
                        <div className="font-mono text-[9px] break-all bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded select-all text-gray-700 dark:text-gray-300">
                          {data.personHash}
                        </div>
                        <button
                          onClick={() => copyText(data.personHash!)}
                          aria-label={t('search.copy')}
                          className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          title={t('search.copy')}
                        >
                          <Clipboard size={14} />
                        </button>
                      </dd>
                    </div>
                  )}
                  <div className="col-span-2 flex items-center justify-between pt-2 border-t">
                    <span className="text-gray-500 dark:text-gray-400">{t('storyDetail.status', 'Status')}</span>
                    <span className={`text-[10px] px-2 py-1 rounded-full uppercase tracking-wide font-medium ${data.storyMetadata.isSealed ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{data.storyMetadata.isSealed ? t('storyDetail.sealed', 'Sealed') : t('storyDetail.editable', 'Editable')}</span>
                  </div>
                </dl>
              </div>
            )}
          </div>

          <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
            <div className="bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-2xl shadow-gray-500/5 dark:shadow-gray-900/20 border border-gray-200/70 dark:border-gray-700/50 p-5 card-surface backdrop-blur-xl relative overflow-hidden group hover:shadow-3xl hover:shadow-gray-500/10 dark:hover:shadow-gray-900/30 transition-all duration-300">
              {/* Subtle background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/20 via-transparent to-purple-50/15 dark:from-indigo-900/10 dark:via-transparent dark:to-purple-900/5 pointer-events-none rounded-2xl"></div>
              
              <h3 className="relative text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-5 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                <span>{t('storyDetail.chunkList', 'Chunk List')}</span>
                {data && data.storyChunks && data.storyChunks.length > 0 && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{data.storyChunks.length}</span>
                )}
              </h3>
              {data && data.storyChunks && data.storyChunks.length > 0 ? (
                <div className="space-y-2 max-h-[540px] overflow-auto pr-1 thin-scrollbar">
                  {data.storyChunks
                    .sort((a, b) => a.chunkIndex - b.chunkIndex)
                    .map((chunk) => {
                      const open = expandedChunks.has(chunk.chunkIndex)
                      const preview = chunk.content.length > 80 ? `${chunk.content.slice(0, 80)}...` : chunk.content
                      return (
                        <div key={chunk.chunkIndex} className="group border rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors relative border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60">
                          <button
                            onClick={() => toggleChunk(chunk.chunkIndex)}
                            className="w-full text-left flex items-start gap-2"
                          >
                            <span className="mt-0.5 text-gray-400 dark:text-gray-500">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">#{chunk.chunkIndex}</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">{chunk.content.length} {t('storyDetail.characters', 'characters')}</span>
                              </div>
                              {/* Reverted font sizing */}
                              <div className={`text-xs text-gray-600 dark:text-gray-400 mt-1 ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}> 
                                {open ? chunk.content : preview}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500 mt-2 pl-7">
                            <span className="flex items-center gap-1"><Clock size={10} />{new Date(chunk.timestamp * 1000).toLocaleDateString()}</span>
                            <span className="flex items-center gap-1"><User size={10} />{chunk.lastEditor.slice(0, 6)}...</span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="text-gray-400 dark:text-gray-500 text-sm italic py-4 text-center">
                  {t('storyDetail.noChunks', 'No chunks')}
                </div>
              )}
            </div>

            {data && data.storyMetadata && (
              <div className="hidden xl:block bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-2xl shadow-gray-500/5 dark:shadow-gray-900/20 border border-gray-200/70 dark:border-gray-700/50 p-5 space-y-5 card-surface backdrop-blur-xl relative overflow-hidden group hover:shadow-3xl hover:shadow-gray-500/10 dark:hover:shadow-gray-900/30 transition-all duration-300">
                {/* Subtle background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-cyan-50/15 dark:from-blue-900/10 dark:via-transparent dark:to-cyan-900/5 pointer-events-none rounded-2xl"></div>
                
                <div className="relative">
                  <h3 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-4 bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">{t('storyDetail.metadata', 'Metadata')}</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('storyDetail.tokenId', 'Token ID')}</span><span className="font-mono text-gray-800 dark:text-gray-200">#{data.tokenId}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('storyDetail.totalChunks', 'Total Chunks')}</span><span className="font-mono text-gray-800 dark:text-gray-200">{data.storyMetadata.totalChunks}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('storyDetail.totalLength', 'Total Length')}</span><span className="font-mono text-gray-800 dark:text-gray-200">{data.storyMetadata.totalLength}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('storyDetail.lastUpdate', 'Last Update')}</span><span className="font-mono text-[11px]">{formatDate(data.storyMetadata.lastUpdateTime)}</span></div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-gray-500 dark:text-gray-400">{t('storyDetail.status', 'Status')}</span>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${data.storyMetadata.isSealed ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{data.storyMetadata.isSealed ? t('storyDetail.sealed', 'Sealed') : t('storyDetail.editable', 'Editable')}</span>
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t space-y-3">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 text-[11px] mb-1">{t('storyDetail.storyHash', 'Story Hash')}</div>
                    <div className="flex items-center gap-0">
                      <div className="font-mono text-[10px] break-all bg-gray-50 dark:bg-gray-900 p-2 rounded select-all text-gray-700 dark:text-gray-300 flex-1">
                        {data.storyMetadata.fullStoryHash}
                      </div>
                      <button
                        onClick={() => copyText(data.storyMetadata!.fullStoryHash)}
                        aria-label={t('search.copy')}
                        className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        title={t('search.copy')}
                      >
                        <Clipboard size={14} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 text-[11px] mb-1">{t('storyDetail.owner', 'Owner Address')}</div>
                    <div className="flex items-center gap-0">
                      <div className="font-mono text-[10px] break-all bg-gray-50 dark:bg-gray-900 p-2 rounded select-all text-gray-700 dark:text-gray-300 flex-1" title={data.owner}>{data.owner || '-'}</div>
                      {data.owner && (
                        <button
                          onClick={() => copyText(data.owner!)}
                          aria-label={t('search.copy')}
                          className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          title={t('search.copy')}
                        >
                          <Clipboard size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {data.personHash && (
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 text-[11px] mb-1">{t('storyDetail.personHash', 'Person Hash')}</div>
                      <div className="flex items-center gap-0">
                        <div className="font-mono text-[10px] break-all bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded select-all text-gray-700 dark:text-gray-300">
                          {data.personHash}
                        </div>
                        <button
                          onClick={() => copyText(data.personHash!)}
                          aria-label={t('search.copy')}
                          className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          title={t('search.copy')}
                        >
                          <Clipboard size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <StoryChunkEditor
        open={editorOpen}
        onClose={closeEditor}
        tokenId={data?.tokenId || ''}
        storyMetadata={data?.storyMetadata}
        storyChunks={data?.storyChunks}
        onAddChunk={async (chunkData) => {
          if (!contractAddress) return
          try {
            const eth = (window as any).ethereum
            if (!eth) throw new Error('No wallet')
            const provider = new ethers.BrowserProvider(eth)
            const signer = await provider.getSigner()
            const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, signer)
            const tx = await contract.addStoryChunk(chunkData.tokenId, chunkData.chunkIndex, chunkData.content, chunkData.expectedHash || ethers.ZeroHash)
            await tx.wait()
            await fetchStoryData()
          } catch (e) {
            console.error(e)
            throw e
          }
        }}
        onUpdateChunk={async (updateData) => {
          if (!contractAddress) return
            try {
              const eth = (window as any).ethereum
              if (!eth) throw new Error('No wallet')
              const provider = new ethers.BrowserProvider(eth)
              const signer = await provider.getSigner()
              const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, signer)
              const tx = await contract.updateStoryChunk(updateData.tokenId, updateData.chunkIndex, updateData.newContent, updateData.expectedHash || ethers.ZeroHash)
              await tx.wait()
              await fetchStoryData()
            } catch (e) {
              console.error(e)
              throw e
            }
        }}
        onSealStory={async (sealTokenId) => {
          if (!contractAddress) return
          try {
            const eth = (window as any).ethereum
            if (!eth) throw new Error('No wallet')
            const provider = new ethers.BrowserProvider(eth)
            const signer = await provider.getSigner()
            const contract = new ethers.Contract(contractAddress, (DeepFamily as any).abi, signer)
            const tx = await contract.sealStory(sealTokenId)
            await tx.wait()
            await fetchStoryData()
          } catch (e) {
            console.error(e)
            throw e
          }
        }}
      />
    </div>
  )
}

function HashAndIndexLine({ personHash, versionIndex, t }: { personHash: string, versionIndex?: number, t: any }) {
  const [copied, setCopied] = useState(false)
  // Removed inline expansion state; rely on title tooltip
  const copy = () => {
    try { navigator.clipboard.writeText(personHash) } catch {}
    setCopied(true)
    setTimeout(()=>setCopied(false), 1200)
  }
  const cfg = useConfig()
  const navigate = useNavigate()
  const goViz = () => {
    if (!versionIndex || versionIndex <= 0) return
    cfg.update({ rootHash: personHash, rootVersionIndex: versionIndex })
    navigate(`/visualization?root=${personHash}&v=${versionIndex}`)
  }
  const shortHash = useMemo(() => {
    if (!personHash) return ''
    if (personHash.length <= 26) return personHash
    return personHash.slice(0, 7) + '...' + personHash.slice(-5)
  }, [personHash])
  return (
    <div className="mt-1 flex items-center gap-3 font-mono text-[10px] sm:text-xs text-gray-600 dark:text-gray-400">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-gray-500 dark:text-gray-500/70 xs:inline">{t('storyDetail.personHashLabel','Person Hash:')}</span>
        <span
          className="truncate max-w-[160px] sm:max-w-[260px] select-text"
          title={personHash}
        >{shortHash}</span>
        <button
          onClick={copy}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${copied ? 'bg-green-600 border-green-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          aria-label={copied ? (t('common.copied','Copied') as string) : (t('common.copy','Copy') as string)}
          title={copied ? (t('common.copied','Copied') as string) : (t('common.copy','Copy') as string)}
        >
          <Copy size={12} />
          <span className="hidden sm:inline">{copied ? t('common.copied','Copied') : t('common.copy','Copy')}</span>
        </button>
      </div>
      {versionIndex !== undefined && versionIndex > 0 && (
        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <span className="text-gray-500 dark:text-gray-500/80">{t('storyDetail.versionLabel','Version:')}v{versionIndex}</span>
          <button
            onClick={goViz}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/30 text-[10px] transition-colors"
            title={t('storyDetail.viewVisualization','View Family Tree') as string}
            aria-label={t('storyDetail.viewVisualization','View Family Tree') as string}
          >
            <GitBranch size={12} />
            <span className="hidden sm:inline">{t('storyDetail.viewVisualization','Family Tree')}</span>
          </button>
        </div>
      )}
    </div>
  )
}