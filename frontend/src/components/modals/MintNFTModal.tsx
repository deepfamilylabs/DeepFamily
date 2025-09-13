import React, { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X, Coins, AlertCircle, Image } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'
import PersonHashCalculator from '../PersonHashCalculator'
import EndorseModal from './EndorseModal'

// Helper: accept http/https URLs or ipfs:// URIs (or empty)
const isValidTokenUri = (v: string) => {
  if (v === '') return true
  if (v.startsWith('ipfs://')) return v.length > 'ipfs://'.length
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const mintNFTSchema = z.object({
  // PersonSupplementInfo
  birthPlace: z.string().max(256, 'Birth place too long'),
  isDeathBC: z.boolean(),
  deathYear: z.number().min(0).max(9999),
  deathMonth: z.number().min(0).max(12),
  deathDay: z.number().min(0).max(31),
  deathPlace: z.string().max(256, 'Death place too long'),
  story: z.string().max(256, 'Story too long'),
  
  // NFT Metadata
  tokenURI: z
    .string()
    .max(256, 'Token URI too long')
    .optional()
    .or(z.literal(''))
    .refine((v) => isValidTokenUri(v ?? ''), 'Invalid URL or IPFS URI')
})

type MintNFTForm = z.infer<typeof mintNFTSchema>

interface MintNFTModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (tokenId: number) => void
  personHash?: string
  versionIndex?: number
  onPersonHashChange?: (hash: string) => void
  onVersionIndexChange?: (index: number) => void
  versionData?: {
    fullName?: string
    gender?: number
    birthYear?: number
    birthMonth?: number
    birthDay?: number
    isBirthBC?: boolean
  }
}

