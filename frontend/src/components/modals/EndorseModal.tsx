import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Star, Coins, AlertCircle, Check, AlertTriangle, ChevronRight, Image } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'
import { useSearchParams } from 'react-router-dom'
import { getFriendlyError } from '../../lib/errors'

interface EndorseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  onMintNFT?: (personHash: string, versionIndex: number) => void
  // Initial data - only used when opening, modal internal state is fully self-contained
  initialPersonHash?: string
  initialVersionIndex?: number
}

export default function EndorseModal({
  isOpen,
  onClose,
  onSuccess,
  onMintNFT,
  initialPersonHash,
  initialVersionIndex
}: EndorseModalProps) {
  const { t } = useTranslation()
  const { address, signer } = useWallet()
  const { endorseVersion, getVersionDetails, getNFTDetails, contract } = useContract()
  const [searchParams] = useSearchParams()
  
  // ===== Internal state - fully self-contained, follows modal lifecycle =====
  const [personHash, setPersonHash] = useState<string>('')
  const [versionIndex, setVersionIndex] = useState<number>(1)
  
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  
  // Data state
  const [deepTokenFee, setDeepTokenFee] = useState<string>('0')
  const [deepTokenFeeRaw, setDeepTokenFeeRaw] = useState<bigint>(0n)
  const [currentEndorsementCount, setCurrentEndorsementCount] = useState<number>(0)
  const [hasEndorsed, setHasEndorsed] = useState(false)
  const [feeRecipient, setFeeRecipient] = useState<string>('')
  const [userDeepBalance, setUserDeepBalance] = useState<string>('0')
  const [deepTokenAddress, setDeepTokenAddress] = useState<string>('')
  const [deepTokenDecimals, setDeepTokenDecimals] = useState<number>(18)
  const [deepTokenSymbol, setDeepTokenSymbol] = useState<string>('DEEP')
  const [protocolFeeBps, setProtocolFeeBps] = useState<number>(500)
  const [isTargetValidOnChain, setIsTargetValidOnChain] = useState<boolean>(false)
  const [isNFTMinted, setIsNFTMinted] = useState<boolean>(false)
  const [displayName, setDisplayName] = useState<string>('')
  
  // Result state
  const [successResult, setSuccessResult] = useState<{
    personHash: string
    versionIndex: number
    endorsementFee: string
    feeRecipient: string
    transactionHash: string
    blockNumber: number
    events: { PersonVersionEndorsed: any }
  } | null>(null)
  const [errorResult, setErrorResult] = useState<{
    type: string
    message: string
    details: string
  } | null>(null)
  
  // Track previous target to avoid redundant loading
  const prevTargetRef = useRef<{ hash: string; index: number }>({ hash: '', index: 0 })

  // Computed properties
  const isBytes32 = (v: string | undefined | null) => !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim())
  const targetPersonHash = personHash?.trim() || ''
  const targetVersionIndex = versionIndex
  const isPersonHashFormatValid = isBytes32(targetPersonHash)

  // Computed properties
  const hasValidTarget = Boolean(targetPersonHash && isPersonHashFormatValid && targetVersionIndex > 0)
  const hashInputInvalid = Boolean(targetPersonHash && !isPersonHashFormatValid)
  
  // Desktop/mobile detection
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(min-width: 640px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(min-width: 640px)')
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsDesktop((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches)
    try { mql.addEventListener('change', onChange as any) } catch { (mql as any).addListener(onChange) }
    onChange(mql as any)
    return () => {
      try { mql.removeEventListener('change', onChange as any) } catch { (mql as any).removeListener(onChange) }
    }
  }, [])

  // ===== Core: Modal open/close state management =====
  useEffect(() => {
    if (isOpen) {
      // On open: initialize state
      setPersonHash(initialPersonHash || '')
      setVersionIndex(initialVersionIndex || 1)
      prevTargetRef.current = { hash: initialPersonHash || '', index: initialVersionIndex || 1 }
      // Animation
      requestAnimationFrame(() => setEntered(true))
    } else {
      // On close: reset all state
      setEntered(false)
      setPersonHash('')
      setVersionIndex(1)
      setIsSubmitting(false)
      setIsApproving(false)
      setSuccessResult(null)
      setErrorResult(null)
      setHasEndorsed(false)
      setCurrentEndorsementCount(0)
      setIsTargetValidOnChain(false)
      setIsNFTMinted(false)
      setDisplayName('')
      setFeeRecipient('')
      setDragging(false)
      setDragOffset(0)
      prevTargetRef.current = { hash: '', index: 0 }
    }
  }, [isOpen, initialPersonHash, initialVersionIndex])

  // Clear old data when target changes
  useEffect(() => {
    if (!isOpen) return
    const nextHash = targetPersonHash || ''
    const nextIndex = targetVersionIndex || 0
    const changed = prevTargetRef.current.hash !== nextHash || prevTargetRef.current.index !== nextIndex
    if (!changed) return
    prevTargetRef.current = { hash: nextHash, index: nextIndex }
    setDisplayName('')
    setCurrentEndorsementCount(0)
    setIsTargetValidOnChain(false)
    setHasEndorsed(false)
    setSuccessResult(null)
    setErrorResult(null)
    setFeeRecipient('')
  }, [isOpen, targetPersonHash, targetVersionIndex])
  
  // Clear display data when input is invalid
  useEffect(() => {
    if (!hasValidTarget) {
      setDisplayName('')
      setCurrentEndorsementCount(0)
      setIsTargetValidOnChain(false)
      setHasEndorsed(false)
      setFeeRecipient('')
    }
  }, [hasValidTarget])

  // Load endorsement data
  useEffect(() => {
    const loadEndorsementData = async () => {
      if (!isOpen || !address || !contract) return
      try {
        // Load DEEP token information
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

        try {
          const feeBps = await contract.protocolEndorsementFeeBps()
          setProtocolFeeBps(Number(feeBps))
        } catch {}

        // Load target version details
        if (hasValidTarget && getVersionDetails && targetPersonHash) {
          try {
            const details = await getVersionDetails(targetPersonHash, targetVersionIndex)
            if (details) {
              let name = ''
              const tokenId = Number(details.tokenId)
              
              if (tokenId > 0 && getNFTDetails) {
                try {
                  const nftDetails = await getNFTDetails(tokenId)
                  name = (nftDetails as any)?.coreInfo?.supplementInfo?.fullName ||
                         (nftDetails as any)?.coreInfo?.fullName || ''
                } catch {}
              }
              
              if (!name) {
                name = (details as any)?.version?.coreInfo?.supplementInfo?.fullName ||
                       (details as any)?.version?.coreInfo?.fullName ||
                       (details as any)?.version?.fullName || ''
              }

              if (name) setDisplayName(name)
              setCurrentEndorsementCount(Number(details.endorsementCount))
              
              setIsNFTMinted(tokenId > 0)
              if (tokenId > 0) {
                const nftHolder = await contract.ownerOf(tokenId)
                setFeeRecipient(nftHolder)
              } else {
                setFeeRecipient(details.version.addedBy)
              }
              setIsTargetValidOnChain(true)
            } else {
              setIsTargetValidOnChain(false)
            }
          } catch {
            setIsTargetValidOnChain(false)
          }
          
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
  }, [isOpen, address, getVersionDetails, getNFTDetails, contract, hasValidTarget, targetPersonHash, targetVersionIndex])

  // 简化的关闭处理 - 状态重置由 isOpen useEffect 统一处理
  const handleClose = () => onClose()

  // Escape 键关闭
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Close on mobile back button
  useEffect(() => {
    if (!isOpen) return
    const marker = { __dfModal: 'EndorseModal', id: Math.random().toString(36).slice(2) }
    try { window.history.pushState(marker, '') } catch {}
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [isOpen, onClose])

  // Continue endorsing: reset form state, keep modal open
  const handleContinueEndorsing = () => {
    setPersonHash('')
    setVersionIndex(1)
    setIsSubmitting(false)
    setIsApproving(false)
    setSuccessResult(null)
    setErrorResult(null)
    setHasEndorsed(false)
    setCurrentEndorsementCount(0)
    setDisplayName('')
    setIsTargetValidOnChain(false)
    setFeeRecipient('')
    prevTargetRef.current = { hash: '', index: 0 }
  }

  const handleEndorse = async (isRetry = false) => {
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

    // Clear old results
    setSuccessResult(null)
    setErrorResult(null)
    setIsSubmitting(true)

    // Log retry attempts
    if (isRetry) {
    }

    try {
      
      // Early success if already endorsed the same version; skip approvals entirely
      try {
        if (contract && address && targetPersonHash) {
          const endorsedIdx = await contract.endorsedVersionIndex(targetPersonHash, address)
          if (Number(endorsedIdx) === Number(targetVersionIndex)) {
            setHasEndorsed(true)
            onSuccess?.({ alreadyEndorsed: true })
            setIsSubmitting(false)
            return
          }
        }
      } catch {}

      // Ensure ERC20 allowance for endorsement fee
      if (!contract || !deepTokenAddress || !signer) {
        console.error('❌ Contract not ready:', { contract: !!contract, deepTokenAddress, signer: !!signer })
        throw new Error('Contract not ready')
      }
      const spender = await contract.getAddress()

      // IMPORTANT: Double-check if this is really a fresh wallet connection
      const tokenContract = new ethers.Contract(
        deepTokenAddress,
        [
          'function allowance(address,address) view returns (uint256)',
          'function approve(address,uint256) returns (bool)',
          'function recentReward() view returns (uint256)',
          'function increaseAllowance(address,uint256) returns (bool)',
          'function balanceOf(address) view returns (uint256)'
        ],
        signer
      )
      // Re-fetch latest fee (it may change dynamically)
      const latestFee: bigint = await tokenContract.recentReward()
      const required: bigint = latestFee > 0n ? latestFee : deepTokenFeeRaw
      
      const currentAllowance: bigint = await tokenContract.allowance(address, spender)

      // Check user's DEEP token balance before proceeding
      let userBalance: bigint = 0n
      try {
        userBalance = await tokenContract.balanceOf(address)
      } catch (balanceError) {
        console.warn('Failed to check token balance:', balanceError)
      }

      // If allowance was reset unexpectedly, log more details
      if (currentAllowance === 0n) {
        console.warn('⚠️ Allowance is 0 - this may indicate allowance was consumed or reset after previous transaction')
        if (userBalance < required) {
          throw new Error(`Insufficient DEEP token balance: have ${ethers.formatUnits(userBalance, deepTokenDecimals)}, need ${ethers.formatUnits(required, deepTokenDecimals)}`)
        }
      } else if (currentAllowance > 0n) {
      }

      if (currentAllowance < required) {
        setIsApproving(true)

        // Log comprehensive approval transaction data before sending
        const approvalData: any = {
          type: 'TOKEN_APPROVAL',
          spender: spender,
          tokenAddress: deepTokenAddress,
          currentAllowance: currentAllowance.toString(),
          requiredAmount: required.toString(),
          approver: address,
          timestamp: new Date().toISOString()
        }

        // Get nonce for approval transaction - use 'pending' to get latest nonce
        try {
          if (signer && signer.provider) {
            approvalData.nonce = await signer.provider.getTransactionCount(address, 'pending')
          } else if (signer && typeof signer.getNonce === 'function') {
            approvalData.nonce = await signer.getNonce()
          }
        } catch (error) {
          console.warn('Failed to get nonce for approval:', error)
        }


        let tx
        try {
          {
            // Use direct approve for exact amount (safer than unlimited approval)
            // This is more reliable than increaseAllowance for precise amount approval
            try {
              tx = await tokenContract.approve(spender, required)
            } catch (approveError) {
              console.error('❌ Direct approve failed:', approveError)
              // Fallback: try increaseAllowance if approve fails
              const delta = required - currentAllowance
              if (delta > 0n) {
                tx = await tokenContract.increaseAllowance(spender, delta)
              } else {
                throw approveError
              }
            }
          }
        } catch (approveError: any) {
          setIsApproving(false)
          if (approveError.code === 'ACTION_REJECTED' || approveError.message?.includes('user rejected')) {
            throw new Error('User rejected token approval')
          }
          throw approveError
        }
        try {
          const receipt = await tx.wait()

          // Immediately verify the approval was successful
          try {
            const immediateAllowance = await tokenContract.allowance(address, spender)
          } catch (immediateCheckError) {
            console.error('❌ Failed to check immediate allowance:', immediateCheckError)
          }
        } catch (waitError: any) {
          setIsApproving(false)
          throw waitError
        }
        // Wait for blockchain state to be updated after approval transaction
        // This is crucial for the final allowance check to pass
        let postAllowance: bigint = currentAllowance
        let retryCount = 0
        const maxRetries = 32

        while (retryCount < maxRetries && postAllowance < required) {
          const waitTime = Math.min(500 + (retryCount * 300), 2000) // 500ms, 800ms, 1100ms, 1400ms, 1700ms, 2000ms...

          try {
            await new Promise(resolve => setTimeout(resolve, waitTime))
            postAllowance = await tokenContract.allowance(address, spender)

            if (postAllowance >= required) {
              break
            }
          } catch (error) {
            console.warn(`❌ Post-approval allowance check failed on attempt ${retryCount + 1}:`, error)
          }

          retryCount++
        }
        setIsApproving(false)
      } else {
      }

      // Final allowance check before endorseVersion call
      let finalAllowance: bigint = 0n
      let finalRequired: bigint = 0n

      try {
        finalAllowance = await tokenContract.allowance(address, spender)
        finalRequired = await tokenContract.recentReward()

        if (finalAllowance < finalRequired) {
          const errorMsg = `Final allowance check failed: have ${ethers.formatUnits(finalAllowance, deepTokenDecimals)}, need ${ethers.formatUnits(finalRequired, deepTokenDecimals)}`
          console.error('❌ Final allowance insufficient:', errorMsg)
          throw new Error(errorMsg)
        }

      } catch (checkError) {
        console.error('❌ Final allowance check failed:', checkError)
        throw checkError
      }

      // Preflight: staticCall to catch reverts before wallet pops (ethers v6)
      try {
        const fn: any = (contract as any)?.endorseVersion?.staticCall
        if (typeof fn === 'function') {
          await fn(targetPersonHash!, targetVersionIndex!)
        } else {
          console.warn('⚠️ staticCall not available, skipping preflight check')
        }
      } catch (simErr: any) {
        console.error('❌ Preflight check failed:', simErr)
        // Handle preflight errors through our error display system instead of alert
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

      // Helper to apply success state from a mined receipt
      const applySuccessFromReceipt = (result: any) => {
        if (!result) return
        try {
          // Clear any pending/pseudo-error state
          setErrorResult(null)
          // Extract event data from receipt
          let endorsedEvent: any = null
          try {
            const endorsedEvents = result.logs?.filter((log: any) => {
              try {
                const parsedLog = contract?.interface.parseLog(log)
                return parsedLog?.name === 'PersonVersionEndorsed'
              } catch {
                return false
              }
            }) || []
            if (endorsedEvents.length > 0) {
              endorsedEvent = contract?.interface.parseLog(endorsedEvents[0])
            }
          } catch (e) {
            console.warn('Failed to parse endorsement event:', e)
            endorsedEvent = {
              args: {
                personHash: targetPersonHash!,
                endorser: address,
                versionIndex: targetVersionIndex!,
                endorsementFee: deepTokenFeeRaw.toString(),
                timestamp: Math.floor(Date.now() / 1000)
              }
            }
          }

          setCurrentEndorsementCount(prev => prev + 1)
          setHasEndorsed(true)
          // Update user balance (best effort UI hint)
          const newBalance = parseFloat(userDeepBalance) - parseFloat(deepTokenFee)
          if (!Number.isNaN(newBalance)) setUserDeepBalance(newBalance.toString())

          setSuccessResult(prev => prev ?? ({
            personHash: targetPersonHash!,
            versionIndex: targetVersionIndex!,
            endorsementFee: deepTokenFee,
            feeRecipient: feeRecipient,
            transactionHash: result.hash || result.transactionHash || '',
            blockNumber: result.blockNumber || 0,
            events: {
              PersonVersionEndorsed: endorsedEvent ? {
                personHash: endorsedEvent.args?.personHash || targetPersonHash!,
                endorser: endorsedEvent.args?.endorser || address,
                versionIndex: endorsedEvent.args?.versionIndex || targetVersionIndex!,
                recipient: endorsedEvent.args?.recipient,
                recipientShare: endorsedEvent.args?.recipientShare,
                protocolRecipient: endorsedEvent.args?.protocolRecipient,
                protocolShare: endorsedEvent.args?.protocolShare,
                endorsementFee: endorsedEvent.args?.endorsementFee || deepTokenFeeRaw.toString(),
                timestamp: endorsedEvent.args?.timestamp || Math.floor(Date.now() / 1000)
              } : null
            }
          }))
        } catch (e) {
          console.warn('Failed to apply endorsement success from receipt:', e)
        }
      }


      // Get nonce from signer if available - use 'pending' to get latest nonce including pending transactions
      let nonce: number | undefined
      try {
        if (signer && signer.provider) {
          nonce = await signer.provider.getTransactionCount(address, 'pending')
        } else if (signer && typeof signer.getNonce === 'function') {
          nonce = await signer.getNonce()
        }
      } catch (error) {
        console.warn('Failed to get nonce:', error)
      }

      const endorsePromise = endorseVersion(targetPersonHash!, targetVersionIndex!, overrides)

      // Prevent indefinite spinner if wallet/provider never resolves. Fallback after 40s.
      let timedOut = false
      const timeoutMs = 40_000
      const timeout = setTimeout(() => {
        timedOut = true
        console.warn('⏳ Endorse transaction still pending after timeout; keeping UI responsive')
        setIsSubmitting(false)
        // Provide a gentle hint in the UI without marking as an error
        setErrorResult(prev => prev ?? ({
          type: 'PENDING_CONFIRMATION',
          message: t('transaction.pending', 'Transaction pending confirmation...'),
          details: t('transaction.pendingDetails', 'The transaction is submitted or awaiting wallet confirmation. You can keep using the app; we will update once it confirms.')
        }))
      }, timeoutMs)

      let result: any = null
      try {
        result = await endorsePromise
      } catch (endorseError: any) {
        console.error('❌ endorseVersion promise rejected:', endorseError)
        clearTimeout(timeout)

        // Don't throw immediately - let the error handling below take care of it
        if (timedOut) {
          console.warn('Transaction timed out and also failed')
          return
        }

        // Re-throw to be caught by outer catch block
        throw endorseError
      } finally {
        clearTimeout(timeout)
      }

      if (timedOut) {
        // Receipt arrived later; apply success now without re-enabling spinner
        if (result) applySuccessFromReceipt(result)
        return
      }


      if (result) {
        const updatedCount = currentEndorsementCount + 1
        applySuccessFromReceipt(result)
        // Notify parent with latest endorsement count for node refresh
        onSuccess?.({ ...result, endorsementCount: updatedCount })
      } else {
        // endorseVersion returned null, meaning the transaction failed
        // The error was already handled by executeTransaction and shown via toast
        // We should show our error UI as well
        setErrorResult({
          type: 'TRANSACTION_FAILED',
          message: t('endorse.transactionFailed', 'Transaction failed. Please check the error message and try again.'),
          details: t('endorse.transactionFailedDetails', 'The transaction was submitted but failed to complete successfully.')
        })
      }
    } catch (error: any) {
      console.error('❌ Endorse failed:', error)

      const friendly = getFriendlyError(error, t)
      setErrorResult({
        type: friendly.reason || friendly.type || error.type || 'UNKNOWN_ERROR',
        message: friendly.message,
        details: friendly.details
      })
    } finally {
      setIsApproving(false)
      setIsSubmitting(false)
    }
  }

  const formatAddress = (addr: string) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  // Helper component for data rows in success result
  const DataRow = ({
    label,
    value,
    colorClass,
    isPlainText = false
  }: {
    label: string
    value: string
    colorClass: 'green'
    isPlainText?: boolean
  }) => {
    const colorConfig = {
      green: {
        labelColor: 'text-green-800 dark:text-green-200',
        valueBg: 'bg-green-100 dark:bg-green-800',
        valueColor: 'text-green-900 dark:text-green-100'
      }
    }

    const config = colorConfig[colorClass]

    return (
      <div className="flex flex-col gap-1">
        <span className={`text-xs font-medium ${config.labelColor}`}>
          {label}
        </span>
        {isPlainText ? (
          <span className={`text-xs ${config.valueColor}`}>
            {value}
          </span>
        ) : (
          <code className={`${config.valueBg} ${config.valueColor} px-2 py-1 rounded font-mono text-xs break-all`}>
            {value}
          </code>
        )}
      </div>
    )
  }

  const canAffordEndorsement = parseFloat(userDeepBalance) >= parseFloat(deepTokenFee)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm overflow-x-hidden touch-pan-y" onClick={isDesktop ? undefined : handleClose}>
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
        <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
          <div className="flex-1 p-4 sm:p-6 space-y-6">
          
          {/* Person Hash and Version Input (always shown as editable) */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('endorse.targetVersion', 'Target Version')}
              </h3>
              
              <div className="p-4 bg-amber-50/50 dark:bg-amber-900/20 rounded-xl border border-amber-200/50 dark:border-amber-700/50">
                <div className="space-y-4 sm:space-y-0 sm:flex sm:items-start sm:gap-4">
                  <div className="sm:flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.personHash', 'Person Hash')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={personHash}
                      onChange={(e) => setPersonHash(e.target.value)}
                      className={`w-full h-10 rounded-md border bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 outline-none transition font-mono ${
                        hashInputInvalid
                          ? 'border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30 dark:border-red-400 dark:focus:border-red-400 dark:focus:ring-red-400/30'
                          : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30'
                      }`}
                      placeholder={t('search.versionsQuery.placeholder')}
                    />
                    {hashInputInvalid && (
                      <div className="mt-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {t('endorse.invalidPersonHashFormat', 'Person hash must be 0x-prefixed 32-byte hex (64 hex chars).')}
                      </div>
                    )}
                    {!hashInputInvalid && hasValidTarget && (
                      <div className="mt-3 space-y-1 text-sm">
                        {isTargetValidOnChain && (
                          <div className="flex flex-wrap items-center gap-3">
                            {displayName && (
                              <div className="font-medium text-gray-900 dark:text-gray-100">{displayName}</div>
                            )}
                            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {t('endorse.currentEndorsements', 'Current Endorsements')}
                              </span>
                              <span className="text-sm font-mono text-purple-800 dark:text-purple-200">
                                {currentEndorsementCount}
                              </span>
                            </div>
                          </div>
                        )}
                        {!isTargetValidOnChain && (
                          <div className="text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <div>
                              <span className="font-medium">{t('endorse.invalidTarget', 'Invalid person hash or version index')}</span>
                              <div>{t('endorse.invalidTargetDesc', 'Please verify the hash and index refer to an existing version')}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="w-32">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('endorse.versionIndex', 'Version Index')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={versionIndex}
                      onChange={(e) => setVersionIndex(parseInt(e.target.value) || 1)}
                      className="w-20 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                      placeholder="1"
                    />
                  </div>
                </div>
              </div>
              {/* Invalid target warning moved below hash input */}
            </div>



          {/* DEEP Token Fee & Distribution Info */}
          <div className="bg-gradient-to-br from-purple-50 to-amber-50 dark:from-purple-900/20 dark:to-amber-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-4">
            <div className="text-xs text-purple-700 dark:text-purple-300 space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-purple-800 dark:text-purple-200">
                  {t('endorse.deepTokenFee', 'Endorsement fee')}
                </span>
                <span className="font-mono text-purple-800 dark:text-purple-100">{deepTokenFee} DEEP</span>
              </div>

              {/* User Balance */}
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{t('endorse.yourBalance', 'Your balance')}:</span>
                <span className={`font-mono ${canAffordEndorsement ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {userDeepBalance} DEEP
                </span>
              </div>

              {/* Inline insufficient balance warning */}
              {!canAffordEndorsement && !hasEndorsed && (
                <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400" />
                  <p className="text-sm">
                    {t('endorse.needMoreTokens', 'You need more DEEP tokens to endorse this version')}
                  </p>
                </div>
              )}
              
              {/* Distribution Rule */}
              <div className="pt-2 mt-2 border-t border-purple-200/50 dark:border-purple-700/50">
                <div className="flex items-start gap-2">
                  <span className="font-medium shrink-0">{t('endorse.feeDistribution', 'Fee Distribution')}:</span>
                  <span>
                    {isNFTMinted ? (
                      <>
                        <strong>{t('endorse.nftMinted', 'NFT Minted')}:</strong> {t('endorse.feeToNFTHolder', '{{recipientPercent}}% to NFT holder, {{protocolPercent}}% protocol fee', { recipientPercent: (10000 - protocolFeeBps) / 100, protocolPercent: protocolFeeBps / 100 })}
                      </>
                    ) : (
                      <>
                        <strong>{t('endorse.noNFT', 'No NFT Yet')}:</strong> {t('endorse.feeToCreator', '{{recipientPercent}}% to version creator, {{protocolPercent}}% protocol fee', { recipientPercent: (10000 - protocolFeeBps) / 100, protocolPercent: protocolFeeBps / 100 })}
                      </>
                    )}
                  </span>
                </div>
              </div>
              
            </div>
          </div>

          {/* Post-endorsement balance info */}
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

          {/* Progress Indicator with Wallet Guidance */}
          {(isSubmitting || isApproving) && !successResult && !errorResult && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-green-900 dark:text-green-100 mb-1">
                    {isApproving ?
                      t('endorse.approving', 'Approving DEEP tokens...') :
                      t('endorse.endorsing', 'Endorsing version...')
                    }
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300">
                    {isApproving ?
                      t('endorse.approvingDesc', 'Please confirm the token approval in your wallet') :
                      t('endorse.endorsingDesc', 'Processing endorsement on the blockchain...')
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {successResult && (
            <div className="space-y-4">
              {/* Success Header */}
              <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                  <Check className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-green-900 dark:text-green-100">
                    {t('endorse.successTitle', 'Endorsement Successful')}
                  </h3>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('endorse.successDesc', 'Version has been successfully endorsed')}
                  </p>
                </div>
              </div>

              {/* Complete Event Information */}
              {successResult.events.PersonVersionEndorsed && (
                <details className="group bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 overflow-hidden" open>
                  <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                      <span className="text-sm font-medium text-green-900 dark:text-green-100">
                        {t('endorse.endorsementDetails', 'Endorsement Details')}
                      </span>
                      <span className="ml-2 text-xs font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-800 px-2 py-0.5 rounded-full">
                        {(Number(successResult.events.PersonVersionEndorsed.endorsementFee) / Math.pow(10, deepTokenDecimals)).toLocaleString()} {deepTokenSymbol}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-green-600 group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-3 pb-3 space-y-3">
                  
                    {/* Basic Info */}
                    <div className="space-y-2">
                      <DataRow
                        label={t('endorse.personHash', 'Person Hash')}
                        value={successResult.personHash}
                        colorClass="green"
                      />
                      <DataRow
                        label={t('endorse.versionIndex', 'Version Index')}
                        value={successResult.versionIndex.toString()}
                        colorClass="green"
                      />
                      <DataRow
                        label={t('endorse.endorser', 'Endorser')}
                        value={successResult.events.PersonVersionEndorsed.endorser}
                        colorClass="green"
                      />
                    </div>

                    {/* Fee Distribution Section */}
                    <div className="pt-2 border-t border-green-200/50 dark:border-green-700/50">
                      <p className="text-xs font-semibold text-green-800 dark:text-green-200 mb-2">
                        {t('endorse.feeDistribution', 'Fee Distribution')}
                      </p>
                      <div className="space-y-2">
                        <DataRow
                          label={t('endorse.totalFee', 'Total Fee')}
                          value={`${(Number(successResult.events.PersonVersionEndorsed.endorsementFee) / Math.pow(10, deepTokenDecimals)).toLocaleString()} ${deepTokenSymbol}`}
                          colorClass="green"
                          isPlainText
                        />
                        {successResult.events.PersonVersionEndorsed.recipient && (
                          <>
                            <DataRow
                              label={t('endorse.recipient', 'Recipient')}
                              value={successResult.events.PersonVersionEndorsed.recipient}
                              colorClass="green"
                            />
                            <DataRow
                              label={t('endorse.recipientShare', 'Recipient Share')}
                              value={`${(Number(successResult.events.PersonVersionEndorsed.recipientShare) / Math.pow(10, deepTokenDecimals)).toLocaleString()} ${deepTokenSymbol}`}
                              colorClass="green"
                              isPlainText
                            />
                          </>
                        )}
                        {successResult.events.PersonVersionEndorsed.protocolRecipient && (
                          <>
                            <DataRow
                              label={t('endorse.protocolRecipient', 'Protocol Recipient')}
                              value={successResult.events.PersonVersionEndorsed.protocolRecipient}
                              colorClass="green"
                            />
                            <DataRow
                              label={t('endorse.protocolShare', 'Protocol Share')}
                              value={`${(Number(successResult.events.PersonVersionEndorsed.protocolShare) / Math.pow(10, deepTokenDecimals)).toLocaleString()} ${deepTokenSymbol}`}
                              colorClass="green"
                              isPlainText
                            />
                          </>
                        )}
                      </div>
                    </div>

                    {/* Transaction Info Section */}
                    <div className="pt-2 border-t border-green-200/50 dark:border-green-700/50">
                      <p className="text-xs font-semibold text-green-800 dark:text-green-200 mb-2">
                        {t('endorse.transactionInfo', 'Transaction Info')}
                      </p>
                      <div className="space-y-2">
                        <DataRow
                          label={t('endorse.transactionHash', 'Transaction Hash')}
                          value={successResult.transactionHash}
                          colorClass="green"
                        />
                        <DataRow
                          label={t('endorse.blockNumber', 'Block Number')}
                          value={successResult.blockNumber.toString()}
                          colorClass="green"
                        />
                        <DataRow
                          label={t('endorse.timestamp', 'Timestamp')}
                          value={new Date(Number(successResult.events.PersonVersionEndorsed.timestamp) * 1000).toLocaleString()}
                          colorClass="green"
                          isPlainText
                        />
                      </div>
                    </div>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Error Message */}
          {errorResult && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-red-900 dark:text-red-100 mb-2">
                    {t('endorse.endorseFailed', 'Endorsement Failed')}
                  </p>
                  <div className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-red-800 dark:text-red-200">
                        {t('endorse.errorType', 'Error Type')}
                      </span>
                      <code className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded font-mono text-xs">
                        {errorResult.type}
                      </code>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-red-800 dark:text-red-200">
                        {t('endorse.errorMessage', 'Message')}
                      </span>
                      <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                        {errorResult.message}
                      </p>
                    </div>
                    {errorResult.details !== errorResult.message && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-red-800 dark:text-red-200">
                          {t('endorse.errorDetails', 'Details')}
                        </span>
                        <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                          {errorResult.details}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Retry button for wallet timeout */}
                  {errorResult.type === 'WALLET_TIMEOUT' && (
                    <div className="mt-3">
                      <button
                        onClick={() => {
                          setErrorResult(null)
                          handleEndorse(true)
                        }}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors"
                      >
                        {t('endorse.retryTransaction', 'Retry Transaction')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Legacy Success Message (for backwards compatibility) */}
          {hasEndorsed && !successResult && (
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
            {successResult ? (
              // Success state: Show Close, Continue Endorsing and Go to Mint NFT buttons
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                >
                  {t('common.close', 'Close')}
                </button>
                <button
                  type="button"
                  onClick={handleContinueEndorsing}
                  className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Star className="w-4 h-4" />
                  {t('endorse.continueEndorsing', 'Continue Endorsing')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onMintNFT && successResult.personHash && successResult.versionIndex) {
                      // Let the parent component handle closing this modal and opening the mint NFT modal
                      onMintNFT(successResult.personHash, successResult.versionIndex)
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Image className="w-4 h-4" />
                  {t('endorse.goToMintNFT', 'Go to Mint NFT')}
                </button>
              </>
            ) : (
              // Normal state: Show Cancel and Endorse buttons
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => handleEndorse(false)}
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
              </>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
