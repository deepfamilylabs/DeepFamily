import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, AlertCircle, Star, X, ShieldCheck, Coins } from 'lucide-react'
import { ethers } from 'ethers'
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

type EndorseState = 'idle' | 'checking' | 'approving' | 'working' | 'success' | 'already-endorsed' | 'error'

export default function EndorseCompactModal({
  isOpen,
  onClose,
  personHash,
  versionIndex,
  versionData,
  onSuccess
}: EndorseCompactModalProps) {
  const { t } = useTranslation()
  const { address, signer } = useWallet()
  const { endorseVersion, getVersionDetails, contract } = useContract()
  const [state, setState] = useState<EndorseState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(versionData?.fullName || null)
  const [endorsementCount, setEndorsementCount] = useState<number | null>(versionData?.endorsementCount ?? null)
  const [hasTriggered, setHasTriggered] = useState(false)
  const [endorsementFee, setEndorsementFee] = useState<string | null>(null)
  const [userBalance, setUserBalance] = useState<string | null>(null)
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false)

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
    setEndorsementFee(null)
    setUserBalance(null)
    setIsInsufficientBalance(false)
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

  /**
   * Check token allowance and approve if needed, then endorse
   * This logic is adapted from EndorseModal.tsx to ensure proper ERC20 approval
   */
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

    if (!contract || !signer) {
      setErrorMessage(t('wallet.notConnected', 'Please connect your wallet'))
      setState('error')
      return
    }

    try {
      // Check existing endorsement before any approval/tx work
      try {
        const endorsedIdx = await contract.endorsedVersionIndex(personHash, address)
        if (Number(endorsedIdx) === Number(versionIndex)) {
          setState('already-endorsed')
          return
        }
      } catch (checkError) {
        console.warn('Failed to check existing endorsement status:', checkError)
      }

      setState('checking')
      setErrorMessage(null)
      setIsInsufficientBalance(false)

      // Step 1: Get token contract address from DeepFamily contract
      const deepTokenAddress = await contract.DEEP_FAMILY_TOKEN_CONTRACT()

      // Step 2: Create token contract instance with necessary functions
      const tokenContract = new ethers.Contract(
        deepTokenAddress,
        [
          'function allowance(address,address) view returns (uint256)',
          'function approve(address,uint256) returns (bool)',
          'function recentReward() view returns (uint256)',
          'function increaseAllowance(address,uint256) returns (bool)',
          'function balanceOf(address) view returns (uint256)',
          'function decimals() view returns (uint8)'
        ],
        signer
      )

      // Step 3: Get the endorsement fee (recentReward)
      const fee: bigint = await tokenContract.recentReward()
      let decimals = 18
      try {
        decimals = Number(await tokenContract.decimals())
      } catch {}
      const feeFormatted = ethers.formatUnits(fee, decimals)
      setEndorsementFee(feeFormatted)

      // Step 4: Check user balance first
      const balance: bigint = await tokenContract.balanceOf(address)
      const balanceFormatted = ethers.formatUnits(balance, decimals)
      setUserBalance(balanceFormatted)

      // Check if balance is sufficient
      if (balance < fee) {
        console.error('❌ Insufficient balance:', { balance: balanceFormatted, required: feeFormatted })
        setIsInsufficientBalance(true)
        setErrorMessage(t('endorse.insufficientBalance', 'Insufficient DEEP balance') + `: ${balanceFormatted} < ${feeFormatted}`)
        setState('error')
        return
      }

      // If fee is 0, no approval needed - proceed directly to endorse
      if (fee === 0n) {
        setState('working')
        const result = await endorseVersion(personHash, versionIndex, undefined, { suppressToasts: true })
        setTxHash(result?.hash || result?.transactionHash || null)
        setEndorsementCount((prev) => (prev === null ? 1 : prev + 1))
        setState('success')
        onSuccess?.(result)
        return
      }

      // Step 5: Get spender address (DeepFamily contract)
      const spender = await contract.getAddress()

      // Step 6: Check current allowance
      const currentAllowance: bigint = await tokenContract.allowance(address, spender)

      // Step 7: If allowance is insufficient, request approval
      if (currentAllowance < fee) {
        setState('approving')

        // Use direct approve for exact amount (safer than unlimited approval)
        let tx
        try {
          tx = await tokenContract.approve(spender, fee)
        } catch (approveError: any) {
          console.error('❌ Direct approve failed:', approveError)
          // Fallback: try increaseAllowance if approve fails
          const delta = fee - currentAllowance
          if (delta > 0n) {
            tx = await tokenContract.increaseAllowance(spender, delta)
          } else {
            throw approveError
          }
        }


        // Wait for approval confirmation
        const receipt = await tx.wait()

        // Wait for blockchain state to be updated after approval transaction
        let postAllowance: bigint = currentAllowance
        let retryCount = 0
        const maxRetries = 32

        while (retryCount < maxRetries && postAllowance < fee) {
          const waitTime = Math.min(500 + (retryCount * 300), 2000)

          try {
            await new Promise(resolve => setTimeout(resolve, waitTime))
            postAllowance = await tokenContract.allowance(address, spender)

            if (postAllowance >= fee) {
              break
            }
          } catch (error) {
            console.warn(`❌ Post-approval allowance check failed on attempt ${retryCount + 1}:`, error)
          }

          retryCount++
        }

      } else {
      }

      // Step 8: Final allowance check before endorseVersion call
      const finalAllowance: bigint = await tokenContract.allowance(address, spender)
      const finalRequired: bigint = await tokenContract.recentReward()

      if (finalAllowance < finalRequired) {
        const errorMsg = t('endorse.errors.needApprove', 'Allowance insufficient. Please re-approve the token allowance.')
        console.error('❌ Final allowance insufficient')
        throw new Error(errorMsg)
      }


      // Step 9: Now proceed with endorsement
      setState('working')
      const result = await endorseVersion(personHash, versionIndex, undefined, { suppressToasts: true })
      setTxHash(result?.hash || result?.transactionHash || null)
      setEndorsementCount((prev) => (prev === null ? 1 : prev + 1))
      setState('success')
      onSuccess?.(result)
    } catch (err: any) {
      console.error('❌ Endorse flow failed:', err)
      setState('error')
      
      // Check for specific error types
      const errMsg = err?.message || ''
      if (errMsg.includes('Insufficient DEEP token balance') || errMsg.includes('insufficient')) {
        setIsInsufficientBalance(true)
        setErrorMessage(t('endorse.insufficientBalance', 'Insufficient DEEP balance'))
      } else if (err?.code === 'ACTION_REJECTED' || err?.code === 4001 || errMsg.includes('user rejected') || errMsg.includes('User denied')) {
        setErrorMessage(t('endorse.errors.userRejected', 'Transaction was rejected by user'))
      } else {
        const friendly = getFriendlyError(err, t)
        setErrorMessage(friendly.message)
      }
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

  const isProcessing = state === 'checking' || state === 'approving' || state === 'working'

  // Get status message based on current state
  const getStatusMessage = () => {
    switch (state) {
      case 'checking':
        return t('endorse.checkingAllowance', 'Checking token allowance...')
      case 'approving':
        return t('endorse.approving', 'Approving DEEP tokens...')
      case 'working':
        return t('endorse.processing', 'Submitting endorsement...')
      default:
        return t('endorse.quickWaiting', 'Preparing endorsement...')
    }
  }

  // Check if user can afford endorsement
  const canAfford = userBalance && endorsementFee 
    ? parseFloat(userBalance) >= parseFloat(endorsementFee) 
    : true

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

        {/* Token Balance & Fee Info */}
        {(endorsementFee || userBalance) && (
          <div className="rounded-xl border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/20 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
              <Coins className="w-4 h-4" />
              <span className="font-medium">DEEP {t('endorse.tokenInfo', 'Token Info')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {endorsementFee && (
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">{t('endorse.fee', 'Fee')}</span>
                  <span className="font-mono text-purple-700 dark:text-purple-300">{endorsementFee} DEEP</span>
                </div>
              )}
              {userBalance && (
                <div className="flex flex-col">
                  <span className="text-gray-500 dark:text-gray-400">{t('endorse.yourBalance', 'Your Balance')}</span>
                  <span className={`font-mono ${canAfford ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {userBalance} DEEP
                  </span>
                </div>
              )}
            </div>
            {!canAfford && (
              <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mt-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{t('endorse.needMoreTokens', 'You need more DEEP tokens to endorse this version')}</span>
              </div>
            )}
          </div>
        )}

        {/* Status panel - only show when not insufficient balance (that's shown above) */}
        {!(state === 'error' && isInsufficientBalance) && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-900">
            {(state === 'checking' || state === 'approving' || state === 'working') && (
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <div className="flex-1">
                  <span className="text-sm">{getStatusMessage()}</span>
                  {state === 'approving' && (
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-blue-500 dark:text-blue-300">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{t('endorse.confirmInWallet', 'Please confirm in your wallet')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {(state === 'success' || state === 'already-endorsed') && (
              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
                <Check className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">
                    {state === 'already-endorsed'
                      ? t('endorse.alreadyEndorsed', 'You already endorsed this version')
                      : t('endorse.success', 'Endorsed successfully')}
                  </div>
                  {state === 'success' && txHash && (
                    <code className="block text-xs font-mono text-gray-700 dark:text-gray-200 break-all">
                      {txHash}
                    </code>
                  )}
                </div>
              </div>
            )}
            {state === 'error' && !isInsufficientBalance && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 text-red-600 dark:text-red-400">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{errorMessage || t('endorse.transactionFailed', 'Transaction failed. Please try again.')}</span>
                  </div>
                </div>
                {hasValidTarget && (
                  <button
                    onClick={() => {
                      setHasTriggered(false)
                      setState('idle')
                      setErrorMessage(null)
                      setIsInsufficientBalance(false)
                      // Trigger will happen via useEffect
                      setTimeout(() => setHasTriggered(false), 0)
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 transition"
                    disabled={isProcessing}
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {t('common.retry', 'Retry')}
                  </button>
                )}
              </div>
            )}
            {state === 'idle' && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('endorse.quickWaiting', 'Preparing endorsement...')}
              </div>
            )}
          </div>
        )}

      </div>
    </div>,
    document.body
  )
}
