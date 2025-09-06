import React from 'react'
import { createPortal } from 'react-dom'
import { X, Clipboard, ChevronRight, Edit2, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NodeData } from '../types/graph'


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
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
  if (!open) return null

  const hasNFT = Boolean(nodeData?.tokenId && nodeData.tokenId !== '0')

  const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; copy?: string }> = ({ label, value, copy }) => (
    <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 items-start text-[12px] leading-[1.15rem]">
      <div className="text-gray-500 dark:text-gray-400 pt-0.5 select-none truncate whitespace-nowrap overflow-hidden text-ellipsis font-medium" title={typeof label === 'string' ? label : undefined}>{label}</div>
      <div className="flex items-start gap-1 min-w-0">
        <div className="font-mono break-all min-w-0 text-[11px] text-gray-800 dark:text-gray-200 leading-snug">{value}</div>
        {copy ? (
          <button aria-label={t('search.copy')} onClick={() => onCopy(copy)} className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors -mt-[2px]">
            <Clipboard size={14} />
          </button>
        ) : null}
      </div>
    </div>
  )
  const onCopy = async (text: string) => {
    const ok = await copyText(text)
    setCenterHint(ok ? t('search.copied') : t('search.copyFailed'))
    window.setTimeout(() => setCenterHint(null), 1200)
  }

  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 sm:p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div
          className={`relative flex flex-col w-full max-w-[720px] ${hasNFT ? 'h-[92vh]' : 'h-auto max-h-[92vh] mb-2'} sm:h-auto sm:max-h-[85vh] bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'} will-change-transform`}
          style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="sticky top-0 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-indigo-500/10 dark:from-blue-600/20 dark:via-purple-600/15 dark:to-indigo-600/20 px-4 py-4 pt-7 sm:pt-6 sm:px-6 border-b border-gray-200/50 dark:border-gray-700/50 z-10 relative touch-none cursor-grab active:cursor-grabbing backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60"
            onPointerDown={(e) => { (e.currentTarget as any).setPointerCapture?.(e.pointerId); startYRef.current = e.clientY; setDragging(true) }}
            onPointerMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.clientY - startYRef.current); setDragOffset(dy) }}
            onPointerUp={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) onClose() }}
            onPointerCancel={() => { setDragging(false); setDragOffset(0) }}
            onTouchStart={(e) => { startYRef.current = e.touches[0].clientY; setDragging(true) }}
            onTouchMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.touches[0].clientY - startYRef.current); setDragOffset(dy); e.preventDefault() }}
            onTouchEnd={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) onClose() }}
          >
            {/* Drag handle */}
            <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-12 rounded-full bg-gray-300/90 dark:bg-gray-700/90" />
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-[17px] sm:text-[18px] font-semibold text-gray-900 dark:text-gray-100 truncate pr-2 tracking-tight">
                    {t('visualization.personVersionDetail.title')}
                  </div>
                </div>
              </div>
              <button 
                aria-label="close" 
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors" 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <X size={20} />
              </button>
            </div>
          </div>
        {centerHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
            <div className="rounded bg-black/80 dark:bg-black/70 text-white px-3 py-1.5 text-xs animate-fade-in">{centerHint}</div>
          </div>
        )}
        <div className="px-4 pb-4 pt-2 overflow-y-auto scroll-smooth space-y-3 text-[12px] text-gray-900 dark:text-gray-100">
          <div className="space-y-1.5">
            <Row label={t('visualization.nodeDetail.hash')} value={nodeData?.personHash || fallback.hash} copy={nodeData?.personHash || fallback.hash} />
            <Row label={t('visualization.nodeDetail.version')} value={(nodeData?.versionIndex !== undefined && Number(nodeData.versionIndex) > 0) ? String(nodeData.versionIndex) : '-'} />
            <Row label={t('visualization.nodeDetail.endorsementCount')} value={nodeData?.endorsementCount ?? '-'} />
            <Row label={t('visualization.nodeDetail.father')} value={nodeData?.fatherHash || '-'} copy={nodeData?.fatherHash} />
            <Row label={t('visualization.nodeDetail.fatherVersion')} value={(nodeData && Number(nodeData.fatherVersionIndex) > 0) ? String(nodeData.fatherVersionIndex) : '-'} />
            <Row label={t('visualization.nodeDetail.mother')} value={nodeData?.motherHash || '-'} copy={nodeData?.motherHash} />
            <Row label={t('visualization.nodeDetail.motherVersion')} value={(nodeData && Number(nodeData.motherVersionIndex) > 0) ? String(nodeData.motherVersionIndex) : '-'} />
            <Row label={t('visualization.nodeDetail.addedBy')} value={nodeData?.addedBy || '-'} copy={nodeData?.addedBy} />
            <Row label={t('visualization.nodeDetail.timestamp')} value={nodeData?.timestamp ? new Date((nodeData.timestamp as number) * 1000).toLocaleString() : '-'} />
            <Row label={t('visualization.nodeDetail.tag')} value={nodeData?.tag ?? '-'} />
            <Row label={t('visualization.nodeDetail.cid')} value={nodeData?.metadataCID || '-'} copy={nodeData?.metadataCID ? nodeData.metadataCID : undefined} />
            {((nodeData?.tokenId && nodeData.tokenId !== '0') || nodeData?.fullName || nodeData?.nftTokenURI || nodeData?.story) && (
              <div className="pt-1">
                <div className="my-2 h-px bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" />
                <div className="text-[12px] font-semibold text-gray-600 dark:text-gray-300 tracking-wide mb-1 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-sm bg-gray-400 dark:bg-gray-500" />{t('visualization.nodeDetail.nft')}
                </div>
              </div>
            )}
            {((nodeData?.tokenId && nodeData.tokenId !== '0') || nodeData?.fullName || nodeData?.nftTokenURI || nodeData?.story) && (
              <>
                <Row label={t('visualization.nodeDetail.tokenId')} value={nodeData?.tokenId && nodeData.tokenId !== '0' ? nodeData.tokenId : '-'} copy={nodeData?.tokenId && nodeData.tokenId !== '0' ? nodeData.tokenId : undefined} />
                {nodeData?.fullName && <Row label={t('visualization.nodeDetail.fullName')} value={nodeData.fullName} />}
                {nodeData?.gender !== undefined && (
                  <Row label={t('visualization.nodeDetail.gender')} value={(() => {
                    if (nodeData.gender === 1) return t('visualization.nodeDetail.genders.male')
                    if (nodeData.gender === 2) return t('visualization.nodeDetail.genders.female')
                    if (nodeData.gender === 3) return t('visualization.nodeDetail.genders.other')
                    return '-'
                  })()} />
                )}
                <Row label={t('visualization.nodeDetail.birth')} value={(() => {
                  const parts: string[] = []
                  if (nodeData?.birthYear) {
                    let dateStr = `${nodeData.isBirthBC ? t('visualization.nodeDetail.bcPrefix') + ' ' : ''}${nodeData.birthYear}`
                    if (nodeData?.birthMonth && nodeData.birthMonth > 0) {
                      dateStr += `-${nodeData.birthMonth.toString().padStart(2, '0')}`
                      if (nodeData?.birthDay && nodeData.birthDay > 0) {
                        dateStr += `-${nodeData.birthDay.toString().padStart(2, '0')}`
                      }
                    }
                    parts.push(dateStr)
                  }
                  if (nodeData?.birthPlace) parts.push(nodeData.birthPlace)
                  return parts.length ? parts.join(' · ') : '-'
                })()} />
                <Row label={t('visualization.nodeDetail.death')} value={(() => {
                  const parts: string[] = []
                  if (nodeData?.deathYear) {
                    let dateStr = `${nodeData.isDeathBC ? t('visualization.nodeDetail.bcPrefix') + ' ' : ''}${nodeData.deathYear}`
                    if (nodeData?.deathMonth && nodeData.deathMonth > 0) {
                      dateStr += `-${nodeData.deathMonth.toString().padStart(2, '0')}`
                      if (nodeData?.deathDay && nodeData.deathDay > 0) {
                        dateStr += `-${nodeData.deathDay.toString().padStart(2, '0')}`
                      }
                    }
                    parts.push(dateStr)
                  }
                  if (nodeData?.deathPlace) parts.push(nodeData.deathPlace)
                  return parts.length ? parts.join(' · ') : '-'
                })()} />
                {nodeData?.story && nodeData.story.trim() !== '' && (
                  <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 items-start text-[12px] leading-[1.15rem]">
                    <div className="text-gray-500 dark:text-gray-400 pt-0.5 select-none truncate">{t('visualization.nodeDetail.story')}</div>
                    <div className="font-mono text-[11px] text-gray-800 dark:text-gray-200 leading-snug whitespace-pre-wrap break-words min-w-0">{nodeData.story}</div>
                  </div>
                )}
                {(nodeData?.tokenId && nodeData.tokenId !== '0') && (
                  <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 items-start text-[12px] leading-[1.15rem]">
                    <div className="text-gray-500 dark:text-gray-400 pt-0.5 select-none truncate">{t('visualization.nodeDetail.profile')}</div>
                    <div className="space-y-1">
                      <div className="flex gap-3 text-[11px] flex-wrap pt-0.5">
                        <button
                          onClick={() => {
                            const url = `/person/${nodeData.tokenId}`
                            window.open(url, '_blank')
                          }}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline flex items-center gap-1"
                        >
                          <ChevronRight size={11} />
                          {t('visualization.nodeDetail.viewFullStory')}
                        </button>
                        <button
                          onClick={() => {
                            const url = `/person/${nodeData.tokenId}?edit=1`
                            window.open(url, '_blank')
                          }}
                          className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 underline flex items-center gap-1"
                        >
                          <Edit2 size={11} />
                          {t('visualization.nodeDetail.editStory')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {nodeData?.nftTokenURI && <Row label={t('visualization.nodeDetail.uri')} value={nodeData.nftTokenURI} copy={nodeData.nftTokenURI} />}
              </>
            )}
          </div>
          {loading && (
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">{t('visualization.nodeDetail.loading')}</div>
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
