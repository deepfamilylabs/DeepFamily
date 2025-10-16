import React from 'react'
import { createPortal } from 'react-dom'
import { X, Clipboard, Edit2, User, Image, Star, Book } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NodeData, birthDateString, deathDateString, genderText as genderTextFn, isMinted, formatUnixSeconds, shortAddress, formatHashMiddle } from '../types/graph'
import { useNavigate } from 'react-router-dom'
import { useTreeData } from '../context/TreeDataContext'


export default function NodeDetailModal({
  open,
  onClose,
  nodeData,
  fallback,
  loading,
  error,
}: {
  open: boolean
  onClose: () => void
  nodeData?: NodeData | null
  fallback: { hash: string; versionIndex?: number }
  loading?: boolean
  error?: string | null
}) {
  const { t } = useTranslation()
  // Track close origin to coordinate with history state
  const pushedRef = React.useRef(false)
  const closedBySelfRef = React.useRef(false)
  const closedByPopRef = React.useRef(false)
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
  const [centerHint, setCenterHint] = React.useState<string | null>(null)
  const [entered, setEntered] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [dragOffset, setDragOffset] = React.useState(0)
  const startYRef = React.useRef<number | null>(null)
  const navigate = useNavigate()
  const { getOwnerOf } = useTreeData()
  const [owner, setOwner] = React.useState<string | undefined>(nodeData?.owner)
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(min-width: 640px)').matches
  })
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(min-width: 640px)')
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsDesktop((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches)
    try {
      mql.addEventListener('change', onChange as any)
    } catch {
      // Safari
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
  const handleClose = React.useCallback(() => {
    closedBySelfRef.current = true
    onClose()
  }, [onClose])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  // Push a history state on open so mobile back closes modal first
  React.useEffect(() => {
    if (!open) return
    try {
      window.history.pushState({ __dfNodeDetailModal: true }, '')
      pushedRef.current = true
    } catch {}
    const onPop = () => {
      // Back pressed: close modal without adding another back
      closedByPopRef.current = true
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // If user closed via modal (click overlay/drag/Escape/button) and we pushed a state,
      // consume the extra history entry so URL stays at the same route.
      if (pushedRef.current && closedBySelfRef.current && !closedByPopRef.current) {
        try { window.history.back() } catch {}
      }
      pushedRef.current = false
      closedBySelfRef.current = false
      closedByPopRef.current = false
    }
  }, [open, onClose])
  // Lock background scroll
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])
  // Enter animation
  React.useEffect(() => { if (open) { requestAnimationFrame(() => setEntered(true)) } else { setEntered(false) } }, [open])
  // Keep local owner state in sync and fetch if missing
  React.useEffect(() => { setOwner(nodeData?.owner) }, [nodeData?.owner])
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!open) return
        if (!nodeData?.tokenId || nodeData.tokenId === '0') return
        if (owner) return
        const addr = await getOwnerOf(String(nodeData.tokenId))
        if (!cancelled) setOwner(addr || undefined)
      } catch {
        if (!cancelled) setOwner(undefined)
      }
    })()
    return () => { cancelled = true }
  }, [open, nodeData?.tokenId, owner, getOwnerOf])
  if (!open) return null

  const hasNFT = isMinted(nodeData)

  const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; copy?: string }> = ({ label, value, copy }) => (
    <div className="grid grid-cols-[90px_1fr] sm:grid-cols-[110px_1fr] gap-x-3 gap-y-0 items-center text-[13px] leading-[1.4rem] py-2">
      <div className="text-gray-600 dark:text-gray-400 select-none truncate whitespace-nowrap overflow-hidden text-ellipsis font-medium" title={typeof label === 'string' ? label : undefined}>{label}</div>
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-mono break-all min-w-0 text-[14px] text-gray-900 dark:text-gray-100 leading-snug font-medium">{value}</div>
        {copy ? (
          <button aria-label={t('search.copy')} onClick={() => onCopy(copy)} className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200/90 dark:hover:bg-gray-700/90 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 active:scale-95">
            <Clipboard size={16} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
    </div>
  )
  const SmartHash: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const measureRef = React.useRef<HTMLSpanElement | null>(null)
    const [useAbbrev, setUseAbbrev] = React.useState<boolean>(() => !isDesktop)
    const fullText = text ?? ''

    React.useEffect(() => {
      if (!text) { setUseAbbrev(false); return }
      if (!isDesktop) { setUseAbbrev(true); return }

      // Use requestAnimationFrame to ensure DOM is ready
      const checkWidth = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return

        const available = container.clientWidth
        const needed = measure.scrollWidth
        setUseAbbrev(needed > available + 2)
      }

      requestAnimationFrame(checkWidth)
    }, [fullText, isDesktop, text])

    React.useEffect(() => {
      if (!isDesktop) return
      const onResize = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 2)
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [isDesktop])

    if (!text) return <span>-</span>
    return (
      <div ref={containerRef} className="relative min-w-0">
        <span className="block whitespace-nowrap break-normal overflow-hidden text-ellipsis">{useAbbrev ? formatHashMiddle(text) : text}</span>
        <span ref={measureRef} className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap break-normal">{text}</span>
      </div>
    )
  }

  const SmartAddress: React.FC<{ text?: string | null }> = ({ text }) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const measureRef = React.useRef<HTMLSpanElement | null>(null)
    const [useAbbrev, setUseAbbrev] = React.useState<boolean>(() => !isDesktop)
    const fullText = text ?? ''

    React.useEffect(() => {
      if (!text) { setUseAbbrev(false); return }
      if (!isDesktop) { setUseAbbrev(true); return }

      // Use requestAnimationFrame to ensure DOM is ready
      const checkWidth = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return

        const available = container.clientWidth
        const needed = measure.scrollWidth
        setUseAbbrev(needed > available + 2)
      }

      requestAnimationFrame(checkWidth)
    }, [fullText, isDesktop, text])

    React.useEffect(() => {
      if (!isDesktop) return
      const onResize = () => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return
        setUseAbbrev(measure.scrollWidth > container.clientWidth + 2)
      }
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [isDesktop])

    if (!text) return <span>-</span>
    return (
      <div ref={containerRef} className="relative min-w-0">
        <span className="block whitespace-nowrap overflow-hidden text-ellipsis">{useAbbrev ? shortAddress(text) : text}</span>
        <span ref={measureRef} className="absolute left-0 top-0 opacity-0 pointer-events-none whitespace-nowrap">{text}</span>
      </div>
    )
  }
  const onCopy = async (text: string) => {
    const ok = await copyText(text)
    setCenterHint(ok ? t('search.copied') : t('search.copyFailed'))
    window.setTimeout(() => setCenterHint(null), 1200)
  }

  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm overflow-x-hidden" onClick={handleClose} style={{ touchAction: 'pan-y' }}>
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 sm:p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div
          className={`relative flex flex-col w-full max-w-[720px] ${hasNFT ? 'h-[92vh]' : 'h-auto max-h-[92vh] mb-2'} sm:h-auto sm:max-h-[85vh] bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'} will-change-transform`}
          style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="sticky top-0 bg-gradient-to-br from-blue-100/80 via-purple-100/60 to-blue-50/40 dark:from-gray-800 dark:via-gray-800/95 dark:to-gray-900 px-5 py-4 pt-7 sm:pt-5 sm:px-6 border-b border-gray-200 dark:border-gray-700 z-10 relative touch-none cursor-grab active:cursor-grabbing backdrop-blur-sm supports-[backdrop-filter]:bg-white/90 dark:supports-[backdrop-filter]:bg-gray-900/80"
            onPointerDown={(e) => { (e.currentTarget as any).setPointerCapture?.(e.pointerId); startYRef.current = e.clientY; setDragging(true) }}
            onPointerMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.clientY - startYRef.current); setDragOffset(dy) }}
            onPointerUp={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) handleClose() }}
            onPointerCancel={() => { setDragging(false); setDragOffset(0) }}
            onTouchStart={(e) => { startYRef.current = e.touches[0].clientY; setDragging(true) }}
            onTouchMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.touches[0].clientY - startYRef.current); setDragOffset(dy) }}
            onTouchEnd={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) handleClose() }}
          >
            {/* Drag handle */}
            <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <User className="w-7 h-7 sm:w-8 sm:h-8 text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] sm:text-[17px] font-bold text-gray-900 dark:text-gray-50 truncate pr-2 tracking-tight leading-tight">
                    {t('familyTree.personVersionDetail.title')}
                  </div>
                  {/* Endorsement and People Encyclopedia badges under title */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {nodeData?.personHash && nodeData?.versionIndex !== undefined && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Navigate to endorse page with person hash and version index
                          const params = new URLSearchParams()
                          if (nodeData?.personHash) params.set('hash', nodeData.personHash)
                          if (nodeData?.versionIndex) params.set('vi', nodeData.versionIndex.toString())
                          window.open(`/actions?tab=endorse&${params.toString()}`, '_blank', 'noopener,noreferrer')
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 border border-amber-200/60 dark:border-amber-800/50 rounded-full transition-all duration-200 cursor-pointer"
                        title={t('people.clickToEndorse', 'Click to endorse this version')}
                      >
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" strokeWidth={0} />
                        <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-400">
                          {nodeData.endorsementCount ?? 0}
                        </span>
                      </button>
                    )}
                    {isMinted(nodeData) && nodeData?.tokenId && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(`/person/${nodeData.tokenId}`, '_blank', 'noopener,noreferrer')
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 border border-blue-200/60 dark:border-blue-800/50 rounded-full transition-all duration-200 cursor-pointer"
                          title={t('familyTree.nodeDetail.viewFullStory', 'View Full Story')}
                        >
                          <Book className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span className="hidden sm:inline text-[13px] font-semibold text-blue-700 dark:text-blue-400">{t('familyTree.nodeDetail.encyclopedia', 'Encyclopedia')}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!nodeData?.tokenId) return
                            navigate(`/editor/${nodeData.tokenId}`)
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 border border-green-200/60 dark:border-green-800/50 rounded-full transition-all duration-200 cursor-pointer"
                          title={t('familyTree.nodeDetail.editStory', 'Edit Story')}
                        >
                          <Edit2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                          <span className="hidden sm:inline text-[13px] font-semibold text-green-700 dark:text-green-400">{t('familyTree.nodeDetail.edit', 'Edit')}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                aria-label="close"
                className="p-1.5 -mt-0.5 rounded-lg hover:bg-gray-200/80 dark:hover:bg-gray-700/80 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); handleClose() }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <X size={22} strokeWidth={2} />
              </button>
            </div>
          </div>
        {centerHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
            <div className="rounded bg-black/80 dark:bg-black/70 text-white px-3 py-1.5 text-xs animate-fade-in">{centerHint}</div>
          </div>
        )}
        <div className="flex-1 min-h-0 px-5 pb-24 pt-3 overflow-y-auto overscroll-contain overflow-x-hidden scroll-smooth space-y-0 text-[13px] text-gray-900 dark:text-gray-100" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)', touchAction: 'pan-y' }}>
          <div className="space-y-0">
            <Row label={t('familyTree.nodeDetail.hash')} value={<SmartHash text={(nodeData?.personHash || fallback.hash)} />} copy={nodeData?.personHash || fallback.hash} />
            <Row label={t('familyTree.nodeDetail.version')} value={(nodeData?.versionIndex !== undefined && Number(nodeData.versionIndex) > 0) ? String(nodeData.versionIndex) : '-'} />
            <Row label={t('familyTree.nodeDetail.father')} value={<SmartHash text={nodeData?.fatherHash} />} copy={nodeData?.fatherHash} />
            <Row label={t('familyTree.nodeDetail.fatherVersion')} value={(nodeData && Number(nodeData.fatherVersionIndex) > 0) ? String(nodeData.fatherVersionIndex) : '-'} />
            <Row label={t('familyTree.nodeDetail.mother')} value={<SmartHash text={nodeData?.motherHash} />} copy={nodeData?.motherHash} />
            <Row label={t('familyTree.nodeDetail.motherVersion')} value={(nodeData && Number(nodeData.motherVersionIndex) > 0) ? String(nodeData.motherVersionIndex) : '-'} />
            <Row label={t('familyTree.nodeDetail.addedBy')} value={<SmartAddress text={nodeData?.addedBy} />} copy={nodeData?.addedBy} />
            <Row label={t('familyTree.nodeDetail.timestamp')} value={formatUnixSeconds(nodeData?.timestamp)} />
            <Row label={t('familyTree.nodeDetail.cid')} value={nodeData?.metadataCID || '-'} copy={nodeData?.metadataCID ? nodeData.metadataCID : undefined} />
            {/* NFT Section - show for all nodes */}
            <div className="pt-3 pb-1">
              <div className="my-3 h-px bg-gradient-to-r from-transparent via-gray-400 to-transparent dark:from-transparent dark:via-gray-500 dark:to-transparent" />
              <div className="grid grid-cols-[90px_1fr] sm:grid-cols-[110px_1fr] gap-x-3 gap-y-0 items-center text-[13px] leading-[1.4rem] mb-2 py-1">
                <div className="text-[14px] font-extrabold text-gray-800 dark:text-gray-200 tracking-wide flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-gradient-to-br from-blue-500 to-purple-600 dark:from-blue-400 dark:to-purple-500" />{t('familyTree.nodeDetail.nft')}
                </div>
                {!isMinted(nodeData) && (
                  <div className="flex gap-3 text-[12px] flex-wrap">
                    <button
                      onClick={() => {
                        // Navigate to actions page with mint-nft tab and parameters
                        const params = new URLSearchParams()
                        if (nodeData?.personHash) params.set('hash', nodeData.personHash)
                        if (nodeData?.versionIndex) params.set('vi', nodeData.versionIndex.toString())
                        navigate(`/actions?tab=mint-nft&${params.toString()}`)
                      }}
                      className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 font-medium underline flex items-center gap-1.5 transition-colors duration-200"
                    >
                      <Image size={12} strokeWidth={2} />
                      {t('actions.mintNFT')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {isMinted(nodeData) ? (
              /* Already minted NFT - show NFT info */
              <>
                <Row label={t('familyTree.nodeDetail.tokenId')} value={nodeData!.tokenId} copy={nodeData!.tokenId} />
                {nodeData?.fullName && <Row label={t('familyTree.nodeDetail.fullName')} value={nodeData.fullName} />}
                {nodeData?.gender !== undefined && (
                  <Row label={t('familyTree.nodeDetail.gender')} value={genderTextFn(nodeData.gender, t as any) || '-'} />
                )}
                <Row label={t('familyTree.nodeDetail.birth')} value={(() => {
                  const d = birthDateString(nodeData)
                  const parts = [d, nodeData?.birthPlace].filter(Boolean)
                  return parts.length ? parts.join(' · ') : '-'
                })()} />
                <Row label={t('familyTree.nodeDetail.death')} value={(() => {
                  const d = deathDateString(nodeData)
                  const parts = [d, nodeData?.deathPlace].filter(Boolean)
                  return parts.length ? parts.join(' · ') : '-'
                })()} />
                {nodeData?.story && nodeData.story.trim() !== '' && (
                  <div className="grid grid-cols-[90px_1fr] sm:grid-cols-[110px_1fr] gap-x-3 gap-y-0 items-start text-[13px] leading-[1.4rem] py-2">
                    <div className="text-gray-600 dark:text-gray-400 pt-0.5 select-none truncate font-medium">{t('familyTree.nodeDetail.story')}</div>
                    <div className="font-mono text-[13px] text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words min-w-0 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg max-h-[200px] overflow-y-auto">{nodeData.story}</div>
                  </div>
                )}
                <Row label={t('person.owner', 'Owner Address')} value={<SmartAddress text={owner} />} copy={owner} />
                {nodeData?.nftTokenURI && <Row label={t('familyTree.nodeDetail.uri')} value={nodeData.nftTokenURI} copy={nodeData.nftTokenURI} />}
              </>
            ) : null}
          </div>
          {/* Bottom spacer to ensure last row (e.g., URI) is visible above rounded edge / safe area */}
          <div className="h-4 sm:h-2" />
          {loading && (
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">{t('familyTree.nodeDetail.loading')}</div>
          )}
          {error && (
            <div className="text-center text-xs text-red-500 dark:text-red-400 py-2">{error}</div>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