export default function MintNFTModal({
  isOpen,
  onClose,
  onSuccess,
  personHash,
  versionIndex,
  onPersonHashChange,
  onVersionIndexChange,
  versionData
}: MintNFTModalProps) {
  const { t } = useTranslation()
  const { address } = useWallet()
  const { mintPersonNFT, getVersionDetails, contract, getFullNameHash, getPersonHash } = useContract()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEndorsed, setIsEndorsed] = useState(false)
  const [isAlreadyMinted, setIsAlreadyMinted] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  const [showEndorseModal, setShowEndorseModal] = useState(false)
  const [targetPersonHash, setTargetPersonHash] = useState<string | undefined>(undefined)
  const [targetVersionIndex, setTargetVersionIndex] = useState<number | undefined>(undefined)
  const [showEndorseConfirm, setShowEndorseConfirm] = useState(false)
  
  // Person basic info from PersonHashCalculator
  const [personInfo, setPersonInfo] = useState<{
    fullName: string
    gender: number
    birthYear: number
    birthMonth: number
    birthDay: number
    isBirthBC: boolean
  } | null>(null)
  
  // Determine if we're in "view mode" (valid personHash provided) or "input mode" (no valid personHash)
  const isViewMode = Boolean(personHash && personHash.trim() !== '' && versionIndex !== undefined && versionIndex > 0)
  const canEdit = !isViewMode

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

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue
  } = useForm<MintNFTForm>({
    resolver: zodResolver(mintNFTSchema),
    defaultValues: {
      // PersonSupplementInfo
      birthPlace: '',
      isDeathBC: false,
      deathYear: 0,
      deathMonth: 0,
      deathDay: 0,
      deathPlace: '',
      story: '',
      tokenURI: ''
    }
  })

  // Initialize person info from version data
  useEffect(() => {
    if (versionData && isOpen) {
      setPersonInfo({
        fullName: versionData.fullName || '',
        gender: versionData.gender || 0,
        birthYear: versionData.birthYear || 0,
        birthMonth: versionData.birthMonth || 0,
        birthDay: versionData.birthDay || 0,
        isBirthBC: versionData.isBirthBC || false
      })
    }
  }, [versionData, isOpen])

  // Check endorsement and NFT minting status
  useEffect(() => {
    const checkStatus = async () => {
      if (!address || !getVersionDetails || !isViewMode || !contract) return
      
      setIsCheckingStatus(true)
      
      try {
        const details = await getVersionDetails(personHash!, versionIndex!)

        // Endorsement: check user's endorsed version index for this person
        const endorsedIdx = await contract.endorsedVersionIndex(personHash!, address)
        setIsEndorsed(Number(endorsedIdx) === Number(versionIndex))

        // Minted: tokenId > 0 in getVersionDetails
        const tokenId = Number(details?.tokenId ?? 0)
        setIsAlreadyMinted(tokenId > 0)
        
      } catch (error) {
        console.error('Failed to check status:', error)
        setIsEndorsed(false)
        setIsAlreadyMinted(false)
      } finally {
        setIsCheckingStatus(false)
      }
    }

    if (isOpen && isViewMode) {
      checkStatus()
    }
  }, [isOpen, address, personHash, versionIndex, getVersionDetails, contract, isViewMode])

  const handleClose = () => {
    reset()
    setIsSubmitting(false)
    setPersonInfo(null)
    setIsEndorsed(false)
    setIsAlreadyMinted(false)
    setIsCheckingStatus(false)
    setEntered(false)
    setDragging(false)
    setDragOffset(0)
    onClose()
  }

  const onSubmit = async (data: MintNFTForm) => {
    if (!address) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    if (!personInfo) {
      alert(t('mintNFT.personInfoRequired', 'Please fill in person information'))
      return
    }

    // In view mode, check if user has endorsed and NFT hasn't been minted
    if (isViewMode) {
      if (!isEndorsed) {
        // Friendly confirm to jump to endorsement
        setTargetPersonHash(personHash!)
        setTargetVersionIndex(versionIndex!)
        setShowEndorseConfirm(true)
        return
      }
      if (isAlreadyMinted) {
        alert(t('mintNFT.alreadyMinted', 'NFT has already been minted for this version'))
        return
      }
    }

    setIsSubmitting(true)

    try {
      // Construct PersonCoreInfo object matching the contract structure
      // PersonBasicInfo
      const fullNameHash = getFullNameHash
        ? await getFullNameHash(personInfo.fullName)
        : ethers.keccak256(ethers.toUtf8Bytes(personInfo.fullName))

      const coreInfo = {
        basicInfo: {
          fullNameHash,
          isBirthBC: personInfo.isBirthBC,
          birthYear: personInfo.birthYear,
          birthMonth: personInfo.birthMonth,
          birthDay: personInfo.birthDay,
          gender: personInfo.gender
        },
        supplementInfo: {
          fullName: personInfo.fullName,
          birthPlace: data.birthPlace,
          isDeathBC: data.isDeathBC,
          deathYear: data.deathYear,
          deathMonth: data.deathMonth,
          deathDay: data.deathDay,
          deathPlace: data.deathPlace,
          story: data.story
        }
      }

      // Determine personHash/versionIndex
      let finalPersonHash = personHash as string | undefined
      if (!finalPersonHash && getPersonHash) {
        // Compute on-chain consistent person hash
        finalPersonHash = await getPersonHash(coreInfo.basicInfo as any)
      }
      if (!finalPersonHash) {
        alert(t('mintNFT.personHashRequired', 'Unable to compute person hash'))
        return
      }
      const finalVersionIndex = versionIndex || 1 // Default to version 1 if not provided

      // Preflight: ensure endorsement matches target version
      try {
        if (contract) {
          const endorsedIdx = await contract.endorsedVersionIndex(finalPersonHash, address)
          if (Number(endorsedIdx) !== Number(finalVersionIndex)) {
            setTargetPersonHash(finalPersonHash)
            setTargetVersionIndex(finalVersionIndex)
            setShowEndorseConfirm(true)
            setIsSubmitting(false)
            return
          }
        }
      } catch {}

      const receipt = await mintPersonNFT(
        finalPersonHash,
        finalVersionIndex,
        data.tokenURI || '',
        coreInfo as any
      )

      if (receipt) {
        // Prefer querying tokenId from contract after mint
        let tokenId = 0
        try {
          const details = await getVersionDetails?.(finalPersonHash, finalVersionIndex)
          tokenId = Number(details?.tokenId ?? 0)
        } catch {}
        if (tokenId > 0) onSuccess?.(tokenId)
        handleClose()
      }
    } catch (error: any) {
      console.error('Mint NFT failed:', error)
      alert(error.message || t('mintNFT.mintFailed', 'Failed to mint NFT'))
    } finally {
      setIsSubmitting(false)
    }
  }

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
          className="sticky top-0 bg-gradient-to-br from-purple-500/10 via-blue-500/8 to-indigo-500/10 dark:from-purple-600/20 dark:via-blue-600/15 dark:to-indigo-600/20 p-4 pt-7 sm:pt-6 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60 relative touch-none cursor-grab active:cursor-grabbing select-none"
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
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                <Image className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {t('mintNFT.title', 'Mint NFT')}
                </h2>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  <span className="whitespace-nowrap">{t('mintNFT.description', 'Create a unique NFT for this person')}</span>
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
          <form id="mint-nft-form" onSubmit={handleSubmit(onSubmit)} className="min-h-full flex flex-col">
            <div className="flex-1 p-4 sm:p-6 space-y-6">
          
          {/* Person Information Display (when personHash is provided) */}
          {isViewMode && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('mintNFT.personInfo', 'Person Information')}
              </h3>
              
              <div className="p-4 bg-blue-50/50 dark:bg-blue-900/20 rounded-xl border border-blue-200/50 dark:border-blue-700/50">
                <div className="space-y-3">
                  <div>
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {t('mintNFT.personHash', 'Person Hash')}:
                    </span>
                    <div className="mt-1 font-mono text-xs bg-blue-100 dark:bg-blue-800/50 px-2 py-1 rounded break-all">
                      {personHash || ''}
                    </div>
                  </div>
                  
                  <div>
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {t('mintNFT.versionIndex', 'Version Index')}:
                    </span>
                    <span className="ml-2 font-mono text-sm bg-blue-100 dark:bg-blue-800/50 px-2 py-1 rounded">
                      {versionIndex}
                    </span>
                  </div>
                  
                  {/* Status indicators */}
                  <div className="flex items-center gap-4 pt-2 border-t border-blue-200/50 dark:border-blue-700/50">
                    {isCheckingStatus ? (
                      <div className="text-sm text-blue-600 dark:text-blue-400">
                        {t('mintNFT.checkingStatus', 'Checking status...')}
                      </div>
                    ) : (
                      <>
                        <div className={`flex items-center gap-2 text-sm ${isEndorsed ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${isEndorsed ? 'bg-green-500' : 'bg-orange-500'}`} />
                          {isEndorsed ? 
                            t('mintNFT.endorsed', 'Endorsed') : 
                            t('mintNFT.notEndorsed', 'Not Endorsed')
                          }
                        </div>
                        
                        <div className={`flex items-center gap-2 text-sm ${isAlreadyMinted ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          <div className={`w-2 h-2 rounded-full ${isAlreadyMinted ? 'bg-red-500' : 'bg-green-500'}`} />
                          {isAlreadyMinted ? 
                            t('mintNFT.alreadyMinted', 'Already Minted') : 
                            t('mintNFT.canMint', 'Can Mint')
                          }
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Show form content only if NFT hasn't been minted */}
          {!isAlreadyMinted && (
            <>
              {/* Person Hash and Version Input (when not in view mode) */}
              {!isViewMode && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {t('mintNFT.targetVersion', 'Target Version')}
                  </h3>
                  
                  <div className="p-4 bg-amber-50/50 dark:bg-amber-900/20 rounded-xl border border-amber-200/50 dark:border-amber-700/50">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <h4 className="text-sm font-medium text-amber-900 dark:text-amber-100">
                          {t('mintNFT.specifyVersion', 'Specify Version to Mint')}
                        </h4>
                        <p className="text-sm text-amber-700 dark:text-amber-200 mt-1">
                          {t('mintNFT.specifyVersionDesc', 'Enter the person hash and version index of the version you want to mint as NFT.')}
                        </p>
                      </div>
                    </div>
                    
                    <div className="space-y-4 sm:space-y-0 sm:flex sm:items-start sm:gap-4">
                      <div className="sm:flex-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t('mintNFT.personHash', 'Person Hash')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={personHash || ''}
                          onChange={(e) => onPersonHashChange?.(e.target.value)}
                          className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition font-mono"
                          placeholder={t('search.versionsQuery.placeholder')}
                        />
                      </div>
                      
                      <div className="w-32">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t('mintNFT.versionIndex', 'Version Index')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={versionIndex || 1}
                          onChange={(e) => onVersionIndexChange?.(parseInt(e.target.value) || 1)}
                          className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                          placeholder="1"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Basic Information - Using PersonHashCalculator */}
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t('mintNFT.basicInfo', 'Basic Information')}
                </h3>
                
                <PersonHashCalculator
                  showTitle={false}
                  collapsible={false}
                  className="border-0 shadow-none"
                  initialValues={personInfo ? {
                    fullName: personInfo.fullName,
                    gender: personInfo.gender,
                    birthYear: personInfo.birthYear,
                    birthMonth: personInfo.birthMonth,
                    birthDay: personInfo.birthDay,
                    isBirthBC: personInfo.isBirthBC
                  } : versionData}
                  onFormChange={canEdit ? (formData) => {
                    setPersonInfo({
                      fullName: formData.fullName,
                      gender: formData.gender,
                      birthYear: formData.birthYear,
                      birthMonth: formData.birthMonth,
                      birthDay: formData.birthDay,
                      isBirthBC: formData.isBirthBC
                    })
                  } : undefined}
                />
              </div>

          {/* Supplemental Information (from PersonSupplementInfo) */}
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('mintNFT.supplementalInfo', 'Supplemental Information')}
            </h3>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('mintNFT.birthPlace', 'Birth Place')}
                  </label>
                  <input
                    {...register('birthPlace')}
                    className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                    placeholder={t('mintNFT.birthPlacePlaceholder', 'Enter birth place')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('mintNFT.deathPlace', 'Death Place')}
                  </label>
                  <input
                    {...register('deathPlace')}
                    className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                    placeholder={t('mintNFT.deathPlacePlaceholder', 'Enter death place (if applicable)')}
                  />
                </div>

              </div>

              {/* Death Date Information - Using PersonHashCalculator style */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('mintNFT.deathDate', 'Death Date (if applicable)')}
                </h4>
                
                <div className="flex flex-nowrap items-start gap-1">
                  <div className="flex items-start gap-1">
                    <div className="w-16 min-w-16">
                      <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                        {t('search.hashCalculator.isBirthBC')}
                      </label>
                      <div className="h-10 flex items-center">
                        <label className="inline-flex items-center text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none group">
                          <input type="checkbox" className="sr-only" {...register('isDeathBC')} />
                          <span className="relative w-11 h-6 rounded-full bg-gray-300 dark:bg-gray-700 group-has-[:checked]:bg-purple-600 transition-colors duration-200 flex-shrink-0">
                            <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 group-has-[:checked]:translate-x-5" />
                          </span>
                        </label>
                      </div>
                    </div>
                    
                    <div className="w-25">
                      <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                        {t('search.hashCalculator.birthYearLabel')}
                      </label>
                      <input 
                        type="number" 
                        placeholder="0" 
                        className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
                        {...register('deathYear', { setValueAs: (v) => v === '' ? 0 : parseInt(v, 10) })} 
                      />
                    </div>
                  </div>
                  
                  <div className="w-24">
                    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                      {t('search.hashCalculator.birthMonthLabel')}
                    </label>
                    <input 
                      type="number" 
                      min="0" 
                      max="12" 
                      placeholder="0" 
                      className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
                      {...register('deathMonth', { setValueAs: (v) => v === '' ? 0 : parseInt(v, 10) })} 
                    />
                  </div>
                  
                  <div className="w-24">
                    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                      {t('search.hashCalculator.birthDayLabel')}
                    </label>
                    <input 
                      type="number" 
                      min="0" 
                      max="31" 
                      placeholder="0" 
                      className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
                      {...register('deathDay', { setValueAs: (v) => v === '' ? 0 : parseInt(v, 10) })} 
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.story', 'Life Story Summary')}
                </label>
                <textarea
                  {...register('story')}
                  rows={4}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition resize-none"
                  placeholder={t('mintNFT.storyPlaceholder', 'Enter a brief life story summary...')}
                />
                {errors.story && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.story.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* NFT Metadata */}
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('mintNFT.metadata', 'NFT Metadata')}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('mintNFT.tokenURI', 'Token URI')}
              </label>
              <input
                {...register('tokenURI')}
                className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                placeholder="https://... or ipfs://..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('mintNFT.tokenURIHint', 'Optional: URL or IPFS hash for NFT metadata')}
              </p>
              {errors.tokenURI && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.tokenURI.message}</p>
              )}
            </div>
          </div>
            </>
          )}
          
          {/* Message when NFT is already minted */}
          {isAlreadyMinted && (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t('mintNFT.nftAlreadyMinted', 'NFT Already Minted')}
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                {t('mintNFT.nftAlreadyMintedDesc', 'This version has already been minted as an NFT. Each version can only be minted once.')}
              </p>
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
              
              {/* Only show mint button if NFT hasn't been minted */}
              {!isAlreadyMinted && (
                <>
                  {isViewMode && !isEndorsed ? (
                    <button
                      type="button"
                      onClick={() => setShowEndorseModal(true)}
                      disabled={isCheckingStatus}
                      className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {t('mintNFT.goEndorse', 'Go Endorse')}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSubmitting || isCheckingStatus}
                      className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {isSubmitting ? 
                        t('mintNFT.minting', 'Minting...') :
                        t('mintNFT.mint', 'Mint NFT')
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          </form>
        </div>
        </div>
        {/* Quick Endorse Modal */}
        {(isViewMode || (!!targetPersonHash && !!targetVersionIndex)) && (
          <EndorseModal
            isOpen={showEndorseModal}
            onClose={() => setShowEndorseModal(false)}
            onSuccess={() => {
              setIsEndorsed(true)
              setShowEndorseModal(false)
            }}
            personHash={targetPersonHash || personHash}
            versionIndex={targetVersionIndex || versionIndex}
            versionData={versionData}
          />
        )}

        {/* Confirm to jump to endorse */}
        {showEndorseConfirm && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowEndorseConfirm(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t('mintNFT.endorsementRequiredTitle', 'Endorsement Required')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                {t('mintNFT.endorsementRequiredDesc', 'You must endorse this version before minting. Would you like to go endorse now?')}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEndorseConfirm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowEndorseConfirm(false); setShowEndorseModal(true) }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  {t('mintNFT.goEndorse', 'Go Endorse')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
