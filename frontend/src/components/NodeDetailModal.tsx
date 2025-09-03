import React from 'react'
import { createPortal } from 'react-dom'
import { X, Clipboard, ChevronRight, Edit2 } from 'lucide-react'
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
  if (!open) return null

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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl shadow-black/10 dark:shadow-black/30 w-full max-w-[560px] sm:max-w-[580px] max-h-[82vh] overflow-hidden flex flex-col text-[14px] border border-gray-100 dark:border-gray-700/60">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/70 dark:bg-gray-900/60 backdrop-blur-sm sticky top-0 z-10">
          <div className="text-[17px] font-semibold text-gray-900 dark:text-gray-100 truncate pr-2 tracking-tight">
            {t('visualization.personVersionDetail.title')}
          </div>
          <button aria-label="close" className="p-2 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-colors shadow-sm" onClick={onClose}>
            <X size={20} />
          </button>
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
                    <div className="text-gray-500 dark:text-gray-400 pt-0.5 select-none truncate">{t('visualization.nodeDetail.detailedStory')}</div>
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
    </div>,
    document.body
  )
}


