import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, AlertCircle, Star, X } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { getFriendlyError } from '../../lib/errors'

interface EndorseCompactModalProps {
  isOpen: boolean
  onClose: () => void
  personHash: string
  versionIndex: number
  versionData?: {
    fullName?: string
    endorsementCount?: number
  }
  onSuccess?: (result: any) => void
}

type EndorseState = 'idle' | 'working' | 'success' | 'error'

export default function EndorseCompactModal({
  isOpen,
  onClose,
  personHash,
  versionIndex,
  versionData,
  onSuccess
}: EndorseCompactModalProps) {
  const { t } = useTranslation()
  const { address } = useWallet()
  const { endorseVersion, getVersionDetails } = useContract()
  const [state, setState] = useState<EndorseState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(versionData?.fullName || null)
  const [endorsementCount, setEndorsementCount] = useState<number | null>(versionData?.endorsementCount ?? null)
  const [hasTriggered, setHasTriggered] = useState(false)

  const hasValidTarget = useMemo(
    () => Boolean(personHash && /^0x[0-9a-fA-F]{64}$/.test(personHash) && Number(versionIndex) > 0),
    [personHash, versionIndex]
  )

  // Reset between openings
  useEffect(() => {
    if (!isOpen) return
    setState('idle')
    setErrorMessage(null)
    setTxHash(null)
    setHasTriggered(false)
    if (versionData?.endorsementCount !== undefined) {
      setEndorsementCount(versionData.endorsementCount)
    }
  }, [isOpen, personHash, versionIndex])

  // Lightweight detail fetch for context
  useEffect(() => {
    if (!isOpen || !getVersionDetails || !hasValidTarget) return
    let mounted = true
    ;(async () => {
      try {
        const details = await getVersionDetails(personHash, versionIndex)
        if (!mounted || !details) return
        const name = details.version?.coreInfo?.supplementInfo?.fullName
        setDisplayName(name || versionData?.fullName || null)
        const nextCount = Number(details.endorsementCount ?? versionData?.endorsementCount ?? 0)
        setEndorsementCount(prev => {
          if (prev === null) return nextCount
          return Math.max(prev, nextCount)
        })
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [isOpen, getVersionDetails, personHash, versionIndex, hasValidTarget, versionData?.fullName, versionData?.endorsementCount])

  const triggerEndorse = async () => {
    if (!address) {
      setErrorMessage(t('wallet.notConnected', 'Please connect your wallet'))
      setState('error')
      return
    }

    if (!hasValidTarget) {
      setErrorMessage(t('endorse.errors.invalidTarget', 'Invalid person hash or version index'))
      setState('error')
      return
    }

    try {
      setState('working')
      setErrorMessage(null)
      const result = await endorseVersion(personHash, versionIndex, undefined, { suppressToasts: true })
      setTxHash(result?.hash || result?.transactionHash || null)
      setEndorsementCount((prev) => (prev === null ? 1 : prev + 1))
      setState('success')
      onSuccess?.(result)
    } catch (err: any) {
      setState('error')
      const friendly = getFriendlyError(err, t)
      setErrorMessage(friendly.message)
    }
  }

  // Auto-endorse as soon as the modal opens with a valid target
  useEffect(() => {
    if (!isOpen || hasTriggered) return
    if (hasValidTarget && address) {
      setHasTriggered(true)
      triggerEndorse()
    } else if (!address) {
      setState('error')
      setErrorMessage(t('wallet.notConnected', 'Please connect your wallet'))
    }
  }, [isOpen, hasTriggered, hasValidTarget, address])

  if (!isOpen) return null

  const isProcessing = state === 'working'

  return createPortal(
    <div className="fixed inset-0 z-[1300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 shadow-2xl p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white flex items-center justify-center shadow-lg">
              <Star className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('endorse.quickTitle', 'Endorse Version')}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 px-4 py-3 space-y-3">
          <div className="text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {t('endorse.targetVersion', 'Target Version')}
          </div>
          <div className="space-y-2 text-sm text-gray-900 dark:text-gray-100">
            <div className="font-medium truncate">{displayName || t('endorse.personHash', 'Person Hash')}</div>
            <code className="block text-xs font-mono text-gray-700 dark:text-gray-200 break-all">
              {personHash}
            </code>
            <code className="block text-xs font-mono text-gray-700 dark:text-gray-200 break-all">
              v{versionIndex}
            </code>
          </div>
          {endorsementCount !== null && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">
              {t('endorse.currentCount', 'Current endorsements')}: {endorsementCount}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-900">
          {state === 'working' && (
            <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t('endorse.processing', 'Submitting endorsement...')}</span>
            </div>
          )}
          {state === 'success' && (
            <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
              <Check className="w-5 h-5" />
              <div>
                <div className="text-sm font-medium">
                  {t('endorse.success', 'Endorsed successfully')}
                </div>
                {txHash && (
                  <code className="block text-xs font-mono text-gray-700 dark:text-gray-200 break-all">
                    {txHash}
                  </code>
                )}
              </div>
            </div>
          )}
          {state === 'error' && (
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div className="flex items-center gap-2 flex-wrap text-sm">
                {errorMessage ? (
                  <span className="text-gray-700 dark:text-gray-300">{errorMessage}</span>
                ) : (
                  <span className="font-medium">
                    {t('endorse.transactionFailed', 'Transaction failed. Please try again.')}
                  </span>
                )}
                {hasValidTarget && (
                  <button
                    onClick={triggerEndorse}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 transition"
                    disabled={isProcessing}
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {t('common.retry', 'Retry')}
                  </button>
                )}
              </div>
            </div>
          )}
          {state === 'idle' && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('endorse.quickWaiting', 'Preparing endorsement...')}
            </div>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}
