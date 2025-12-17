import React from 'react'
import { createPortal } from 'react-dom'
import { X, Clipboard, Edit2, User, Image, Star, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { NodeData, birthDateString, deathDateString, genderText as genderTextFn, isMinted, formatUnixSeconds } from '../types/graph'
import { useNavigate } from 'react-router-dom'
import { useTreeData } from '../context/TreeDataContext'
import EndorseCompactModal from './modals/EndorseCompactModal'

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
  const { getOwnerOf, bumpEndorsementCount } = useTreeData()
  const [owner, setOwner] = React.useState<string | undefined>(nodeData?.owner)
  const [showEndorseModal, setShowEndorseModal] = React.useState(false)
  const [endorsementCount, setEndorsementCount] = React.useState<number>(nodeData?.endorsementCount ?? 0)
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
    setEndorsementCount(nodeData?.endorsementCount ?? 0)
  }, [nodeData?.endorsementCount, nodeData?.personHash, nodeData?.versionIndex])
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

  const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; copy?: string; color?: 'purple' | 'emerald' | 'blue' | 'amber' | 'pink' | 'slate' }> = ({ label, value, copy, color = 'slate' }) => {
    const colorClasses = {
      purple: 'bg-purple-50/30 dark:bg-purple-900/5 border-purple-100/40 dark:border-purple-800/15 hover:border-purple-200/60 dark:hover:border-purple-700/25',
      emerald: 'bg-emerald-50/30 dark:bg-emerald-900/5 border-emerald-100/40 dark:border-emerald-800/15 hover:border-emerald-200/60 dark:hover:border-emerald-700/25',
      blue: 'bg-blue-50/30 dark:bg-blue-900/5 border-blue-100/40 dark:border-blue-800/15 hover:border-blue-200/60 dark:hover:border-blue-700/25',
      amber: 'bg-amber-50/30 dark:bg-amber-900/5 border-amber-100/40 dark:border-amber-800/15 hover:border-amber-200/60 dark:hover:border-amber-700/25',
      pink: 'bg-pink-50/30 dark:bg-pink-900/5 border-pink-100/40 dark:border-pink-800/15 hover:border-pink-200/60 dark:hover:border-pink-700/25',
      slate: 'bg-indigo-50/30 dark:bg-indigo-900/5 border-indigo-100/40 dark:border-indigo-800/15 hover:border-indigo-200/60 dark:hover:border-indigo-700/25'
    }
    const labelColorClasses = {
      purple: 'text-gray-700 dark:text-gray-300',
      emerald: 'text-gray-700 dark:text-gray-300',
      blue: 'text-gray-700 dark:text-gray-300',
      amber: 'text-gray-700 dark:text-gray-300',
      pink: 'text-gray-700 dark:text-gray-300',
      slate: 'text-gray-700 dark:text-gray-300'
    }
    const valueColorClasses = {
      purple: 'text-gray-900 dark:text-gray-100',
      emerald: 'text-gray-900 dark:text-gray-100',
      blue: 'text-gray-900 dark:text-gray-100',
      amber: 'text-gray-900 dark:text-gray-100',
      pink: 'text-gray-900 dark:text-gray-100',
      slate: 'text-gray-900 dark:text-gray-100'
    }
    const buttonColorClasses = {
      purple: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400',
      emerald: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400',
      blue: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400',
      amber: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400',
      pink: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400',
      slate: 'hover:bg-gray-100/60 dark:hover:bg-gray-700/30 text-gray-500 dark:text-gray-400'
    }
    return (
      <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${colorClasses[color]}`}>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold mb-1.5 ${labelColorClasses[color]}`}>{label}</div>
          <div className="flex items-center gap-2">
            <div className={`text-sm font-mono min-w-0 flex-1 break-all ${valueColorClasses[color]}`}>{value}</div>
            {copy ? (
              <button aria-label={t('search.copy')} onClick={() => onCopy(copy)} className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${buttonColorClasses[color]}`}>
                <Clipboard size={15} strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }
  const SmartHash: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text || text === ethers.ZeroHash) return <span>-</span>
    return <span className="block break-all">{text}</span>
  }

  const SmartAddress: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text) return <span>-</span>
    return <span className="block break-all">{text}</span>
  }
  const onCopy = async (text: string) => {
    const ok = await copyText(text)
    setCenterHint(ok ? t('search.copied') : t('search.copyFailed'))
    window.setTimeout(() => setCenterHint(null), 1200)
  }

  const modal = createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm overflow-x-hidden touch-pan-y" onClick={handleClose}>
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 pb-[env(safe-area-inset-bottom)] sm:p-4">
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
                          setShowEndorseModal(true)
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                        title={t('people.clickToEndorse', 'Click to endorse this version')}
                      >
                        <Star className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500 dark:text-emerald-400 dark:fill-emerald-400" strokeWidth={0} />
                        <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {endorsementCount}
                        </span>
                      </button>
                    )}
                    {!hasNFT && nodeData?.personHash && nodeData?.versionIndex !== undefined && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const params = new URLSearchParams()
                          if (nodeData?.personHash) params.set('hash', nodeData.personHash)
                          if (nodeData?.versionIndex) params.set('vi', nodeData.versionIndex.toString())
                          window.open(`/actions?tab=mint-nft&${params.toString()}`, '_blank', 'noopener,noreferrer')
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-950/60 border border-purple-200/60 dark:border-purple-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                        title={t('familyTree.nodeDetail.mintNFTTooltip', 'Mint this person as an NFT')}
                      >
                        <Image className="w-3.5 h-3.5 text-purple-600 dark:text-purple-300" />
                        <span className="hidden sm:inline text-[13px] font-semibold text-purple-700 dark:text-purple-300">
                          {t('actions.mintNFT', 'Mint NFT')}
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
                          className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 border border-blue-200/60 dark:border-blue-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
                          title={t('familyTree.nodeDetail.viewFullStory', 'View Full Story')}
                        >
                          <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span className="hidden sm:inline text-[13px] font-semibold text-blue-700 dark:text-blue-400">{t('familyTree.nodeDetail.encyclopedia', 'Encyclopedia')}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!nodeData?.tokenId) return
                            window.open(`/editor/${nodeData.tokenId}`, '_blank', 'noopener,noreferrer')
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className="inline-flex h-7 min-w-[36px] items-center gap-1 px-2 sm:px-2.5 py-1 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-950/60 border border-green-200/60 dark:border-green-800/50 rounded-full transition-all duration-200 cursor-pointer justify-center sm:justify-start"
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
          <EndorseCompactModal
            isOpen={showEndorseModal}
            onClose={() => setShowEndorseModal(false)}
            personHash={nodeData?.personHash || fallback.hash}
            versionIndex={Number(nodeData?.versionIndex || fallback.versionIndex || 1)}
            versionData={{
              fullName: nodeData?.fullName,
              endorsementCount: endorsementCount
            }}
            onSuccess={() => {
              setEndorsementCount(c => c + 1)
              bumpEndorsementCount(nodeData?.personHash || fallback.hash, Number(nodeData?.versionIndex || fallback.versionIndex || 1), 1)
            }}
          />
        {centerHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
            <div className="rounded bg-black/80 dark:bg-black/70 text-white px-3 py-1.5 text-xs animate-fade-in">{centerHint}</div>
          </div>
        )}
        <div className="flex-1 min-h-0 px-5 pt-3 overflow-y-auto overscroll-contain overflow-x-hidden scroll-smooth text-[13px] text-gray-900 dark:text-gray-100 pb-[calc(env(safe-area-inset-bottom)+4rem)] touch-pan-y">
          <div className="space-y-2.5">
            <Row label={t('familyTree.nodeDetail.hash')} value={<SmartHash text={(nodeData?.personHash || fallback.hash)} />} copy={nodeData?.personHash || fallback.hash} color="purple" />
            <Row label={t('familyTree.nodeDetail.version')} value={(nodeData?.versionIndex !== undefined && Number(nodeData.versionIndex) > 0) ? String(nodeData.versionIndex) : '-'} color="purple" />
            <Row label={t('familyTree.nodeDetail.father')} value={<SmartHash text={nodeData?.fatherHash} />} copy={nodeData?.fatherHash && nodeData.fatherHash !== ethers.ZeroHash ? nodeData.fatherHash : undefined} color="blue" />
            <Row label={t('familyTree.nodeDetail.fatherVersion')} value={(nodeData && Number(nodeData.fatherVersionIndex) > 0) ? String(nodeData.fatherVersionIndex) : '-'} color="blue" />
            <Row label={t('familyTree.nodeDetail.mother')} value={<SmartHash text={nodeData?.motherHash} />} copy={nodeData?.motherHash && nodeData.motherHash !== ethers.ZeroHash ? nodeData.motherHash : undefined} color="pink" />
            <Row label={t('familyTree.nodeDetail.motherVersion')} value={(nodeData && Number(nodeData.motherVersionIndex) > 0) ? String(nodeData.motherVersionIndex) : '-'} color="pink" />
            <Row label={t('familyTree.nodeDetail.addedBy')} value={<SmartAddress text={nodeData?.addedBy} />} copy={nodeData?.addedBy} color="emerald" />
            <Row label={t('familyTree.nodeDetail.timestamp')} value={formatUnixSeconds(nodeData?.timestamp)} color="amber" />
            <Row
              label={t('familyTree.nodeDetail.tag')}
              value={nodeData?.tag || '-'}
              color="slate"
            />
            <Row
              label={t('familyTree.nodeDetail.cid')}
              value={
                <div className="flex items-center gap-2">
                        <span className="block break-all">{nodeData?.metadataCID || '-'}</span>
                        {nodeData?.metadataCID && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const cid = nodeData?.metadataCID || ''
                              if (!cid) return
                              navigate(`/decrypt?cid=${encodeURIComponent(cid)}`)
                            }}
                            className="px-2 py-1 text-[12px] rounded-md border border-blue-200 dark:border-blue-600 text-blue-700 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
                          >
                            {t('familyTree.nodeDetail.decrypt', 'Decrypt and View')}
                          </button>
                  )}
                </div>
              }
              copy={nodeData?.metadataCID ? nodeData.metadataCID : undefined}
              color="slate"
            />
            {/* NFT Section - only when NFT exists */}
            {hasNFT && (
              <div className="pt-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 px-1">
                  <Image className="w-4 h-4 text-purple-600" />
                  {t('familyTree.nodeDetail.nft')}
                </h3>
              </div>
            )}
            {hasNFT ? (
              /* Already minted NFT - show NFT info */
              <>
                <Row label={t('familyTree.nodeDetail.tokenId')} value={nodeData!.tokenId} copy={nodeData!.tokenId} color="purple" />
                {nodeData?.fullName && <Row label={t('familyTree.nodeDetail.fullName')} value={nodeData.fullName} color="blue" />}
                {nodeData?.gender !== undefined && (
                  <Row label={t('familyTree.nodeDetail.gender')} value={genderTextFn(nodeData.gender, t as any) || '-'} color="emerald" />
                )}
                <Row label={t('familyTree.nodeDetail.birth')} value={(() => {
                  const d = birthDateString(nodeData)
                  const parts = [d, nodeData?.birthPlace].filter(Boolean)
                  return parts.length ? parts.join(' · ') : '-'
                })()} color="emerald" />
                <Row label={t('familyTree.nodeDetail.death')} value={(() => {
                  const d = deathDateString(nodeData)
                  const parts = [d, nodeData?.deathPlace].filter(Boolean)
                  return parts.length ? parts.join(' · ') : '-'
                })()} color="slate" />
                {nodeData?.story && nodeData.story.trim() !== '' && (
                  <div className="flex items-start gap-3 p-3.5 bg-blue-50/30 dark:bg-blue-900/5 rounded-xl border border-blue-100/40 dark:border-blue-800/15 hover:border-blue-200/60 dark:hover:border-blue-700/25 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{t('familyTree.nodeDetail.story')}</div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">{nodeData.story}</div>
                    </div>
                  </div>
                )}
                <Row label={t('person.owner', 'Owner Address')} value={<SmartAddress text={owner} />} copy={owner} color="amber" />
                {nodeData?.nftTokenURI && <Row label={t('familyTree.nodeDetail.uri')} value={nodeData.nftTokenURI} copy={nodeData.nftTokenURI} color="slate" />}
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

  return modal
}
