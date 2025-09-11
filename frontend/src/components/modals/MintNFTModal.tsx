import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X, Coins, AlertCircle, Image } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'

const mintNFTSchema = z.object({
  // PersonBasicInfo (will be filled automatically from version data)
  gender: z.number().min(0).max(3),
  birthYear: z.number().min(0).max(9999),
  birthMonth: z.number().min(0).max(12),
  birthDay: z.number().min(0).max(31),
  isBirthBC: z.boolean(),
  
  // PersonSupplementInfo
  fullName: z.string().min(1, 'Full name is required').max(100, 'Name too long'),
  birthPlace: z.string().max(200, 'Birth place too long'),
  isDeathBC: z.boolean(),
  deathYear: z.number().min(0).max(9999),
  deathMonth: z.number().min(0).max(12),
  deathDay: z.number().min(0).max(31),
  deathPlace: z.string().max(200, 'Death place too long'),
  story: z.string().max(1000, 'Story too long'),
  
  // NFT Metadata
  tokenURI: z.string().url('Invalid URL').optional().or(z.literal(''))
})

type MintNFTForm = z.infer<typeof mintNFTSchema>

interface MintNFTModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (tokenId: number) => void
  personHash: string
  versionIndex: number
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
  versionData
}: MintNFTModalProps) {
  const { t } = useTranslation()
  const { address } = useWallet()
  const { mintPersonNFT, getVersionDetails } = useContract()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEndorsed, setIsEndorsed] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue
  } = useForm<MintNFTForm>({
    resolver: zodResolver(mintNFTSchema),
    defaultValues: {
      // PersonBasicInfo
      gender: versionData?.gender || 0,
      birthYear: versionData?.birthYear || 0,
      birthMonth: versionData?.birthMonth || 0,
      birthDay: versionData?.birthDay || 0,
      isBirthBC: versionData?.isBirthBC || false,
      
      // PersonSupplementInfo
      fullName: versionData?.fullName || '',
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

  // Check if user has endorsed this version
  useEffect(() => {
    const checkEndorsement = async () => {
      if (!address || !getVersionDetails) return
      
      try {
        const details = await getVersionDetails(personHash, versionIndex)
        // This would need to be implemented in the contract to check if current user endorsed
        // For now, we assume they need to endorse first
        setIsEndorsed(false)
      } catch (error) {
        console.error('Failed to check endorsement:', error)
      }
    }

    if (isOpen) {
      checkEndorsement()
    }
  }, [isOpen, address, personHash, versionIndex, getVersionDetails])

  const handleClose = () => {
    reset()
    setIsSubmitting(false)
    onClose()
  }

  const onSubmit = async (data: MintNFTForm) => {
    if (!address) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    setIsSubmitting(true)

    try {
      // Construct PersonCoreInfo object matching the contract structure
      const coreInfo = {
        // PersonBasicInfo - hash is computed from fullName
        fullNameHash: ethers.keccak256(ethers.toUtf8Bytes(data.fullName)),
        isBirthBC: data.isBirthBC,
        birthYear: data.birthYear,
        birthMonth: data.birthMonth,
        birthDay: data.birthDay,
        gender: data.gender,
        
        // PersonSupplementInfo - fullName is stored as string here
        fullName: data.fullName,
        birthPlace: data.birthPlace,
        isDeathBC: data.isDeathBC,
        deathYear: data.deathYear,
        deathMonth: data.deathMonth,
        deathDay: data.deathDay,
        deathPlace: data.deathPlace,
        story: data.story
      }

      const result = await mintPersonNFT(
        personHash,
        versionIndex,
        data.tokenURI || '',
        coreInfo
      )

      if (result) {
        // Extract token ID from transaction receipt if available
        const tokenId = 1 // This would need to be extracted from the transaction logs
        onSuccess?.(tokenId)
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Image className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t('mintNFT.title', 'Mint NFT')}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-700">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {t('mintNFT.requirement', 'Endorsement Required')}
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                {t('mintNFT.requirementDesc', 'You must endorse this version before minting an NFT.')}
              </p>
              <div className="mt-2 text-sm text-blue-600 dark:text-blue-300">
                <span className="font-medium">{t('mintNFT.personHash', 'Person Hash')}:</span> {personHash.slice(0, 20)}...
                <br />
                <span className="font-medium">{t('mintNFT.versionIndex', 'Version')}:</span> {versionIndex}
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          
          {/* Basic Information (from PersonBasicInfo) */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('mintNFT.basicInfo', 'Basic Information')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.gender', 'Gender')}
                </label>
                <select
                  {...register('gender', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                >
                  <option value={0}>{t('mintNFT.genderUnknown', 'Unknown')}</option>
                  <option value={1}>{t('mintNFT.genderMale', 'Male')}</option>
                  <option value={2}>{t('mintNFT.genderFemale', 'Female')}</option>
                  <option value={3}>{t('mintNFT.genderOther', 'Other')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.birthYear', 'Birth Year')}
                </label>
                <input
                  type="number"
                  {...register('birthYear', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.birthMonth', 'Birth Month')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="12"
                  {...register('birthMonth', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.birthDay', 'Birth Day')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="31"
                  {...register('birthDay', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    {...register('isBirthBC')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('mintNFT.isBirthBC', 'Birth BC')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Supplemental Information (from PersonSupplementInfo) */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('mintNFT.supplementalInfo', 'Supplemental Information')}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('mintNFT.fullName', 'Full Name')} *
              </label>
              <input
                {...register('fullName')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                placeholder={t('mintNFT.fullNamePlaceholder', 'Enter full name')}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('mintNFT.fullNameNote', 'This will be stored as both fullName and fullNameHash')}
              </p>
              {errors.fullName && (
                <p className="mt-1 text-sm text-red-600">{errors.fullName.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.birthPlace', 'Birth Place')}
                </label>
                <input
                  {...register('birthPlace')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('mintNFT.birthPlacePlaceholder', 'Enter birth place')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.deathPlace', 'Death Place')}
                </label>
                <input
                  {...register('deathPlace')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder={t('mintNFT.deathPlacePlaceholder', 'Enter death place (if applicable)')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('mintNFT.deathYear', 'Death Year')}
                </label>
                <input
                  type="number"
                  {...register('deathYear', { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                  placeholder="0 if still alive"
                />
              </div>

              <div>
                <label className="flex items-center space-x-2 mt-6">
                  <input
                    type="checkbox"
                    {...register('isDeathBC')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('mintNFT.isDeathBC', 'Death BC')}
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('mintNFT.story', 'Life Story Summary')}
              </label>
              <textarea
                {...register('story')}
                rows={4}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                placeholder={t('mintNFT.storyPlaceholder', 'Enter a brief life story summary...')}
              />
              {errors.story && (
                <p className="mt-1 text-sm text-red-600">{errors.story.message}</p>
              )}
            </div>
          </div>

          {/* NFT Metadata */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('mintNFT.metadata', 'NFT Metadata')}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('mintNFT.tokenURI', 'Token URI')}
              </label>
              <input
                {...register('tokenURI')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100"
                placeholder="https://... or ipfs://..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('mintNFT.tokenURIHint', 'Optional: URL or IPFS hash for NFT metadata')}
              </p>
              {errors.tokenURI && (
                <p className="mt-1 text-sm text-red-600">{errors.tokenURI.message}</p>
              )}
            </div>
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
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 
                t('mintNFT.minting', 'Minting...') :
                t('mintNFT.mint', 'Mint NFT')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}