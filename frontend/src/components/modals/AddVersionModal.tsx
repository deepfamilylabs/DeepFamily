import React, { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X, Upload, AlertCircle, User, Users, ChevronDown, ChevronRight, UserPlus, Check, AlertTriangle } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { submitAddPersonZK } from '../../lib/zk'
import { useConfig } from '../../context/ConfigContext'
import PersonHashCalculator from '../PersonHashCalculator'

const addVersionSchema = z.object({
  // Father and mother version indexes only
  fatherVersionIndex: z.number().min(0),
  motherVersionIndex: z.number().min(0),
  
  // Metadata
  tag: z.string().max(50, 'Tag too long'),
  metadataCID: z.string().optional()
})

type AddVersionForm = z.infer<typeof addVersionSchema>

interface AddVersionModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  personHash?: string
  existingPersonData?: {
    fullName?: string
    gender?: number
    birthYear?: number
    birthMonth?: number
    birthDay?: number
    isBirthBC?: boolean
  }
}

export default function AddVersionModal({
  isOpen,
  onClose,
  onSuccess,
  personHash,
  existingPersonData
}: AddVersionModalProps) {
  const { t } = useTranslation()
  const { signer } = useWallet()
  const { contractAddress } = useConfig()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [zkProof, setZkProof] = useState<any>(null)
  const [publicSignals, setPublicSignals] = useState<any[]>([])
  
  // Person hash and info from PersonHashCalculator
  const [personInfo, setPersonInfo] = useState<{
    fullName: string
    gender: number
    birthYear: number
    birthMonth: number
    birthDay: number
    isBirthBC: boolean
  } | null>(null)

  // Father and mother info from PersonHashCalculator components
  const [fatherInfo, setFatherInfo] = useState<{
    fullName: string
    gender: number
    birthYear: number
    birthMonth: number
    birthDay: number
    isBirthBC: boolean
  } | null>(null)

  const [motherInfo, setMotherInfo] = useState<{
    fullName: string
    gender: number
    birthYear: number
    birthMonth: number
    birthDay: number
    isBirthBC: boolean
  } | null>(null)
  
  const [entered, setEntered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const startYRef = useRef<number | null>(null)
  
  // Parent info collapse states
  const [fatherExpanded, setFatherExpanded] = useState(false)
  const [motherExpanded, setMotherExpanded] = useState(false)

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
    watch,
    reset
  } = useForm<AddVersionForm>({
    resolver: zodResolver(addVersionSchema),
    defaultValues: {
      // Parent version indexes only
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      
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
    
    if (!info || !info.fullName.trim()) return 'empty'
    if (info.fullName.trim() && versionIndex > 0) return 'complete'
    return 'partial'
  }
  
  const fatherStatus = getParentInfoStatus('father')
  const motherStatus = getParentInfoStatus('mother')

  // Initialize states if existing data is provided
  useEffect(() => {
    if (personHash && existingPersonData) {
      setPersonInfo({
        fullName: existingPersonData.fullName || '',
        gender: existingPersonData.gender || 0,
        birthYear: existingPersonData.birthYear || 0,
        birthMonth: existingPersonData.birthMonth || 0,
        birthDay: existingPersonData.birthDay || 0,
        isBirthBC: existingPersonData.isBirthBC || false
      })
    }
  }, [personHash, existingPersonData])

  const handleClose = () => {
    reset()
    setZkProof(null)
    setPublicSignals([])
    setPersonInfo(null)
    setFatherInfo(null)
    setMotherInfo(null)
    setIsSubmitting(false)
    setFatherExpanded(false)
    setMotherExpanded(false)
    setDragging(false)
    setDragOffset(0)
    onClose()
  }

  const handleZKProofUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)
        if (data.proof && data.publicSignals) {
          setZkProof(data.proof)
          setPublicSignals(data.publicSignals)
        } else {
          alert(t('addVersion.invalidProofFile', 'Invalid proof file format'))
        }
      } catch (error) {
        alert(t('addVersion.proofFileError', 'Error reading proof file'))
      }
    }
    reader.readAsText(file)
  }

  const onSubmit = async (data: AddVersionForm) => {
    if (!signer) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    if (!contractAddress) {
      alert(t('addVersion.contractNotConfigured', 'Contract not configured'))
      return
    }

    if (!zkProof || !publicSignals.length) {
      alert(t('addVersion.proofRequired', 'Please upload ZK proof file'))
      return
    }

    setIsSubmitting(true)

    try {
      const result = await submitAddPersonZK(
        signer,
        contractAddress,
        zkProof,
        publicSignals,
        data.fatherVersionIndex,
        data.motherVersionIndex,
        data.tag,
        data.metadataCID || ''
      )

      if (result) {
        onSuccess?.(result)
        handleClose()
      }
    } catch (error: any) {
      console.error('Add version failed:', error)
      alert(error.message || t('addVersion.submitFailed', 'Failed to add version'))
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
          className="sticky top-0 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-indigo-500/10 dark:from-blue-600/20 dark:via-purple-600/15 dark:to-indigo-600/20 p-4 pt-7 sm:pt-6 sm:p-6 border-b border-gray-200/50 dark:border-gray-700/50 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60 relative touch-none cursor-grab active:cursor-grabbing"
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
                <UserPlus className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {personHash ? 
                    t('addVersion.addNewVersion', 'Add New Version') : 
                    t('addVersion.addPerson', 'Add Person')
                  }
                </h2>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  <span className="whitespace-nowrap">{t('addVersion.description', 'Add person with zero-knowledge proof')}</span>
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
          <form id="add-version-form" onSubmit={handleSubmit(onSubmit)} className="min-h-full flex flex-col">
            <div className="flex-1 p-4 sm:p-6 space-y-6">
          
          {/* Person Being Added - Using PersonHashCalculator */}
          <PersonHashCalculator
            showTitle={false}
            collapsible={false}
            initialValues={existingPersonData}
            onFormChange={(formData) => {
              setPersonInfo({
                fullName: formData.fullName,
                gender: formData.gender,
                birthYear: formData.birthYear,
                birthMonth: formData.birthMonth,
                birthDay: formData.birthDay,
                isBirthBC: formData.isBirthBC
              })
            }}
          />
          {/* Father Information - Using PersonHashCalculator */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFatherExpanded(!fatherExpanded)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
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

            {fatherExpanded && (
              <div className="p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 space-y-3">
                <PersonHashCalculator
                  showTitle={false}
                  collapsible={false}
                  className="border-0 shadow-none"
                  initialValues={{
                    fullName: '',
                    gender: 1, // Default to male
                    birthYear: 0,
                    birthMonth: 0,
                    birthDay: 0,
                    isBirthBC: false
                  }}
                  onFormChange={(formData) => {
                    setFatherInfo(formData)
                  }}
                />
                
                <div className="w-32">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('addVersion.versionIndex', 'Version Index')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    {...register('fatherVersionIndex', { valueAsNumber: true })}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Mother Information - Using PersonHashCalculator */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMotherExpanded(!motherExpanded)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
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

            {motherExpanded && (
              <div className="p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 space-y-3">
                <PersonHashCalculator
                  showTitle={false}
                  collapsible={false}
                  className="border-0 shadow-none"
                  initialValues={{
                    fullName: '',
                    gender: 2, // Default to female
                    birthYear: 0,
                    birthMonth: 0,
                    birthDay: 0,
                    isBirthBC: false
                  }}
                  onFormChange={(formData) => {
                    setMotherInfo(formData)
                  }}
                />
                
                <div className="w-32">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('addVersion.versionIndex', 'Version Index')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    {...register('motherVersionIndex', { valueAsNumber: true })}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
                    placeholder="1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('addVersion.metadata', 'Metadata')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('addVersion.tag', 'Tag')}
                </label>
                <input
                  {...register('tag')}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
                  placeholder={t('addVersion.tagPlaceholder', 'Optional tag')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('addVersion.metadataCID', 'Metadata CID')}
                </label>
                <input
                  {...register('metadataCID')}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
                  placeholder="QmXXX..."
                />
              </div>
            </div>
          </div>

          {/* ZK Proof Upload */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('addVersion.zkProof', 'Zero-Knowledge Proof')}
            </h3>

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md p-4">
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8 text-gray-400" />
                <div className="mt-3">
                  <label className="cursor-pointer">
                    <span className="mt-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                      {zkProof ? 
                        t('addVersion.proofUploaded', 'Proof uploaded successfully') :
                        t('addVersion.uploadProof', 'Upload proof.json file')
                      }
                    </span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleZKProofUpload}
                      className="sr-only"
                    />
                  </label>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('addVersion.proofHint', 'JSON file containing ZK proof and public signals')}
                  </p>
                </div>
              </div>
            </div>

            {!zkProof && (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">
                  {t('addVersion.proofWarning', 'ZK proof is required to submit')}
                </span>
              </div>
            )}
          </div>
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
                type="submit"
                disabled={isSubmitting || !zkProof}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {isSubmitting ? 
                  t('addVersion.submitting', 'Submitting...') :
                  t('addVersion.submit', 'Add Version')
                }
              </button>
            </div>
          </form>
        </div>
        </div>
      </div>
    </div>
  )
}
