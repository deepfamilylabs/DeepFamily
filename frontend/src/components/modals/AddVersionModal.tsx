import React, { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X, Users, ChevronDown, ChevronRight, UserPlus, Check, AlertTriangle, Shield, Download, Star, Eye, EyeOff } from 'lucide-react'
import { ethers } from 'ethers'
import { useWallet } from '../../context/WalletContext'
import { generatePersonProof, verifyProof } from '../../lib/zk'
import { useContract } from '../../hooks/useContract'
import { generateMetadataCID } from '../../lib/cid'
import { encryptMetadataJson, passwordFingerprint, sha256Hex } from '../../lib/metadataCrypto'
import PersonHashCalculator, { computePersonHash } from '../PersonHashCalculator'
import type { PersonHashCalculatorHandle } from '../PersonHashCalculator'
import { getFriendlyError, sanitizeErrorForLogging } from '../../lib/errors'
import { normalizeNameForHash } from '../../lib/passphraseStrength'

const addVersionSchema = z.object({
  // Parent version indexes: allow empty string input, transform to 0 for processing
  fatherVersionIndex: z.union([z.number().int().min(0), z.literal('')]).transform(val => val === '' ? 0 : val),
  motherVersionIndex: z.union([z.number().int().min(0), z.literal('')]).transform(val => val === '' ? 0 : val),
  tag: z.string().max(50, 'Tag too long'),
  metadataCID: z.string().optional()
})

// Input type (before transformation)
type AddVersionFormInput = {
  fatherVersionIndex: number | ''
  motherVersionIndex: number | ''
  tag: string
  metadataCID?: string
}

type AddVersionFormData = z.infer<typeof addVersionSchema>

type EncryptedMetadataBundle = {
  json: string
  cid: string
  plainHash: string
  passwordFingerprint: string
}

type PersonInfoPublic = {
  fullName: string
  gender: number
  birthYear: number
  birthMonth: number
  birthDay: number
  isBirthBC: boolean
}

interface AddVersionModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  onEndorse?: (personHash: string, versionIndex: number) => void
  // Optional: Pre-populated person data (for passing known data when navigating from other pages)
  initialPersonData?: {
    fullName?: string
    gender?: number
    birthYear?: number
    birthMonth?: number
    birthDay?: number
    isBirthBC?: boolean
    passphrase?: string
  }
}

