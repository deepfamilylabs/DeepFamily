import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { ChevronDown, Clipboard } from 'lucide-react'
import { useToast } from './ToastProvider'
import { formatHashMiddle } from '../types/graph'
import { poseidon3 } from 'poseidon-lite'
import { useConfig } from '../context/ConfigContext'
import { makeProvider } from '../utils/provider'
import DeepFamily from '../abi/DeepFamily.json'

const MAX_FULL_NAME_BYTES = 256

const getByteLength = (str: string): number => {
  return new TextEncoder().encode(str).length
}

// Field error component
const FieldError: React.FC<{ message?: string }> = ({ message }) => (
  <div className={`text-xs h-4 leading-4 ${message ? 'text-red-600' : 'text-transparent'}`}>
    {message || 'placeholder'}
  </div>
)

// Simple themed select component
const ThemedSelect: React.FC<{
  value: number
  onChange: (v: number) => void
  options: { value: number; label: string }[]
  className?: string
}> = ({ value, onChange, options, className = '' }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = options.find(o => o.value === value)?.label ?? ''

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-left text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={16} className="text-gray-500 dark:text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
          <ul role="listbox" className="max-h-60 overflow-auto">
            {options.map((o) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
                  o.value === value
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Hash form schema and types
const hashFormSchema = z.object({
  fullName: z.string().min(1).refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, 'Name exceeds max bytes'),
  isBirthBC: z.boolean(),
  birthYear: z.union([z.number().int().min(0).max(10000), z.literal('')]).transform(val => val === '' ? 0 : val),
  birthMonth: z.union([z.number().int().min(0).max(12), z.literal('')]).transform(val => val === '' ? 0 : val),
  birthDay: z.union([z.number().int().min(0).max(31), z.literal('')]).transform(val => val === '' ? 0 : val),
  gender: z.number().int().min(0).max(3),
})

export type HashForm = z.infer<typeof hashFormSchema>

// Hash calculation function using Poseidon (matches circuit and contract)
export function computePersonHash(input: HashForm): string {
  const { fullName, isBirthBC, birthYear, birthMonth, birthDay, gender } = input

  // Compute fullNameHash exactly like the contract
  const fullNameHash = ethers.keccak256(ethers.toUtf8Bytes(fullName))

  // Convert fullNameHash to two 128-bit limbs (matching circuit's HashToLimbs)
  const fullNameHashBN = BigInt(fullNameHash)
  const limb0 = fullNameHashBN >> 128n // High 128 bits
  const limb1 = fullNameHashBN & ((1n << 128n) - 1n) // Low 128 bits

  // Pack small fields into a single field element to match circuit's packedData
  // Format: birthYear * 2^24 + birthMonth * 2^16 + birthDay * 2^8 + gender * 2^1 + isBirthBC
  const packedData = (BigInt(birthYear) << 24n) |
    (BigInt(birthMonth) << 16n) |
    (BigInt(birthDay) << 8n) |
    (BigInt(gender) << 1n) |
    (isBirthBC ? 1n : 0n)

  // Poseidon(3) commitment over SNARK-friendly field elements
  const poseidonResult = poseidon3([limb0, limb1, packedData])

  // Convert result to bytes32 format
  return '0x' + poseidonResult.toString(16).padStart(64, '0')
}

// Component props interface
interface PersonHashCalculatorProps {
  className?: string
  onFormChange?: (formData: HashForm) => void
  showTitle?: boolean
  collapsible?: boolean
  isOpen?: boolean
  onToggle?: () => void
  initialValues?: {
    fullName?: string
    gender?: number
    birthYear?: number
    birthMonth?: number
    birthDay?: number
    isBirthBC?: boolean
  }
}

export const PersonHashCalculator: React.FC<PersonHashCalculatorProps> = ({
  className = '',
  onFormChange,
  showTitle = true,
  collapsible = false,
  isOpen = true,
  onToggle,
  initialValues
}) => {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(true)
  const toast = useToast()
  const config = useConfig()

  // Contract hash calculation state
  const [contractHash, setContractHash] = useState<string>('')
  const [contractLoading, setContractLoading] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)

  // Use external state if provided, otherwise use internal state
  const currentOpen = collapsible ? (onToggle ? isOpen : internalOpen) : true
  const handleToggle = () => {
    if (onToggle) {
      onToggle()
    } else {
      setInternalOpen(!internalOpen)
    }
  }

  // Create schema with translations
  const hashFormSchema = useMemo(() => z.object({
    fullName: z.string()
      .min(1, t('search.validation.required'))
      .refine((val) => getByteLength(val) <= MAX_FULL_NAME_BYTES, { message: t('search.validation.nameTooLong') }),
    isBirthBC: z.boolean(),
    birthYear: z.union([z.number().int().min(0, t('search.validation.yearRange')).max(10000, t('search.validation.yearRange')), z.literal('')]).optional().transform(val => val === '' || val === undefined ? 0 : val),
    birthMonth: z.union([z.number().int().min(0, t('search.validation.monthRange')).max(12, t('search.validation.monthRange')), z.literal('')]).optional().transform(val => val === '' || val === undefined ? 0 : val),
    birthDay: z.union([z.number().int().min(0, t('search.validation.dayRange')).max(31, t('search.validation.dayRange')), z.literal('')]).optional().transform(val => val === '' || val === undefined ? 0 : val),
    gender: z.number().int().min(0).max(3),
  }), [t])

  const { register, formState: { errors }, setValue, watch } = useForm({
    resolver: zodResolver(hashFormSchema),
    defaultValues: { 
      fullName: initialValues?.fullName || '', 
      isBirthBC: initialValues?.isBirthBC || false, 
      birthYear: initialValues?.birthYear || '', 
      birthMonth: initialValues?.birthMonth || '', 
      birthDay: initialValues?.birthDay || '', 
      gender: initialValues?.gender || 0 
    },
  })

  // Watch for form changes and notify parent
  const fullName = watch('fullName')
  const isBirthBC = watch('isBirthBC')
  const birthYear = watch('birthYear')
  const birthMonth = watch('birthMonth')
  const birthDay = watch('birthDay')
  const gender = watch('gender')
  
  const computedHash = useMemo(() => {
    const transformedData: HashForm = {
      fullName: fullName || '',
      isBirthBC: isBirthBC || false,
      birthYear: birthYear === '' || birthYear === undefined ? 0 : Number(birthYear),
      birthMonth: birthMonth === '' || birthMonth === undefined ? 0 : Number(birthMonth),
      birthDay: birthDay === '' || birthDay === undefined ? 0 : Number(birthDay),
      gender: Number(gender || 0),
    }
    if (!transformedData.fullName.trim()) return ''
    return computePersonHash(transformedData)
  }, [fullName, isBirthBC, birthYear, birthMonth, birthDay, gender])

  // Function to call contract getPersonHash
  const callContractHash = async (formData: HashForm) => {
    if (!formData.fullName.trim()) {
      setContractHash('')
      setContractError(null)
      return
    }

    setContractLoading(true)
    setContractError(null)

    try {
      const provider = makeProvider(config.rpcUrl)
      const contract = new ethers.Contract(config.contractAddress, (DeepFamily as any).abi, provider)

      // Create PersonBasicInfo struct
      const nameBytes = new TextEncoder().encode(formData.fullName)
      const fullNameHash = ethers.keccak256(nameBytes)

      const basicInfo = {
        fullNameHash: fullNameHash,
        isBirthBC: formData.isBirthBC,
        birthYear: formData.birthYear,
        birthMonth: formData.birthMonth,
        birthDay: formData.birthDay,
        gender: formData.gender
      }

      const result = await contract.getPersonHash(basicInfo)
      setContractHash(result)
    } catch (error: any) {
      console.error('Contract hash calculation failed:', error)
      setContractError(error.message || 'Failed to calculate contract hash')
      setContractHash('')
    } finally {
      setContractLoading(false)
    }
  }
  
  const onFormChangeRef = useRef(onFormChange)
  
  // Update the ref when onFormChange changes
  useEffect(() => {
    onFormChangeRef.current = onFormChange
  }, [onFormChange])
  
  useEffect(() => {
    if (!onFormChangeRef.current) return

    const transformedData: HashForm = {
      fullName: fullName || '',
      isBirthBC: isBirthBC || false,
      birthYear: birthYear === '' || birthYear === undefined ? 0 : Number(birthYear),
      birthMonth: birthMonth === '' || birthMonth === undefined ? 0 : Number(birthMonth),
      birthDay: birthDay === '' || birthDay === undefined ? 0 : Number(birthDay),
      gender: Number(gender || 0),
    }
    onFormChangeRef.current(transformedData)
  }, [fullName, isBirthBC, birthYear, birthMonth, birthDay, gender])

  // Call contract hash when form data changes
  useEffect(() => {
    const transformedData: HashForm = {
      fullName: fullName || '',
      isBirthBC: isBirthBC || false,
      birthYear: birthYear === '' || birthYear === undefined ? 0 : Number(birthYear),
      birthMonth: birthMonth === '' || birthMonth === undefined ? 0 : Number(birthMonth),
      birthDay: birthDay === '' || birthDay === undefined ? 0 : Number(birthDay),
      gender: Number(gender || 0),
    }
    callContractHash(transformedData)
  }, [fullName, isBirthBC, birthYear, birthMonth, birthDay, gender, config.rpcUrl, config.contractAddress])

  const content = (
    <div className="space-y-2">
      <div className="w-full space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="basis-full sm:basis-[360px] md:basis-[420px] grow-0 shrink-0">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
              {t('search.hashCalculator.name')} <span className="text-red-500">*</span>
            </label>
            <input 
              className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
              placeholder={t('search.hashCalculator.nameInputPlaceholder')}
              {...register('fullName')} 
            />
            <FieldError message={errors.fullName?.message} />
          </div>
          
          <div className="w-28">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
              {t('search.hashCalculator.gender')}
            </label>
            <ThemedSelect
              value={Number(gender ?? 0)}
              onChange={(v) => setValue('gender', v, { shouldValidate: true, shouldDirty: true })}
              options={[
                { value: 0, label: t('search.hashCalculator.genderOptions.unknown') },
                { value: 1, label: t('search.hashCalculator.genderOptions.male') },
                { value: 2, label: t('search.hashCalculator.genderOptions.female') },
                { value: 3, label: t('search.hashCalculator.genderOptions.other') },
              ]}
            />
            <FieldError message={errors.gender?.message} />
          </div>
        </div>
        
        <div className="flex flex-nowrap items-start gap-1">
          <div className="flex items-start gap-1">
            <div className="w-35">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                {t('search.hashCalculator.isBirthBC')}
              </label>
              <ThemedSelect
                value={isBirthBC ? 1 : 0}
                onChange={(v) => setValue('isBirthBC', v === 1, { shouldValidate: true, shouldDirty: true })}
                options={[
                  { value: 0, label: t('search.hashCalculator.bcOptions.ad') },
                  { value: 1, label: t('search.hashCalculator.bcOptions.bc') },
                ]}
              />
              <FieldError />
            </div>
            
            <div className="w-25">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                {t('search.hashCalculator.birthYearLabel')}
              </label>
              <input 
                type="number" 
                placeholder={t('search.hashCalculator.birthYear')} 
                className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
                {...register('birthYear', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} 
              />
              <FieldError message={errors.birthYear?.message} />
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
              placeholder={t('search.hashCalculator.birthMonth')} 
              className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
              {...register('birthMonth', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} 
            />
            <FieldError message={errors.birthMonth?.message} />
          </div>
          
          <div className="w-24">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
              {t('search.hashCalculator.birthDayLabel')}
            </label>
            <input 
              type="number" 
              min="0" 
              max="31" 
              placeholder={t('search.hashCalculator.birthDay')} 
              className="w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-400 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 outline-none transition" 
              {...register('birthDay', { setValueAs: (v) => v === '' ? '' : parseInt(v, 10) })} 
            />
            <FieldError message={errors.birthDay?.message} />
          </div>
        </div>
      </div>
      {computedHash && (
        <div className="space-y-2">
          {/* Local calculation result */}
          <div className="flex items-center gap-1 overflow-hidden">
            <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">
              {t('search.hashCalculator.calculatedHash')}:
            </span>
            <HashInline value={computedHash} className="font-mono text-sm leading-none text-gray-700 dark:text-gray-300 tracking-tight" />
            <button
              type="button"
              onClick={async () => {
                try {
                  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(computedHash)
                    toast.show(t('search.copied'))
                    return
                  }
                } catch {}
                try {
                  const ta = document.createElement('textarea')
                  ta.value = computedHash
                  ta.style.position = 'fixed'
                  ta.style.left = '-9999px'
                  document.body.appendChild(ta)
                  ta.focus(); ta.select()
                  const ok = document.execCommand('copy')
                  document.body.removeChild(ta)
                  toast.show(ok ? t('search.copied') : t('search.copyFailed'))
                } catch {
                  toast.show(t('search.copyFailed'))
                }
              }}
              aria-label={t('search.copy')}
              className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title={t('search.copy')}
            >
              <Clipboard size={14} />
            </button>
          </div>

          {/* Contract verification result */}
          <div className="flex items-center gap-1 overflow-hidden">
            <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">
              {t('search.hashCalculator.contractHash')}:
            </span>
            {contractLoading ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
            ) : contractError ? (
              <span className="text-xs text-red-500">{contractError}</span>
            ) : contractHash ? (
              <>
                <HashInline
                  value={contractHash}
                  className={`font-mono text-sm leading-none tracking-tight ${
                    contractHash === computedHash
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        await navigator.clipboard.writeText(contractHash)
                        toast.show(t('search.copied'))
                        return
                      }
                    } catch {}
                    try {
                      const ta = document.createElement('textarea')
                      ta.value = contractHash
                      ta.style.position = 'fixed'
                      ta.style.left = '-9999px'
                      document.body.appendChild(ta)
                      ta.focus(); ta.select()
                      const ok = document.execCommand('copy')
                      document.body.removeChild(ta)
                      toast.show(ok ? t('search.copied') : t('search.copyFailed'))
                    } catch {
                      toast.show(t('search.copyFailed'))
                    }
                  }}
                  aria-label={t('search.copy')}
                  className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  title={t('search.copy')}
                >
                  <Clipboard size={14} />
                </button>
              </>
            ) : (
              <span className="text-xs text-gray-500 dark:text-gray-400">-</span>
            )}
          </div>

          {/* Comparison status */}
          {contractHash && computedHash && (
            <div className="text-xs">
              {contractHash === computedHash ? (
                <span className="text-green-600 dark:text-green-400">✓ {t('search.hashCalculator.hashesMatch')}</span>
              ) : (
                <span className="text-red-600 dark:text-red-400">✗ {t('search.hashCalculator.hashesNoMatch')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (!collapsible) {
    // If className contains borderless styles, return content directly
    if (className.includes('border-0') || className.includes('shadow-none')) {
      return (
        <div className={className}>
          {content}
        </div>
      )
    }
    
    return (
      <div className={`rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden ${className}`}>
        {showTitle && (
          <div className="bg-teal-50 dark:bg-gray-800/60 px-4 py-2 border-b border-gray-200 dark:border-gray-700/60">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {t('search.hashCalculator.title')}
            </h3>
          </div>
        )}
        <div className="py-6 px-3">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 shadow-sm overflow-hidden ${className}`}>
      <div 
        className="bg-teal-50 dark:bg-gray-800/60 px-4 py-2 flex items-center justify-between cursor-pointer border-b border-gray-200 dark:border-gray-700/60" 
        onClick={handleToggle}
      >
        {showTitle && (
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('search.hashCalculator.title')}
          </h3>
        )}
        <button 
          type="button" 
          className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" 
          onClick={(e) => { e.stopPropagation(); handleToggle() }} 
          aria-expanded={currentOpen}
        >
          {currentOpen ? '-' : '+'}
        </button>
      </div>
      {currentOpen && (
        <div className="py-4 px-3">
          {content}
        </div>
      )}
    </div>
  )
}

export default PersonHashCalculator

// Inline hash renderer: shows full when fits; otherwise 10...8 middle ellipsis
const HashInline: React.FC<{ value: string; className?: string; titleText?: string; prefix?: number; suffix?: number }> = ({ value, className = '', titleText, prefix = 10, suffix = 8 }) => {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState<string>(value)

  const recompute = () => {
    const container = containerRef.current
    const meas = measureRef.current
    if (!container || !meas) return
    meas.textContent = value
    const fits = meas.scrollWidth <= container.clientWidth
    setDisplay(fits ? value : formatHashMiddle(value, prefix, suffix))
  }

  useEffect(() => {
    recompute()
    const ro = new ResizeObserver(() => recompute())
    if (containerRef.current) ro.observe(containerRef.current)
    const onResize = () => recompute()
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [value, prefix, suffix])

  return (
    <>
      <span ref={containerRef} className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={titleText ?? value}>
        {display}
      </span>
      {/* measurement node mirrors font styles to ensure accurate width */}
      <span ref={measureRef} className={`absolute left-[-99999px] top-0 invisible whitespace-nowrap ${className}`} />
    </>
  )
}
