import { useMemo, useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallet } from '../context/WalletContext'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../components/ToastProvider'
import { useTranslation } from 'react-i18next'
import DeepFamily from '../abi/DeepFamily.json'

export function useContract() {
  const { signer, provider } = useWallet()
  const { contractAddress } = useConfig()
  const toast = useToast()
  const { t } = useTranslation()

  const contract = useMemo(() => {
    if (!contractAddress) return null
    
    if (signer) {
      // Write operations with signer
      return new ethers.Contract(contractAddress, DeepFamily.abi, signer)
    } else if (provider) {
      // Read-only operations with provider
      return new ethers.Contract(contractAddress, DeepFamily.abi, provider)
    }
    
    return null
  }, [contractAddress, signer, provider])

  const executeTransaction = useCallback(async (
    contractMethod: () => Promise<any>,
    options: {
      onSuccess?: (result: any) => void
      onError?: (error: any) => void
      successMessage?: string
      errorMessage?: string
    } = {}
  ) => {
    if (!contract || !signer) {
      toast.show(t('wallet.notConnected', 'Please connect your wallet'))
      return null
    }

    try {
      const tx = await contractMethod()
      
      toast.show(t('transaction.submitted', 'Transaction submitted...'))
      const receipt = await tx.wait()

      const successMsg = options.successMessage || t('transaction.success', 'Transaction successful')
      toast.show(successMsg)
      
      options.onSuccess?.(receipt)
      return receipt
    } catch (error: any) {
      console.error('Transaction failed:', error)
      
      let errorMsg = options.errorMessage || t('transaction.failed', 'Transaction failed')
      
      // Parse specific error messages
      const nestedMsg = error?.shortMessage || error?.info?.error?.message || error?.data?.message || error?.error?.message
      const errorName = error?.errorName || error?.info?.error?.name
      const baseMsg = error?.message || ''
      if (errorName) {
        // Map known custom errors to friendly text
        const name = String(errorName)
        if (/InvalidPersonHash|InvalidVersionIndex/.test(name)) {
          errorMsg = t('endorse.invalidTarget', 'Invalid person hash or version index')
        } else if (/EndorsementFeeTransferFailed|ERC20InsufficientAllowance/.test(name)) {
          errorMsg = t('endorse.needApprove', 'Allowance too low, please approve DEEP tokens again')
        } else if (/ERC20InsufficientBalance/.test(name)) {
          errorMsg = t('endorse.insufficientDeepTokens', 'Insufficient DEEP tokens for endorsement')
        } else {
          errorMsg = name
        }
      } else if (nestedMsg) {
        errorMsg = nestedMsg
      } else if (baseMsg) {
        if (baseMsg.includes('user rejected') || baseMsg.includes('ACTION_REJECTED')) {
          errorMsg = t('transaction.rejected', 'Transaction rejected by user')
        } else if (baseMsg.includes('insufficient funds')) {
          errorMsg = t('transaction.insufficientFunds', 'Insufficient funds')
        } else {
          errorMsg = baseMsg
        }
      }
      
      toast.show(errorMsg)
      options.onError?.(error)
      return null
    }
  }, [contract, signer, toast, t])

  // Contract interaction methods based on actual DeepFamily.sol functions

  const addPersonZK = useCallback(async (
    a: [bigint, bigint],
    b: [[bigint, bigint], [bigint, bigint]],
    c: [bigint, bigint],
    publicSignals: bigint[],
    fatherVersionIndex: bigint,
    motherVersionIndex: bigint,
    tag: string,
    metadataCID: string
  ) => {
    return executeTransaction(
      () => contract!.addPersonZK(a, b, c, publicSignals, fatherVersionIndex, motherVersionIndex, tag, metadataCID),
      {
        successMessage: t('contract.addVersionSuccess', 'Person version added successfully'),
        errorMessage: t('contract.addVersionFailed', 'Failed to add person version')
      }
    )
  }, [executeTransaction, t, contract])

  const mintPersonNFT = useCallback(async (
    personHash: string,
    versionIndex: number,
    tokenURI: string,
    coreInfo: {
      basicInfo: {
        fullNameHash: string
        isBirthBC: boolean
        birthYear: number
        birthMonth: number
        birthDay: number
        gender: number
      }
      supplementInfo: {
        fullName: string
        birthPlace: string
        isDeathBC: boolean
        deathYear: number
        deathMonth: number
        deathDay: number
        deathPlace: string
        story: string
      }
    }
  ) => {
    return executeTransaction(
      () => contract!.mintPersonNFT(personHash, versionIndex, tokenURI, coreInfo),
      {
        successMessage: t('contract.mintSuccess', 'NFT minted successfully'),
        errorMessage: t('contract.mintFailed', 'Failed to mint NFT')
      }
    )
  }, [executeTransaction, t, contract])

  const endorseVersion = useCallback(async (
    personHash: string,
    versionIndex: number,
    overrides?: any
  ) => {
    return executeTransaction(
      () => contract!.endorseVersion(personHash, versionIndex, overrides ?? {}),
      {
        successMessage: t('contract.endorseSuccess', 'Endorsement submitted successfully'),
        errorMessage: t('contract.endorseFailed', 'Failed to endorse version')
      }
    )
  }, [executeTransaction, t, contract])

  // Read methods (no transaction required) - based on SearchPage usage
  const listPersonVersions = useCallback(async (personHash: string, offset: number, pageSize: number) => {
    if (!contract) return null
    
    try {
      const result = await contract.listPersonVersions(personHash, offset, pageSize)
      return result
    } catch (error) {
      console.error('Failed to list person versions:', error)
      toast.show(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  const listVersionsEndorsementStats = useCallback(async (personHash: string, offset: number, pageSize: number) => {
    if (!contract) return null
    
    try {
      const result = await contract.listVersionsEndorsementStats(personHash, offset, pageSize)
      return result
    } catch (error) {
      console.error('Failed to get endorsement stats:', error)
      toast.show(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  const getVersionDetails = useCallback(async (personHash: string, versionIndex: number) => {
    if (!contract) return null
    
    try {
      const result = await contract.getVersionDetails(personHash, versionIndex)
      return result
    } catch (error) {
      console.error('Failed to get version details:', error)
      toast.show(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  const getNFTDetails = useCallback(async (tokenId: number) => {
    if (!contract) return null
    
    try {
      const result = await contract.getNFTDetails(tokenId)
      return result
    } catch (error) {
      console.error('Failed to get NFT details:', error)
      toast.show(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  // Utility functions
  const getPersonHash = useCallback(async (basicInfo: {
    fullNameHash: string
    isBirthBC: boolean
    birthYear: number
    birthMonth: number
    birthDay: number
    gender: number
  }) => {
    if (!contract) return null
    
    try {
      const result = await contract.getPersonHash(basicInfo)
      return result
    } catch (error) {
      console.error('Failed to get person hash:', error)
      return null
    }
  }, [contract])

  const getFullNameHash = useCallback(async (fullName: string) => {
    if (!contract) return null
    
    try {
      const result = await contract.getFullNameHash(fullName)
      return result
    } catch (error) {
      console.error('Failed to get full name hash:', error)
      return null
    }
  }, [contract])

  return {
    contract,
    isContractReady: !!contract && !!signer,
    executeTransaction,
    
    // Write methods
    addPersonZK,
    mintPersonNFT,
    endorseVersion,
    
    // Read methods
    listPersonVersions,
    listVersionsEndorsementStats,
    getVersionDetails,
    getNFTDetails,
    getPersonHash,
    getFullNameHash
  }
}