export default function AddVersionModal({
  isOpen,
  onClose,
  onSuccess,
  onEndorse,
  initialPersonData
}: AddVersionModalProps) {
  const { t } = useTranslation()
  const { signer } = useWallet()
  const { addPersonZK, isContractReady } = useContract()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [consents, setConsents] = useState({ hash: false, age: false, legal: false })
  const [consentError, setConsentError] = useState<string | null>(null)
  const [proofGenerationStep, setProofGenerationStep] = useState<string>('')
  const [encryptionError, setEncryptionError] = useState<string | null>(null)
  const [usePersonPassphraseForEncryption, setUsePersonPassphraseForEncryption] = useState(true)
  const [encryptedMetadata, setEncryptedMetadata] = useState<EncryptedMetadataBundle | null>(null)
  const [showEncryptionPassword, setShowEncryptionPassword] = useState(false)
  const [showConfirmEncryptionPassword, setShowConfirmEncryptionPassword] = useState(false)
  const [successResult, setSuccessResult] = useState<{
    hash: string
    index: number
    rewardAmount: number
    transactionHash: string
    blockNumber: number
    events: {
      PersonHashZKVerified: any
      PersonVersionAdded: any
      TokenRewardDistributed: any
    }
  } | null>(null)
  const [errorResult, setErrorResult] = useState<{
    type: string
    message: string
    details: string
  } | null>(null)
  
  // Person hash and info from PersonHashCalculator
  const [personInfo, setPersonInfo] = useState<PersonInfoPublic | null>(null)
  const [personHasPassphrase, setPersonHasPassphrase] = useState(false)
  const personCalcRef = useRef<PersonHashCalculatorHandle | null>(null)

  // Father and mother info from PersonHashCalculator components
  const [fatherInfo, setFatherInfo] = useState<PersonInfoPublic | null>(null)
  const fatherCalcRef = useRef<PersonHashCalculatorHandle | null>(null)

  const [motherInfo, setMotherInfo] = useState<PersonInfoPublic | null>(null)
  const motherCalcRef = useRef<PersonHashCalculatorHandle | null>(null)
  const encryptionPasswordRef = useRef<HTMLInputElement | null>(null)
  const confirmEncryptionPasswordRef = useRef<HTMLInputElement | null>(null)
  
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)

  // Parent info collapse states
  const [fatherExpanded, setFatherExpanded] = useState(false)
  const [motherExpanded, setMotherExpanded] = useState(false)

  // Key for forcing PersonHashCalculator remount on reset
  const [formResetKey, setFormResetKey] = useState(0)
  // Track history push/pop to close on mobile back like NodeDetailModal
  const pushedRef = useRef(false)
  const closedBySelfRef = useRef(false)
  const closedByPopRef = useRef(false)
  const historyMarkerRef = useRef<{ __dfModal: string; id: string } | null>(null)

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
    setValue,
    watch,
    reset
  } = useForm<AddVersionFormInput>({
    resolver: zodResolver(addVersionSchema),
    defaultValues: {
      // Parent version indexes (empty string to show placeholder, will be converted to 0 if empty)
      fatherVersionIndex: '',
      motherVersionIndex: '',
      
      tag: '',
      metadataCID: ''
    }
  })

  // Watch form values for version indexes
  const watchedValues = watch()
  
  // Helper function to check if parent info has content
  const getParentInfoStatus = (parentType: 'father' | 'mother') => {
    const info = parentType === 'father' ? fatherInfo : motherInfo
    const versionIndex = parentType === 'father' ? watchedValues.fatherVersionIndex : watchedValues.motherVersionIndex

    const normalizedName = normalizeNameForHash(info?.fullName || '')
    if (!info || !normalizedName) return 'empty'
    if (normalizedName && typeof versionIndex === 'number' && versionIndex > 0) return 'complete'
    return 'partial'
  }
  
  const fatherStatus = getParentInfoStatus('father')
  const motherStatus = getParentInfoStatus('mother')
  const allConsentsChecked = consents.hash && consents.age && consents.legal
  const showManualEncryptionInputs = !usePersonPassphraseForEncryption || !personHasPassphrase

  // Initialize states if existing data is provided (e.g., from another page)
  useEffect(() => {
    if (initialPersonData) {
      setPersonInfo({
        fullName: initialPersonData.fullName || '',
        gender: initialPersonData.gender || 0,
        birthYear: initialPersonData.birthYear || 0,
        birthMonth: initialPersonData.birthMonth || 0,
        birthDay: initialPersonData.birthDay || 0,
        isBirthBC: initialPersonData.isBirthBC || false
      })
      setPersonHasPassphrase(!!(initialPersonData.passphrase && initialPersonData.passphrase.length > 0))
    }
  }, [initialPersonData])

  const computeHashOrZero = (calc: PersonHashCalculatorHandle | null) => {
    const data = calc?.getFormData()
    const normalizedName = normalizeNameForHash(data?.fullName || '')
    if (!data || !normalizedName) return ethers.ZeroHash
    const hash = computePersonHash(data)
    return hash && hash.length > 0 ? hash : ethers.ZeroHash
  }

  /**
   * Extract and normalize person info, ensuring deterministic field order
   * Note: Passphrase is removed to avoid leaking sensitive data to metadata
   */
  const sanitizeInfo = (info: PersonInfoPublic | null) => {
    if (!info) return null
    // Explicitly specify field order to ensure CID determinism
    return {
      fullName: info.fullName,
      gender: info.gender,
      birthYear: info.birthYear,
      birthMonth: info.birthMonth,
      birthDay: info.birthDay,
      isBirthBC: info.isBirthBC
    }
  }

  /**
   * Build metadata payload, strictly following schema-defined field order
   * Field order must be consistent to ensure same data generates same CID
   */
  const buildMetadataPayload = (tagValue: string, processedData: AddVersionFormData) => {
    const baseEmpty = {
      fullName: '',
      gender: 0,
      birthYear: 0,
      birthMonth: 0,
      birthDay: 0,
      isBirthBC: false
    }

    const personHashValue = computeHashOrZero(personCalcRef.current)
    const fatherHashValue = computeHashOrZero(fatherCalcRef.current)
    const motherHashValue = computeHashOrZero(motherCalcRef.current)

    const personData = sanitizeInfo(personInfo) ?? baseEmpty
    const fatherData = sanitizeInfo(fatherInfo) ?? baseEmpty
    const motherData = sanitizeInfo(motherInfo) ?? baseEmpty

    // Strictly build according to deepfamily/person-version@1.0 schema field order
    return {
      schema: 'deepfamily/person-version@1.0',
      tag: tagValue || '',
      person: {
        fullName: personData.fullName,
        gender: personData.gender,
        birthYear: personData.birthYear,
        birthMonth: personData.birthMonth,
        birthDay: personData.birthDay,
        isBirthBC: personData.isBirthBC,
        personHash: personHashValue
      },
      parents: {
        father: {
          fullName: fatherData.fullName,
          gender: fatherData.gender,
          birthYear: fatherData.birthYear,
          birthMonth: fatherData.birthMonth,
          birthDay: fatherData.birthDay,
          isBirthBC: fatherData.isBirthBC,
          personHash: fatherHashValue,
          versionIndex: processedData.fatherVersionIndex ?? 0
        },
        mother: {
          fullName: motherData.fullName,
          gender: motherData.gender,
          birthYear: motherData.birthYear,
          birthMonth: motherData.birthMonth,
          birthDay: motherData.birthDay,
          isBirthBC: motherData.isBirthBC,
          personHash: motherHashValue,
          versionIndex: processedData.motherVersionIndex ?? 0
        }
      }
    }
  }

  const handleClose = () => {
    closedBySelfRef.current = true
    reset()
    setPersonInfo(null)
    setPersonHasPassphrase(false)
    setFatherInfo(null)
    setMotherInfo(null)
    setIsSubmitting(false)
    setProofGenerationStep('')
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = ''
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = ''
    setEncryptionError(null)
    setEncryptedMetadata(null)
    setSuccessResult(null)
    setErrorResult(null)
    setFatherExpanded(false)
    setMotherExpanded(false)
    setConsents({ hash: false, age: false, legal: false })
    setConsentError(null)
    setDragging(false)
    setDragOffset(0)
    onClose()
  }

  // Ensure state resets when modal is closed externally
  useEffect(() => {
    if (isOpen) return
    reset()
    setPersonInfo(null)
    setPersonHasPassphrase(false)
    setFatherInfo(null)
    setMotherInfo(null)
    setIsSubmitting(false)
    setProofGenerationStep('')
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = ''
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = ''
    setEncryptionError(null)
    setEncryptedMetadata(null)
    setSuccessResult(null)
    setErrorResult(null)
    setFatherExpanded(false)
    setMotherExpanded(false)
    setConsents({ hash: false, age: false, legal: false })
    setConsentError(null)
    setDragging(false)
    setDragOffset(0)
  }, [isOpen, reset])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Push history state on open so mobile back closes the modal first
  useEffect(() => {
    if (!isOpen) return
    const marker = { __dfModal: 'AddVersionModal', id: Math.random().toString(36).slice(2) }
    historyMarkerRef.current = marker
    try {
      window.history.pushState(marker, '')
      pushedRef.current = true
    } catch {}
    const onPop = () => {
      const st: any = window.history.state
      if (!st || st.id !== historyMarkerRef.current?.id) {
        closedByPopRef.current = true
        onClose()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (pushedRef.current && closedBySelfRef.current && !closedByPopRef.current) {
        try { window.history.back() } catch {}
      }
      pushedRef.current = false
      closedBySelfRef.current = false
      closedByPopRef.current = false
      historyMarkerRef.current = null
    }
  }, [isOpen, onClose])

  const handleContinueAdding = () => {
    // Reset form and states for new addition
    reset()
    setPersonInfo(null)
    setPersonHasPassphrase(false)
    setFatherInfo(null)
    setMotherInfo(null)
    setIsSubmitting(false)
    setProofGenerationStep('')
    if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = ''
    if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = ''
    setEncryptionError(null)
    setEncryptedMetadata(null)
    setSuccessResult(null)
    setErrorResult(null)
    setFatherExpanded(false)
    setMotherExpanded(false)
    setConsents({ hash: false, age: false, legal: false })
    setConsentError(null)
    // Increment key to force remount of PersonHashCalculator components
    setFormResetKey(prev => prev + 1)
    // Keep modal open for continued use
  }
  const toggleConsent = (key: keyof typeof consents) => {
    setConsents(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (consentError && next.hash && next.age && next.legal) setConsentError(null)
      return next
    })
  }

  const validateEncryptionPassword = () => {
    const canUseIdentityPassphrase = usePersonPassphraseForEncryption && (personCalcRef.current?.hasPassphrase() ?? false)
    if (canUseIdentityPassphrase) {
      setEncryptionError(null)
      return true
    }
    const encryptionPassword = (encryptionPasswordRef.current?.value ?? '').trim()
    const confirmEncryptionPassword = confirmEncryptionPasswordRef.current?.value ?? ''
    if (!encryptionPassword) {
      setEncryptionError(t('addVersion.encryptionPasswordRequired', 'Please enter encryption password'))
      return false
    }
    if (encryptionPassword.length < 8) {
      setEncryptionError(t('addVersion.encryptionPasswordWeak', 'Password must be at least 8 characters'))
      return false
    }
    if (encryptionPassword !== confirmEncryptionPassword) {
      setEncryptionError(t('addVersion.encryptionPasswordMismatch', 'Passwords do not match'))
      return false
    }
    setEncryptionError(null)
    return true
  }

  const resolveEncryptionPassword = () => {
    const canUseIdentityPassphrase = usePersonPassphraseForEncryption && (personCalcRef.current?.hasPassphrase() ?? false)
    if (canUseIdentityPassphrase) {
      return personCalcRef.current?.getFormData().passphrase || ''
    }
    return (encryptionPasswordRef.current?.value ?? '').trim()
  }

  const prepareEncryptedMetadata = async (tagValue: string, processedData: AddVersionFormData, password: string) => {
    const metadataPayload = buildMetadataPayload(tagValue, processedData)
    const metadataJson = JSON.stringify(metadataPayload)
    const bundlePlainHash = sha256Hex(metadataJson)

    if (encryptedMetadata && encryptedMetadata.plainHash === bundlePlainHash && encryptedMetadata.passwordFingerprint === passwordFingerprint(password)) {
      return encryptedMetadata
    }

    const { payload, plainHash } = await encryptMetadataJson(metadataJson, password)
    const encryptedJson = JSON.stringify(payload)
    const cid = await generateMetadataCID(encryptedJson)
    const bundle = {
      json: encryptedJson,
      cid,
      plainHash,
      passwordFingerprint: passwordFingerprint(password)
    }
    setEncryptedMetadata(bundle)
    return bundle
  }

  const handleDownloadMetadata = async () => {
    try {
      if (!validateEncryptionPassword()) return
      const processedData = addVersionSchema.parse(watchedValues)
      const { json, cid } = await prepareEncryptedMetadata(processedData.tag, processedData, resolveEncryptionPassword())
      setValue('metadataCID', cid, { shouldDirty: true, shouldValidate: true })

      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `metadata-encrypted-${cid || Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('Download metadata failed', sanitizeErrorForLogging(err))
      alert(t('addVersion.encryptionFailed', 'Failed to encrypt or export metadata, please try again'))
    }
  }


  const onSubmit = async (data: AddVersionFormInput) => {
    if (!allConsentsChecked) {
      setConsentError(t('addVersion.consentMissing', 'Please confirm all required checkboxes before submitting'))
      return
    } else {
      setConsentError(null)
    }

    if (!signer || !isContractReady) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    // Transform the input data to the final form
    const processedData = addVersionSchema.parse(data)

    const personPrivate = personCalcRef.current?.getFormData()
    if (!personPrivate || !normalizeNameForHash(personPrivate.fullName || '')) {
      alert(t('addVersion.personInfoRequired', 'Please fill in person information'))
      return
    }
    if (!validateEncryptionPassword()) {
      return
    }
    // Clear old prompt information
    setSuccessResult(null)
    setErrorResult(null)
    
    setIsSubmitting(true)
    setProofGenerationStep(t('addVersion.preparingData', 'Preparing data...'))

    try {
      // Get submitter address
      const submitterAddress = await signer.getAddress()
      
      setProofGenerationStep(t('addVersion.generatingProof', 'Generating zero-knowledge proof... (this may take 30-60 seconds)'))
      
      // Generate ZK proof automatically
      const { proof, publicSignals } = await generatePersonProof(
        personPrivate,
        fatherInfo && normalizeNameForHash(fatherInfo.fullName || '').length ? (fatherCalcRef.current?.getFormData() || null) : null,
        motherInfo && normalizeNameForHash(motherInfo.fullName || '').length ? (motherCalcRef.current?.getFormData() || null) : null,
        submitterAddress
      )
      
      setProofGenerationStep(t('addVersion.verifyingProof', 'Verifying proof...'))
      
      // Verify the generated proof
      const isValid = await verifyProof(proof, publicSignals)
      if (!isValid) {
        throw new Error(t('addVersion.proofVerificationFailed', 'Generated proof verification failed'))
      }

      setProofGenerationStep(t('addVersion.generatingMetadataCID', 'Generating metadata CID...'))

      const { json: encryptedJson, cid: metadataCID } = await prepareEncryptedMetadata(processedData.tag, processedData, resolveEncryptionPassword())

      processedData.metadataCID = metadataCID
      setValue('metadataCID', metadataCID, { shouldDirty: true, shouldValidate: true })
      
      setProofGenerationStep(t('addVersion.submittingToBlockchain', 'Submitting to blockchain...'))
      
      // Use the unified contract hook for blockchain interaction
      const result = await addPersonZK(
        proof,
        publicSignals,
        processedData.fatherVersionIndex,
        processedData.motherVersionIndex,
        processedData.tag,
        processedData.metadataCID || ''
      )

      if (result) {
        setSuccessResult({
          hash: result.hash,
          index: result.index,
          rewardAmount: result.rewardAmount,
          transactionHash: result.transactionHash,
          blockNumber: result.blockNumber,
          events: result.events
        })
        setProofGenerationStep('')
        onSuccess?.(result)
      }
    } catch (error: any) {
      console.error('❌ Add version failed:', sanitizeErrorForLogging(error))
      
      // Set error result for display in UI
      const friendly = getFriendlyError(error, t)
      setErrorResult({
        type: friendly.type || 'UNKNOWN_ERROR',
        message: friendly.message,
        details: friendly.details
      })
      setProofGenerationStep('')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Helper component for status indicator
  const StatusIndicator = ({ status }: { status: 'empty' | 'partial' | 'complete' }) => {
    const config = {
      empty: { icon: UserPlus, color: 'text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700' },
      partial: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30' },
      complete: { icon: Check, color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30' }
    }

    const { icon: Icon, color, bg } = config[status]

    return (
      <div className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
    )
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
    colorClass: 'blue' | 'green' | 'yellow'
    isPlainText?: boolean
  }) => {
    const colorConfig = {
      blue: {
        labelColor: 'text-blue-800 dark:text-blue-200',
        valueBg: 'bg-blue-100 dark:bg-blue-800',
        valueColor: 'text-blue-900 dark:text-blue-100'
      },
      green: {
        labelColor: 'text-green-800 dark:text-green-200',
        valueBg: 'bg-green-100 dark:bg-green-800',
        valueColor: 'text-green-900 dark:text-green-100'
      },
      yellow: {
        labelColor: 'text-yellow-800 dark:text-yellow-200',
        valueBg: 'bg-yellow-100 dark:bg-yellow-800',
        valueColor: 'text-yellow-900 dark:text-yellow-100'
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
          className="sticky top-0 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-indigo-500/10 dark:from-blue-600/20 dark:via-purple-600/15 dark:to-indigo-600/20 p-3 pt-7 sm:pt-6 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60 relative touch-none cursor-grab active:cursor-grabbing select-none"
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
            <div className="flex-1 flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                <UserPlus className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {t('addVersion.title', 'Add Version')}
                </h2>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  <span className="whitespace-normal">{t('addVersion.personInfoHint', 'Plain text won\'t go on-chain, used only for ZK proof')}</span>
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
          <form id="add-version-form" onSubmit={handleSubmit(onSubmit)} className="min-h-full flex flex-col">
            <div className="flex-1 p-4 sm:p-6 space-y-6">

            <div className="space-y-2">
              <div className="flex gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-300/40 dark:bg-amber-900/20 dark:text-amber-50">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-xs leading-relaxed">
                  {t('mintNFT.legalTruthfulNotice', 'Submit only lawful, truthful information you are authorized to disclose publicly; do not include private data outside the intended public scope.')}
                </p>
              </div>
              <div className="flex gap-2 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-red-900 dark:border-red-300/40 dark:bg-red-900/20 dark:text-red-50">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-xs leading-relaxed">
                  {t('addVersion.ageRequirement', 'The person being added must be 18 years or older. Do not submit minors\' identities.')}
                </p>
              </div>
            </div>

          {/* Person Being Added - Using PersonHashCalculator */}
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('addVersion.personInfo', 'Person Information')}
            </h3>

            {/* Privacy Notice */}
            <div className="p-3 bg-green-50/50 dark:bg-green-900/20 rounded-lg border border-green-200/50 dark:border-green-700/50">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
                  {t('addVersion.personInfoPrivacy', 'Person information is only used locally to generate zero-knowledge proofs. Plain text will not be stored on-chain, only the hash value is permanently recorded.')}
                </p>
              </div>
            </div>

            <PersonHashCalculator
              ref={personCalcRef}
              key={`person-${formResetKey}`}
              showTitle={false}
              collapsible={false}
              initialValues={initialPersonData}
              onPublicFormChange={(formData) => {
                setPersonInfo({
                  fullName: formData.fullName,
                  gender: formData.gender,
                  birthYear: formData.birthYear,
                  birthMonth: formData.birthMonth,
                  birthDay: formData.birthDay,
                  isBirthBC: formData.isBirthBC
                })
                setPersonHasPassphrase(formData.hasPassphrase)
              }}
            />
          </div>
          {/* Father Information - Using PersonHashCalculator */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFatherExpanded(!fatherExpanded)}
              className="w-full flex items-center justify-between py-4 px-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-green-600" />
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t('addVersion.fatherInfo', 'Father Information')}
                </h3>
                <StatusIndicator status={fatherStatus} />
                {fatherStatus !== 'empty' && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded">
                    {fatherStatus === 'partial' ? t('addVersion.partial', 'Partial') : t('addVersion.complete', 'Complete')}
                  </span>
                )}
              </div>
              {fatherExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>

            <div className={`py-4 px-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 space-y-3 ${fatherExpanded ? '' : 'hidden'}`}>
              {/* Parent Info Notice */}
              <div className="p-3 bg-green-50/50 dark:bg-green-900/20 rounded-lg border border-green-200/50 dark:border-green-700/50">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
                      {t('addVersion.parentInfoNotice', 'Providing parent info locally generates zero-knowledge proofs for family linking (only hash values go on-chain) and earns DEEP token rewards. Parent info must match their actual versions exactly (incl. passphrase) to establish connection.')}
                    </p>
                  </div>
              </div>

              <PersonHashCalculator
                ref={fatherCalcRef}
                key={`father-${formResetKey}`}
                showTitle={false}
                collapsible={false}
                className="border-0 shadow-none"
                  initialValues={{
                    fullName: '',
                    gender: 1, // Default to male
                    birthYear: 0,
                    birthMonth: 0,
                    birthDay: 0,
                    isBirthBC: false,
                    passphrase: ''
                  }}
                onPublicFormChange={(formData) => {
                  setFatherInfo({
                    fullName: formData.fullName,
                    gender: formData.gender,
                    birthYear: formData.birthYear,
                    birthMonth: formData.birthMonth,
                    birthDay: formData.birthDay,
                    isBirthBC: formData.isBirthBC
                  })
                }}
              />
                
                <div className="w-40">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 whitespace-nowrap">
                    {t('addVersion.versionIndex', 'Version Index')} ({t('addVersion.versionIndexHint')})
                  </label>
                  <input
                    type="number"
                    min="0"
                    {...register('fatherVersionIndex', {
                      setValueAs: (v) => v === '' ? '' : parseInt(v, 10)
                    })}
                    className="w-20 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                    placeholder='0'
                  />
                </div>
              </div>
            </div>

          {/* Mother Information - Using PersonHashCalculator */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMotherExpanded(!motherExpanded)}
              className="w-full flex items-center justify-between py-4 px-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-pink-600" />
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t('addVersion.motherInfo', 'Mother Information')}
                </h3>
                <StatusIndicator status={motherStatus} />
                {motherStatus !== 'empty' && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded">
                    {motherStatus === 'partial' ? t('addVersion.partial', 'Partial') : t('addVersion.complete', 'Complete')}
                  </span>
                )}
              </div>
              {motherExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>

            <div className={`py-4 px-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 space-y-3 ${motherExpanded ? '' : 'hidden'}`}>
              {/* Parent Info Notice */}
              <div className="p-3 bg-green-50/50 dark:bg-green-900/20 rounded-lg border border-green-200/50 dark:border-green-700/50">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
                      {t('addVersion.parentInfoNotice', 'Providing parent info locally generates zero-knowledge proofs for family linking (only hash values go on-chain) and earns DEEP token rewards. Parent info must match their actual versions exactly (incl. passphrase) to establish connection.')}
                    </p>
                  </div>
                </div>

              <PersonHashCalculator
                ref={motherCalcRef}
                key={`mother-${formResetKey}`}
                showTitle={false}
                collapsible={false}
                className="border-0 shadow-none"
                  initialValues={{
                    fullName: '',
                    gender: 2, // Default to female
                    birthYear: 0,
                    birthMonth: 0,
                    birthDay: 0,
                    isBirthBC: false,
                    passphrase: ''
                  }}
                onPublicFormChange={(formData) => {
                  setMotherInfo({
                    fullName: formData.fullName,
                    gender: formData.gender,
                    birthYear: formData.birthYear,
                    birthMonth: formData.birthMonth,
                    birthDay: formData.birthDay,
                    isBirthBC: formData.isBirthBC
                  })
                }}
              />
                
                <div className="w-40">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 whitespace-nowrap">
                    {t('addVersion.versionIndex', 'Version Index')} ({t('addVersion.versionIndexHint')})
                  </label>
                  <input
                    type="number"
                    min="0"
                    {...register('motherVersionIndex', {
                      setValueAs: (v) => v === '' ? '' : parseInt(v, 10)
                    })}
                    className="w-20 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                    placeholder='0'
                  />
                </div>
              </div>
            </div>

          {/* Metadata */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('addVersion.tag', 'Tag')}
              </label>
              <input
                {...register('tag')}
                className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
                placeholder={t('addVersion.tagPlaceholder', 'Optional tag')}
              />
            </div>
            <div className="rounded-lg border border-blue-100 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="font-medium text-gray-900 dark:text-gray-100">
                    {t('addVersion.encryptionPassword', 'Metadata Encryption Password (AES-GCM, local encryption)')}
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-blue-400 text-blue-600 focus:ring-blue-500"
                    checked={usePersonPassphraseForEncryption}
	                    onChange={(e) => {
	                      const checked = e.target.checked
	                      setUsePersonPassphraseForEncryption(checked)
	                      if (checked) {
	                        if (encryptionPasswordRef.current) encryptionPasswordRef.current.value = ''
	                        if (confirmEncryptionPasswordRef.current) confirmEncryptionPasswordRef.current.value = ''
	                      }
	                      if (checked && encryptionError) setEncryptionError(null)
	                    }}
	                  />
                  <span>{t('addVersion.usePassphraseForEncryption', 'Use identity passphrase for metadata encryption')}</span>
                </label>
              </div>
              {showManualEncryptionInputs ? (
                <>
                  {usePersonPassphraseForEncryption && !personHasPassphrase && (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      {t('addVersion.passphraseMissingForEncryption', 'Identity passphrase is empty. Please enter an encryption password below or set a passphrase above.')}
                    </p>
                  )}
	                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
	                    <div className="relative">
	                      <input
	                        type={showEncryptionPassword ? 'text' : 'password'}
	                        ref={encryptionPasswordRef}
	                        onChange={() => { if (encryptionError) setEncryptionError(null) }}
	                        className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 pr-10 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
	                        placeholder={t('addVersion.encryptionPasswordPlaceholder', 'At least 8 characters')}
	                        inputMode="text"
	                        autoCapitalize="none"
	                        autoComplete="new-password"
	                        autoCorrect="off"
	                        spellCheck={false}
	                      />
                      <button
                        type="button"
                        onClick={() => setShowEncryptionPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none"
                        aria-label={showEncryptionPassword ? 'Hide encryption password' : 'Show encryption password'}
                      >
                        {showEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
	                    <div className="relative">
	                      <input
	                        type={showConfirmEncryptionPassword ? 'text' : 'password'}
	                        ref={confirmEncryptionPasswordRef}
	                        onChange={() => { if (encryptionError) setEncryptionError(null) }}
	                        className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 pr-10 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition"
	                        placeholder={t('addVersion.encryptionPasswordConfirm', 'Confirm password')}
	                        inputMode="text"
	                        autoCapitalize="none"
	                        autoComplete="new-password"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmEncryptionPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none"
                        aria-label={showConfirmEncryptionPassword ? 'Hide encryption password confirmation' : 'Show encryption password confirmation'}
                      >
                        {showConfirmEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  {encryptionError && (
                    <p className="text-xs text-red-600 dark:text-red-300">{encryptionError}</p>
                  )}
                  <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                    {t('addVersion.encryptionNotice', 'Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.')}
                  </p>
                </>
              ) : (
                <div className="space-y-1 text-[11px] text-gray-700 dark:text-gray-200">
                  <p className="text-amber-800 dark:text-amber-200">{t('addVersion.encryptionNotice', 'Metadata is encrypted locally before generating CID. Please keep your password safe, as it cannot be recovered if lost.')}</p>
                  {encryptionError && (
                    <p className="text-xs text-red-600 dark:text-red-300">{encryptionError}</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('addVersion.metadataCID', 'Metadata CID')}
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  ({t('addVersion.autoGenerated', 'Auto-generated')})
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  {...register('metadataCID')}
                  readOnly
                  className="flex-1 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 text-sm text-gray-600 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-400 outline-none cursor-not-allowed"
                  placeholder={t('addVersion.metadataCIDPlaceholder', 'Will be auto-generated from metadata')}
                />
                <button
                  type="button"
                  onClick={handleDownloadMetadata}
                  disabled={isSubmitting}
                  className="px-3 h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"
                  title={t('addVersion.downloadMetadata', 'Download metadata JSON')}
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('addVersion.download', 'Download')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Informed Consent for Add Version */}
          {!successResult && (
            <div className="p-4 sm:p-5 rounded-lg border border-red-200/80 bg-red-50 dark:border-red-300/40 dark:bg-red-900/15">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-300 mt-0.5 shrink-0" />
                <div className="space-y-3 w-full">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-50">
                    {t('addVersion.consentTitle', 'Informed consent (required)')}
                  </p>
                  <div className="space-y-2">
                    {([
                      { key: 'hash', label: t('addVersion.consentHash', 'I understand the plaintext stays off-chain, but its hash will be permanently public on-chain and cannot be removed.') },
                      { key: 'age', label: t('addVersion.consentAge', 'I confirm the person is 18 years or older.') },
                      { key: 'legal', label: t('addVersion.consentLegal', 'I confirm the data is lawful, truthful, and authorized for disclosure; no extra private content is included.') }
                    ] as const).map(item => (
                      <label key={item.key} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={consents[item.key]}
                          onChange={() => toggleConsent(item.key)}
                          className="h-4 w-4 rounded border-red-400 text-red-600 focus:ring-red-500"
                        />
                        <span className="text-xs text-red-900 dark:text-red-50 leading-snug">{item.label}</span>
                      </label>
                    ))}
                  </div>
                  {consentError && (
                    <p className="text-xs text-red-700 dark:text-red-200 font-medium">
                      {consentError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Progress Indicator */}
          {isSubmitting && proofGenerationStep && !successResult && !errorResult && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                    {t('addVersion.processing', 'Processing...')}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    {proofGenerationStep}
                  </p>
                </div>
              </div>
              {proofGenerationStep.includes('30-60 seconds') && (
                <div className="mt-3 text-xs text-blue-600 dark:text-blue-400">
                  {t('addVersion.proofGenerationNote', 'ZK proof generation requires complex cryptographic calculations. Please wait...')}
                </div>
              )}
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
                    {t('addVersion.successTitle', 'Version Added Successfully')}
                  </h3>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('addVersion.successDesc', 'The person version has been added to the blockchain')}
                  </p>
                </div>
              </div>

              {/* Compact Event Cards */}
              <div className="space-y-3">
                
                {/* ZK Proof Verified */}
                {successResult.events.PersonHashZKVerified && (
                  <details className="group bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 overflow-hidden">
                    <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          {t('addVersion.zkProofVerified', 'ZK Proof Verified')}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-blue-600 group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                        {t('addVersion.zkProofVerifiedDesc', 'Zero-knowledge proof was successfully verified on-chain')}
                      </p>
                      <DataRow
                        label={t('addVersion.hashPrefix', 'Hash')}
                        value={successResult.events.PersonHashZKVerified.personHash}
                        colorClass="blue"
                      />
                      <DataRow
                        label={t('addVersion.prover', 'Prover')}
                        value={successResult.events.PersonHashZKVerified.prover}
                        colorClass="blue"
                      />
                    </div>
                  </details>
                )}
                
                {/* Version Added */}
                {successResult.events.PersonVersionAdded && (
                  <details className="group bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 overflow-hidden" open>
                    <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                        <span className="text-sm font-medium text-green-900 dark:text-green-100">
                          {t('addVersion.versionAdded', 'Person Version Added')}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-green-600 group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-xs text-green-700 dark:text-green-300 mb-2">
                        {t('addVersion.versionAddedDesc', 'Person version was successfully added to the family tree')}
                      </p>
                      <DataRow
                        label={t('addVersion.hashPrefix', 'Hash')}
                        value={successResult.events.PersonVersionAdded.personHash}
                        colorClass="green"
                      />
                      <DataRow
                        label={t('addVersion.versionIndex', 'Version Index')}
                        value={successResult.events.PersonVersionAdded.versionIndex.toString()}
                        colorClass="green"
                      />
                      <DataRow
                        label={t('addVersion.addedBy', 'Added By')}
                        value={successResult.events.PersonVersionAdded.addedBy}
                        colorClass="green"
                      />
                      <DataRow
                        label={t('addVersion.timestamp', 'Timestamp')}
                        value={new Date(successResult.events.PersonVersionAdded.timestamp * 1000).toLocaleString()}
                        colorClass="green"
                        isPlainText
                      />

                      {/* Father Info */}
                      {successResult.events.PersonVersionAdded.fatherHash &&
                       successResult.events.PersonVersionAdded.fatherHash !== ethers.ZeroHash && (
                        <>
                          <DataRow
                            label={t('addVersion.fatherHash', 'Father Hash')}
                            value={successResult.events.PersonVersionAdded.fatherHash}
                            colorClass="green"
                          />
                          <DataRow
                            label={t('addVersion.fatherVersionIndex', 'Father Version')}
                            value={successResult.events.PersonVersionAdded.fatherVersionIndex.toString()}
                            colorClass="green"
                          />
                        </>
                      )}

                      {/* Mother Info */}
                      {successResult.events.PersonVersionAdded.motherHash &&
                       successResult.events.PersonVersionAdded.motherHash !== ethers.ZeroHash && (
                        <>
                          <DataRow
                            label={t('addVersion.motherHash', 'Mother Hash')}
                            value={successResult.events.PersonVersionAdded.motherHash}
                            colorClass="green"
                          />
                          <DataRow
                            label={t('addVersion.motherVersionIndex', 'Mother Version')}
                            value={successResult.events.PersonVersionAdded.motherVersionIndex.toString()}
                            colorClass="green"
                          />
                        </>
                      )}

                      {/* Tag */}
                      {successResult.events.PersonVersionAdded.tag && (
                        <DataRow
                          label={t('addVersion.tag', 'Tag')}
                          value={`"${successResult.events.PersonVersionAdded.tag}"`}
                          colorClass="green"
                          isPlainText
                        />
                      )}
                    </div>
                  </details>
                )}
                
                {/* Token Reward */}
                {successResult.events.TokenRewardDistributed ? (
                  <details className="group bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 overflow-hidden">
                    <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>
                        <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                          {t('addVersion.tokenReward', 'Token Reward Distributed')}
                        </span>
                        <span className="ml-2 text-xs font-semibold text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-800 px-2 py-0.5 rounded-full">
                          {(Number(successResult.events.TokenRewardDistributed.reward) / Math.pow(10, 18)).toLocaleString()} DEEP
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-yellow-600 group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                        {t('addVersion.familyComplete', 'Parent hash commitments submitted - token reward earned')}
                      </p>
                      <DataRow
                        label={t('addVersion.miner', 'Miner')}
                        value={successResult.events.TokenRewardDistributed.miner}
                        colorClass="yellow"
                      />
                      <DataRow
                        label={t('addVersion.hashPrefix', 'Hash')}
                        value={successResult.events.TokenRewardDistributed.personHash}
                        colorClass="yellow"
                      />
                      <DataRow
                        label={t('addVersion.versionIndex', 'Version Index')}
                        value={successResult.events.TokenRewardDistributed.versionIndex.toString()}
                        colorClass="yellow"
                      />
                      <DataRow
                        label={t('addVersion.rewardAmount', 'Reward Amount')}
                        value={`${(Number(successResult.events.TokenRewardDistributed.reward) / Math.pow(10, 18)).toLocaleString()} DEEP`}
                        colorClass="yellow"
                        isPlainText
                      />
                    </div>
                  </details>
                ) : (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('addVersion.noTokenReward', 'No Token Reward')}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {t('addVersion.tokenRewardCondition', 'Token rewards are only distributed when both parents already exist in the system')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
                    {t('addVersion.failed', 'Transaction Failed')}
                  </p>
                  <div className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-red-800 dark:text-red-200">
                        {t('addVersion.errorType', 'Error Type')}
                      </span>
                      <code className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded font-mono text-xs">
                        {errorResult.type}
                      </code>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-red-800 dark:text-red-200">
                        {t('addVersion.errorMessage', 'Message')}
                      </span>
                      <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                        {errorResult.message}
                      </p>
                    </div>
                    {errorResult.details !== errorResult.message && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-red-800 dark:text-red-200">
                          {t('addVersion.errorDetails', 'Details')}
                        </span>
                        <p className="bg-red-100 dark:bg-red-800 text-red-900 dark:text-red-100 px-2 py-1 rounded text-xs">
                          {errorResult.details}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

            </div>

            {/* Submit Buttons */}
            <div className="flex gap-3 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:p-6 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
              {successResult ? (
                // Success state: Show Close, Continue Adding and Go to Endorse buttons
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
                    onClick={handleContinueAdding}
                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    {t('addVersion.continueAdding', 'Continue Adding')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onEndorse && successResult.hash && successResult.index) {
                        // Let the parent component handle closing this modal and opening the endorse modal
                        onEndorse(successResult.hash, successResult.index)
                      }
                    }}
                    className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Star className="w-4 h-4" />
                    {t('addVersion.goToEndorse', 'Go to Endorse')}
                  </button>
                </>
              ) : (
                // Normal state: Show Cancel and Submit buttons
                <>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !normalizeNameForHash(personInfo?.fullName || '').length || !allConsentsChecked}
                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isSubmitting ? 
                      t('addVersion.processing', 'Processing...') :
                      t('addVersion.submit', 'Add Version')
                    }
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
        </div>
      </div>
    </div>
  )
}
