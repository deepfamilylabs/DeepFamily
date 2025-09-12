import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Star, Coins, AlertCircle, Users } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'

interface EndorseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  personHash?: string
  versionIndex?: number
  onPersonHashChange?: (hash: string) => void
  onVersionIndexChange?: (index: number) => void
  versionData?: {
    fullName?: string
    gender?: number
    birthYear?: number
    endorsementCount?: number
    isNFTMinted?: boolean
    nftHolder?: string
    versionCreator?: string
  }
}

export default function EndorseModal({
  isOpen,
  onClose,
  onSuccess,
  personHash,
  versionIndex,
  onPersonHashChange,
  onVersionIndexChange,
  versionData
}: EndorseModalProps) {
  const { t } = useTranslation()
  const { address } = useWallet()
  const { endorseVersion, getVersionDetails, contract } = useContract()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deepTokenFee, setDeepTokenFee] = useState<string>('0')
  const [currentEndorsementCount, setCurrentEndorsementCount] = useState(versionData?.endorsementCount || 0)
  const [hasEndorsed, setHasEndorsed] = useState(false)
  const [feeRecipient, setFeeRecipient] = useState<string>('')
  const [userDeepBalance, setUserDeepBalance] = useState<string>('0')
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  
  // Determine if we're in "view mode" (valid personHash provided) or "input mode" (no valid personHash)
  const isViewMode = Boolean(personHash && personHash.trim() !== '' && versionIndex !== undefined && versionIndex > 0)

  // Desktop/mobile detection
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

  // Enter animation for mobile bottom sheet
  useEffect(() => { 
    if (isOpen) { 
      requestAnimationFrame(() => setEntered(true)) 
    } else { 
      setEntered(false) 
    } 
  }, [isOpen])

  // Load endorsement details when modal opens (only in view mode)
  useEffect(() => {
    const loadEndorsementData = async () => {
      if (!isOpen || !address || !contract || !isViewMode) return
      
      try {
        // Get current DEEP token fee (recentReward)
        const deepTokenContract = await contract.DEEP_FAMILY_TOKEN_CONTRACT()
        const tokenContract = new ethers.Contract(
          deepTokenContract,
          [
            'function recentReward() view returns (uint256)',
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)'
          ],
          contract.runner
        )
        
        const fee = await tokenContract.recentReward()
        const decimals = await tokenContract.decimals()
        const balance = await tokenContract.balanceOf(address)
        
        setDeepTokenFee(ethers.formatUnits(fee, decimals))
        setUserDeepBalance(ethers.formatUnits(balance, decimals))

        // Get current version details
        if (getVersionDetails && personHash && versionIndex !== undefined) {
          const details = await getVersionDetails(personHash, versionIndex)
          if (details) {
            setCurrentEndorsementCount(Number(details.endorsementCount))
            
            // Determine fee recipient
            const tokenId = Number(details.tokenId)
            if (tokenId > 0) {
              // NFT exists, fee goes to NFT holder
              const nftHolder = await contract.ownerOf(tokenId)
              setFeeRecipient(nftHolder)
            } else {
              // No NFT, fee goes to version creator
              const versionDetail = details.version
              setFeeRecipient(versionDetail.addedBy)
            }
          }
        }

        // Check if current user has already endorsed this version
        // This would need additional contract method to check user's endorsement status
        setHasEndorsed(false)
      } catch (error) {
        console.error('Failed to load endorsement data:', error)
      }
    }

    loadEndorsementData()
  }, [isOpen, address, personHash, versionIndex, getVersionDetails, contract, isViewMode])

  const handleClose = () => {
    setIsSubmitting(false)
    setEntered(false)
    setDragging(false)
    setDragOffset(0)
    onClose()
  }

  const handleEndorse = async () => {
    if (!address) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    if (!isViewMode) {
      alert(t('endorse.personHashRequired', 'Please provide valid person hash and version index'))
      return
    }

    if (parseFloat(userDeepBalance) < parseFloat(deepTokenFee)) {
      alert(t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement'))
      return
    }

    setIsSubmitting(true)

    try {
      const result = await endorseVersion(personHash!, versionIndex!)

      if (result) {
        setCurrentEndorsementCount(prev => prev + 1)
        setHasEndorsed(true)
        
        // Update user balance
        const newBalance = parseFloat(userDeepBalance) - parseFloat(deepTokenFee)
        setUserDeepBalance(newBalance.toString())
        
        onSuccess?.(result)
        
        // Auto-close after successful endorsement
        setTimeout(() => {
          handleClose()
        }, 2000)
      }
    } catch (error: any) {
      console.error('Endorse failed:', error)
      alert(error.message || t('endorse.endorseFailed', 'Failed to endorse version'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatAddress = (addr: string) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const canAffordEndorsement = parseFloat(userDeepBalance) >= parseFloat(deepTokenFee)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm overflow-x-hidden" onClick={handleClose} style={{ touchAction: 'pan-y' }}>
      {/* Modal Container (responsive: bottom sheet on mobile, dialog on desktop) */}
      <div className="flex items-end sm:items-center justify-center h-full w-full p-2 sm:p-4">
        <div
          className={`relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-auto sm:max-h-[95vh] bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'} select-none will-change-transform`}
          onClick={(e) => e.stopPropagation()}
          style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
        >
        {/* Header */}
        <div 
          className="sticky top-0 bg-gradient-to-br from-green-500/10 via-blue-500/8 to-indigo-500/10 dark:from-green-600/20 dark:via-blue-600/15 dark:to-indigo-600/20 p-4 pt-7 sm:pt-6 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60 relative touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => { (e.currentTarget as any).setPointerCapture?.(e.pointerId); startYRef.current = e.clientY; setDragging(true) }}
          onPointerMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.clientY - startYRef.current); setDragOffset(dy) }}
          onPointerUp={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) handleClose() }}
          onPointerCancel={() => { setDragging(false); setDragOffset(0) }}
          onTouchStart={(e) => { startYRef.current = e.touches[0].clientY; setDragging(true) }}
          onTouchMove={(e) => { if (!dragging || startYRef.current == null) return; const dy = Math.max(0, e.touches[0].clientY - startYRef.current); setDragOffset(dy) }}
          onTouchEnd={() => { if (!dragging) return; const shouldClose = dragOffset > 120; setDragging(false); setDragOffset(0); if (shouldClose) handleClose() }}
        >
          {/* Drag handle (mobile only) */}
          <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-12 rounded-full bg-gray-300/90 dark:bg-gray-700/90" />
          
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                <Star className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              {t('endorse.title', 'Endorse Version')}
            </h2>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  <span className="whitespace-nowrap">{t('endorse.description', 'Support quality data by endorsing versions')}</span>
                </div>
              </div>
          </div>
          <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleClose()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors flex-shrink-0"
              aria-label={t('common.close', 'Close')}
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0" style={{ touchAction: 'pan-y' }}>
          <div className="flex-1 p-4 sm:p-6 space-y-6">
          
          {/* Person Hash and Version Input (when not in view mode) */}
          {!isViewMode && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('endorse.targetVersion', 'Target Version')}
              </h3>
              
              <div className="p-4 bg-amber-50/50 dark:bg-amber-900/20 rounded-xl border border-amber-200/50 dark:border-amber-700/50">
                <div className="flex items-start gap-3 mb-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-amber-900 dark:text-amber-100">
                      {t('endorse.specifyVersion', 'Specify Version to Endorse')}
                    </h4>
                    <p className="text-sm text-amber-700 dark:text-amber-200 mt-1">
                      {t('endorse.specifyVersionDesc', 'Enter the person hash and version index of the version you want to endorse.')}
                    </p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.personHash', 'Person Hash')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={personHash || ''}
                      onChange={(e) => onPersonHashChange?.(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors font-mono"
                      placeholder="0x..."
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t('endorse.personHashHint', 'The unique hash identifier for the person')}
                    </p>
                  </div>
                  
                  <div className="w-32">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.versionIndex', 'Version Index')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={versionIndex || 1}
                      onChange={(e) => onVersionIndexChange?.(parseInt(e.target.value) || 1)}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors"
                      placeholder="1"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t('endorse.versionIndexHint', 'Version number to endorse')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Version Info (when in view mode) */}
          {isViewMode && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {t('endorse.versionInfo', 'Version Information')}
                </h3>
                <div className="mt-2 space-y-1 text-sm text-blue-700 dark:text-blue-200">
                  {versionData?.fullName && (
                    <div>
                      <span className="font-medium">{t('endorse.fullName', 'Full Name')}:</span> {versionData.fullName}
                    </div>
                  )}
                  <div>
                      <span className="font-medium">{t('endorse.personHash', 'Person Hash')}:</span> {formatAddress(personHash || '')}
                  </div>
                  <div>
                    <span className="font-medium">{t('endorse.versionIndex', 'Version')}:</span> {versionIndex}
                  </div>
                  <div>
                    <span className="font-medium">{t('endorse.currentEndorsements', 'Current Endorsements')}:</span> {currentEndorsementCount}
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* DEEP Token Fee Info */}
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
                {t('endorse.deepTokenFee', 'DEEP Token Fee')}: {deepTokenFee} DEEP
              </span>
            </div>
            <div className="text-xs text-purple-700 dark:text-purple-300 space-y-2">
              <div className="flex justify-between">
                <span>{t('endorse.yourBalance', 'Your DEEP Balance')}:</span>
                <span className={`font-mono ${canAffordEndorsement ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {userDeepBalance} DEEP
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('endorse.feeRecipient', 'Fee Recipient')}:</span>
                <span className="font-mono">{formatAddress(feeRecipient)}</span>
              </div>
            </div>
          </div>

          {/* Fee Distribution Explanation */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
              {t('endorse.feeDistribution', 'Fee Distribution')}
            </h3>
            <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
              {versionData?.isNFTMinted ? (
                <div>
                  <strong>{t('endorse.nftMinted', 'NFT Minted')}:</strong> {t('endorse.feeToNFTHolder', '100% of fee goes to current NFT holder')}
                </div>
              ) : (
                <div>
                  <strong>{t('endorse.noNFT', 'No NFT Yet')}:</strong> {t('endorse.feeToCreator', '100% of fee goes to version creator')}
                </div>
              )}
              <p className="text-xs opacity-75">
                {t('endorse.feeNote', 'DEEP token fee is dynamic based on current mining rewards')}
              </p>
            </div>
          </div>

          {/* Insufficient Balance Warning */}
          {!canAffordEndorsement && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  {t('endorse.insufficientBalance', 'Insufficient DEEP Token Balance')}
                </span>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                {t('endorse.needMoreTokens', 'You need more DEEP tokens to endorse this version')}
              </p>
            </div>
          )}

          {/* Endorsement Benefits */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
            <h3 className="text-sm font-medium text-green-900 dark:text-green-100 mb-2">
              {t('endorse.benefits', 'Benefits of Endorsing')}
            </h3>
            <ul className="text-xs text-green-700 dark:text-green-200 space-y-1 list-disc list-inside">
              <li>{t('endorse.benefitQuality', 'Help verify and improve data quality')}</li>
              <li>{t('endorse.benefitPriority', 'Endorsed versions get higher priority in searches')}</li>
              <li>{t('endorse.benefitNFT', 'Required step before minting NFTs')}</li>
              <li>{t('endorse.benefitEconomy', 'Support version creators and NFT holders')}</li>
            </ul>
          </div>

          {/* Success Message */}
          {hasEndorsed && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  {t('endorse.successMessage', 'You have successfully endorsed this version!')}
                </span>
              </div>
            </div>
          )}

          </div>

          {/* Submit Buttons */}
          <div className="flex gap-3 p-4 sm:p-6 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleEndorse}
              disabled={isSubmitting || !canAffordEndorsement || hasEndorsed || !isViewMode}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('endorse.endorsing', 'Endorsing...')}
                </div>
              ) : hasEndorsed ? (
                t('endorse.endorsed', 'Endorsed!')
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Star className="w-4 h-4" />
                  {t('endorse.endorse', 'Endorse')}
                </div>
              )}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}