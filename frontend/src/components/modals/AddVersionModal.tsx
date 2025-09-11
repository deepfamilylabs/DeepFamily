import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X, Upload, AlertCircle, User, Users } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { submitAddPersonZK } from '../../lib/zk'
import { useConfig } from '../../context/ConfigContext'

const addVersionSchema = z.object({
  // Person being added
  fullName: z.string().min(1, 'Full name is required').max(100, 'Name too long'),
  gender: z.number().min(0).max(3),
  birthYear: z.number().min(0).max(9999),
  birthMonth: z.number().min(0).max(12),
  birthDay: z.number().min(0).max(31),
  isBirthBC: z.boolean(),
  
  // Father information
  fatherFullName: z.string().optional(),
  fatherGender: z.number().min(0).max(3),
  fatherBirthYear: z.number().min(0).max(9999),
  fatherBirthMonth: z.number().min(0).max(12),
  fatherBirthDay: z.number().min(0).max(31),
  fatherIsBirthBC: z.boolean(),
  fatherVersionIndex: z.number().min(0),
  
  // Mother information
  motherFullName: z.string().optional(),
  motherGender: z.number().min(0).max(3),
  motherBirthYear: z.number().min(0).max(9999),
  motherBirthMonth: z.number().min(0).max(12),
  motherBirthDay: z.number().min(0).max(31),
  motherIsBirthBC: z.boolean(),
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

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    reset
  } = useForm<AddVersionForm>({
    resolver: zodResolver(addVersionSchema),
    defaultValues: {
      // Person being added
      fullName: existingPersonData?.fullName || '',
      gender: existingPersonData?.gender || 0,
      birthYear: existingPersonData?.birthYear || 0,
      birthMonth: existingPersonData?.birthMonth || 0,
      birthDay: existingPersonData?.birthDay || 0,
      isBirthBC: existingPersonData?.isBirthBC || false,
      
      // Father defaults
      fatherFullName: '',
      fatherGender: 1, // Default to male
      fatherBirthYear: 0,
      fatherBirthMonth: 0,
      fatherBirthDay: 0,
      fatherIsBirthBC: false,
      fatherVersionIndex: 0,
      
      // Mother defaults
      motherFullName: '',
      motherGender: 2, // Default to female
      motherBirthYear: 0,
      motherBirthMonth: 0,
      motherBirthDay: 0,
      motherIsBirthBC: false,
      motherVersionIndex: 0,
      
      tag: '',
      metadataCID: ''
    }
  })

  const handleClose = () => {
    reset()
    setZkProof(null)
    setPublicSignals([])
    setIsSubmitting(false)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {personHash ? 
              t('addVersion.addNewVersion', 'Add New Version') : 
              t('addVersion.addPerson', 'Add Person')
            }
          </h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-8">
          
          {/* Person Being Added */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('addVersion.personInfo', 'Person Information')}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.fullName', 'Full Name')} *
                </label>
                <input
                  {...register('fullName')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('addVersion.fullNamePlaceholder', 'Enter full name')}
                />
                {errors.fullName && (
                  <p className="mt-1 text-sm text-red-600">{errors.fullName.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.gender', 'Gender')}
                </label>
                <select
                  {...register('gender', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                >
                  <option value={0}>{t('addVersion.genderUnknown', 'Unknown')}</option>
                  <option value={1}>{t('addVersion.genderMale', 'Male')}</option>
                  <option value={2}>{t('addVersion.genderFemale', 'Female')}</option>
                  <option value={3}>{t('addVersion.genderOther', 'Other')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthYear', 'Birth Year')}
                </label>
                <input
                  type="number"
                  {...register('birthYear', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="1990"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthMonth', 'Birth Month')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="12"
                  {...register('birthMonth', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="6"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthDay', 'Birth Day')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="31"
                  {...register('birthDay', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="15"
                />
              </div>

              <div className="flex items-center">
                <label className="flex items-center space-x-2 mt-6">
                  <input
                    type="checkbox"
                    {...register('isBirthBC')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('addVersion.isBirthBC', 'Birth BC')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Father Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('addVersion.fatherInfo', 'Father Information')}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.fatherFullName', 'Father Full Name')}
                </label>
                <input
                  {...register('fatherFullName')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('addVersion.fatherNamePlaceholder', 'Enter father name')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.versionIndex', 'Version Index')}
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('fatherVersionIndex', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthYear', 'Birth Year')}
                </label>
                <input
                  type="number"
                  {...register('fatherBirthYear', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="1960"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthMonth', 'Birth Month')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="12"
                  {...register('fatherBirthMonth', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="3"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthDay', 'Birth Day')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="31"
                  {...register('fatherBirthDay', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="20"
                />
              </div>

              <div className="flex items-center">
                <label className="flex items-center space-x-2 mt-6">
                  <input
                    type="checkbox"
                    {...register('fatherIsBirthBC')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('addVersion.isBirthBC', 'Birth BC')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Mother Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-pink-600" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('addVersion.motherInfo', 'Mother Information')}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.motherFullName', 'Mother Full Name')}
                </label>
                <input
                  {...register('motherFullName')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('addVersion.motherNamePlaceholder', 'Enter mother name')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.versionIndex', 'Version Index')}
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('motherVersionIndex', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthYear', 'Birth Year')}
                </label>
                <input
                  type="number"
                  {...register('motherBirthYear', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="1965"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthMonth', 'Birth Month')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="12"
                  {...register('motherBirthMonth', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.birthDay', 'Birth Day')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="31"
                  {...register('motherBirthDay', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="12"
                />
              </div>

              <div className="flex items-center">
                <label className="flex items-center space-x-2 mt-6">
                  <input
                    type="checkbox"
                    {...register('motherIsBirthBC')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('addVersion.isBirthBC', 'Birth BC')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('addVersion.metadata', 'Metadata')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.tag', 'Tag')}
                </label>
                <input
                  {...register('tag')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('addVersion.tagPlaceholder', 'Optional tag')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('addVersion.metadataCID', 'Metadata CID')}
                </label>
                <input
                  {...register('metadataCID')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="QmXXX..."
                />
              </div>
            </div>
          </div>

          {/* ZK Proof Upload */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('addVersion.zkProof', 'Zero-Knowledge Proof')}
            </h3>

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6">
              <div className="text-center">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <div className="mt-4">
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
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
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

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !zkProof}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  )
}