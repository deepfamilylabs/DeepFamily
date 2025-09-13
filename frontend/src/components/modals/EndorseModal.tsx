import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Star, Coins, AlertCircle, Users } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'
import { useSearchParams } from 'react-router-dom'

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
  const { address, signer } = useWallet()
  const { endorseVersion, getVersionDetails, contract } = useContract()
  const [searchParams] = useSearchParams()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deepTokenFee, setDeepTokenFee] = useState<string>('0')
  const [deepTokenFeeRaw, setDeepTokenFeeRaw] = useState<bigint>(0n)
  const [currentEndorsementCount, setCurrentEndorsementCount] = useState(versionData?.endorsementCount || 0)
  const [hasEndorsed, setHasEndorsed] = useState(false)
  const [feeRecipient, setFeeRecipient] = useState<string>('')
  const [userDeepBalance, setUserDeepBalance] = useState<string>('0')
  const [deepTokenAddress, setDeepTokenAddress] = useState<string>('')
  const [deepTokenDecimals, setDeepTokenDecimals] = useState<number>(18)
  const [deepTokenSymbol, setDeepTokenSymbol] = useState<string>('DEEP')
  const [isApproving, setIsApproving] = useState(false)
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  const [isTargetValidOnChain, setIsTargetValidOnChain] = useState<boolean>(false)
  const isBytes32 = (v: string | undefined | null) => !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim())
  // Local fallback state when parent does not control inputs
  const [localPersonHash, setLocalPersonHash] = useState<string>('')
  // Default to 1 so typing only the hash enables the action
  const [localVersionIndex, setLocalVersionIndex] = useState<number>(1)

  // Unified target values: prefer props if provided, otherwise local state
  const targetPersonHash = (personHash ?? localPersonHash)?.trim()
  const targetVersionIndex = (versionIndex ?? localVersionIndex)  
  const isPersonHashFormatValid = isBytes32(targetPersonHash)
  
  // Determine modes and validity
  const hasValidTarget = Boolean(targetPersonHash && targetPersonHash !== '' && targetVersionIndex !== undefined && targetVersionIndex > 0)
  // View mode only when target provided via parent props (navigation/use elsewhere)
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

  // Load endorsement details when modal opens (when target is valid)
  useEffect(() => {
    const loadEndorsementData = async () => {
      if (!isOpen || !address || !contract) return
      // Always attempt to load token basics (fee + balance), even if target not set yet
      // Then load target-specific details if hash/index are ready
      try {
        // Get current DEEP token fee (recentReward)
        const deepTokenContract = await contract.DEEP_FAMILY_TOKEN_CONTRACT()
        setDeepTokenAddress(deepTokenContract)
        const tokenContract = new ethers.Contract(
          deepTokenContract,
          [
            'function recentReward() view returns (uint256)',
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function allowance(address,address) view returns (uint256)',
            'function symbol() view returns (string)'
          ],
          contract.runner
        )
        
        const fee = await tokenContract.recentReward()
        const decimals = await tokenContract.decimals()
        try {
          const sym = await tokenContract.symbol()
          if (sym) setDeepTokenSymbol(sym)
        } catch {}
        setDeepTokenDecimals(Number(decimals))
        const balance = await tokenContract.balanceOf(address)
        setDeepTokenFee(ethers.formatUnits(fee, decimals))
        setDeepTokenFeeRaw(fee)
        setUserDeepBalance(ethers.formatUnits(balance, decimals))

        // Target-specific loads
        if (hasValidTarget && getVersionDetails && targetPersonHash && targetVersionIndex !== undefined) {
          try {
            const details = await getVersionDetails(targetPersonHash, targetVersionIndex)
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
              setIsTargetValidOnChain(true)
            } else {
              setIsTargetValidOnChain(false)
            }
          } catch (e) {
            setIsTargetValidOnChain(false)
          }
          // Check if current user has already endorsed this version (placeholder)
          try {
            const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash, address)
            setHasEndorsed(Number(endorsedIdx) === Number(targetVersionIndex))
          } catch {
            setHasEndorsed(false)
          }
        }
      } catch (error) {
        console.error('Failed to load endorsement data:', error)
      }
    }
    loadEndorsementData()
  }, [isOpen, address, getVersionDetails, contract, hasValidTarget, targetPersonHash, targetVersionIndex])

  // Initialize from URL parameters on open if parent didn't pass values
  useEffect(() => {
    if (!isOpen) return
    // Only set local state if props are not provided/controlled
    const hasPropHash = typeof personHash === 'string' && personHash.trim() !== ''
    const hasPropIndex = typeof versionIndex === 'number' && versionIndex > 0
    if (hasPropHash && hasPropIndex) return
    try {
      const qHash = searchParams.get('hash') || searchParams.get('personHash') || ''
      const qIndexStr = searchParams.get('vi') || searchParams.get('version') || searchParams.get('versionIndex') || ''
      const qIndex = qIndexStr ? parseInt(qIndexStr, 10) : NaN
      if (!hasPropHash && qHash) setLocalPersonHash(qHash)
      if (!hasPropIndex && Number.isFinite(qIndex) && qIndex > 0) setLocalVersionIndex(qIndex)
    } catch {}
  }, [isOpen, personHash, versionIndex, searchParams])

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

    if (!hasValidTarget) {
      alert(t('endorse.personHashRequired', 'Please provide valid person hash and version index'))
      return
    }

    if (parseFloat(userDeepBalance) < parseFloat(deepTokenFee)) {
      alert(t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement'))
      return
    }

    setIsSubmitting(true)

    try {
      // Ensure ERC20 allowance for endorsement fee
      if (!contract || !deepTokenAddress || !signer) throw new Error('Contract not ready')
      const spender = await contract.getAddress()
      const tokenContract = new ethers.Contract(
        deepTokenAddress,
        [
          'function allowance(address,address) view returns (uint256)',
          'function approve(address,uint256) returns (bool)',
          'function recentReward() view returns (uint256)',
          'function increaseAllowance(address,uint256) returns (bool)'
        ],
        signer
      )
      // Re-fetch latest fee (it may change dynamically)
      const latestFee: bigint = await tokenContract.recentReward()
      const required: bigint = latestFee > 0n ? latestFee : deepTokenFeeRaw
      const currentAllowance: bigint = await tokenContract.allowance(address, spender)
      if (currentAllowance < required) {
        setIsApproving(true)
        // Prefer increasing by delta to avoid resetting allowance downwards
        const delta = required - currentAllowance
        let tx
        try {
          tx = await tokenContract.increaseAllowance(spender, delta)
        } catch {
          tx = await tokenContract.approve(spender, required)
        }
        await tx.wait()
        setIsApproving(false)
      }

      // Early success if already endorsed the same version (contract would early-return too)
      try {
        const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash!, address)
        if (Number(endorsedIdx) === Number(targetVersionIndex)) {
          setHasEndorsed(true)
          onSuccess?.({ alreadyEndorsed: true })
          setIsSubmitting(false)
          return
        }
      } catch {}

      // Preflight: staticCall to catch reverts before wallet pops (ethers v6)
      try {
        const fn: any = (contract as any)?.endorseVersion?.staticCall
        if (typeof fn === 'function') {
          await fn(targetPersonHash!, targetVersionIndex!)
        }
      } catch (simErr: any) {
        const msg = String(simErr?.message || '')
        if (/InvalidVersionIndex|InvalidPersonHash/i.test(msg)) {
          alert(t('endorse.invalidTarget', 'Invalid person hash or version index'))
        } else if (/insufficient allowance|ERC20InsufficientAllowance/i.test(msg)) {
          alert(t('endorse.needApprove', 'Allowance too low, please approve DEEP tokens again'))
        } else if (/insufficient funds|ERC20InsufficientBalance/i.test(msg)) {
          alert(t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement'))
        } else {
          alert(msg || t('endorse.endorseFailed', 'Failed to endorse version'))
        }
        throw simErr
      }

      // Gas estimate with safety margin to avoid wallet estimation quirks
      let overrides: any = {}
      try {
        const estFn: any = (contract as any)?.endorseVersion?.estimateGas
        if (typeof estFn === 'function') {
          const est: bigint = await estFn(targetPersonHash!, targetVersionIndex!)
          if (typeof est === 'bigint') {
            const padded = (est * 12n) / 10n + 30000n
            overrides.gasLimit = padded
          }
        }
      } catch {}

      const result = await endorseVersion(targetPersonHash!, targetVersionIndex!, overrides)

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
      const msg = String(error?.message || '')
      // Provide clearer hints for common cases
      if (/InvalidVersionIndex|InvalidPersonHash/i.test(msg)) {
        alert(t('endorse.invalidTarget', 'Invalid person hash or version index'))
      } else if (/insufficient allowance|ERC20InsufficientAllowance/i.test(msg)) {
        alert(t('endorse.needApprove', 'Allowance too low, please approve DEEP tokens again'))
      } else if (/insufficient funds|ERC20InsufficientBalance/i.test(msg)) {
        alert(t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement'))
      } else {
        alert(msg || t('endorse.endorseFailed', 'Failed to endorse version'))
      }
    } finally {
      setIsApproving(false)
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
          className={`relative flex flex-col w-full max-w-4xl h-[95vh] sm:h-auto sm:max-h-[95vh] bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transform transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'} will-change-transform`}
          onClick={(e) => e.stopPropagation()}
          style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined, transitionDuration: dragging ? '0ms' : undefined }}
        >
        {/* Header */}
        <div 
          className="sticky top-0 bg-gradient-to-br from-green-500/10 via-blue-500/8 to-indigo-500/10 dark:from-green-600/20 dark:via-blue-600/15 dark:to-indigo-600/20 p-4 pt-7 sm:pt-6 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60 relative touch-none cursor-grab active:cursor-grabbing select-none"
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
                
                <div className="space-y-4 sm:space-y-0 sm:flex sm:items-start sm:gap-4">
                  <div className="sm:flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.personHash', 'Person Hash')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={targetPersonHash || ''}
                      onChange={(e) => {
                        if (onPersonHashChange) onPersonHashChange(e.target.value)
                        else setLocalPersonHash(e.target.value)
                      }}
                      className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition font-mono"
                      placeholder={t('search.versionsQuery.placeholder')}
                    />
                  </div>
                  
                  <div className="w-32">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.versionIndex', 'Version Index')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={targetVersionIndex || 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1
                        if (onVersionIndexChange) onVersionIndexChange(val)
                        else setLocalVersionIndex(val)
                      }}
                      className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                      placeholder="1"
                    />
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
                      <span className="font-medium">{t('endorse.personHash', 'Person Hash')}:</span> {formatAddress(targetPersonHash || '')}
                  </div>
                  <div>
                    <span className="font-medium">{t('endorse.versionIndex', 'Version')}:</span> {targetVersionIndex}
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

          {/* Invalid target warning */}
          {hasValidTarget && isPersonHashFormatValid && !isTargetValidOnChain && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  {t('endorse.invalidTarget', 'Invalid person hash or version index')}
                </span>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                {t('endorse.invalidTargetDesc', 'Please verify the hash and index refer to an existing version')}
              </p>
            </div>
          )}

          {/* Invalid hash format warning */}
          {targetPersonHash && !isPersonHashFormatValid && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  {t('search.validation.hashInvalid', 'Please enter a valid 64-character hexadecimal hash')}
                </span>
              </div>
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
              disabled={isSubmitting || isApproving || !canAffordEndorsement || hasEndorsed || !hasValidTarget || !isTargetValidOnChain || !isPersonHashFormatValid}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {isApproving ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('endorse.approving', 'Approving...')}
                </div>
              ) : isSubmitting ? (
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
