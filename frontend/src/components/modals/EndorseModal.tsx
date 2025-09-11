import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ThumbsUp, Coins, AlertCircle, Users } from 'lucide-react'
import { useContract } from '../../hooks/useContract'
import { useWallet } from '../../context/WalletContext'
import { ethers } from 'ethers'

interface EndorseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  personHash: string
  versionIndex: number
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

  // Load endorsement details when modal opens
  useEffect(() => {
    const loadEndorsementData = async () => {
      if (!isOpen || !address || !contract) return
      
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
        if (getVersionDetails) {
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
  }, [isOpen, address, personHash, versionIndex, getVersionDetails, contract])

  const handleClose = () => {
    setIsSubmitting(false)
    onClose()
  }

  const handleEndorse = async () => {
    if (!address) {
      alert(t('wallet.notConnected', 'Please connect your wallet'))
      return
    }

    if (parseFloat(userDeepBalance) < parseFloat(deepTokenFee)) {
      alert(t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement'))
      return
    }

    setIsSubmitting(true)

    try {
      const result = await endorseVersion(personHash, versionIndex)

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <ThumbsUp className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t('endorse.title', 'Endorse Version')}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          {/* Version Info */}
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
                    <span className="font-medium">{t('endorse.personHash', 'Person Hash')}:</span> {formatAddress(personHash)}
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
                <ThumbsUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  {t('endorse.successMessage', 'You have successfully endorsed this version!')}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleEndorse}
              disabled={isSubmitting || !canAffordEndorsement || hasEndorsed}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                  <ThumbsUp className="w-4 h-4" />
                  {t('endorse.endorse', 'Endorse')} ({deepTokenFee} DEEP)
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}