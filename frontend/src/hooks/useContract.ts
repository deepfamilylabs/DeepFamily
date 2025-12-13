import { useMemo, useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallet } from '../context/WalletContext'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../components/ToastProvider'
import { useTranslation } from 'react-i18next'
import DeepFamily from '../abi/DeepFamily.json'
import { extractRevertReason, getFriendlyError } from '../lib/errors'

// Groth16 proof type from snarkjs
export type Groth16Proof = {
  pi_a: [string | bigint, string | bigint, string | bigint]
  pi_b: [[string | bigint, string | bigint], [string | bigint, string | bigint], [string | bigint, string | bigint]]
  pi_c: [string | bigint, string | bigint, string | bigint]
  protocol: string
  curve: string
}

// Result type for addPersonZK
export type AddPersonZKResult = {
  hash: string
  index: number
  rewardAmount: number
  transactionHash: string
  blockNumber: number
  events: {
    PersonHashZKVerified: {
      personHash: string
      prover: string
    } | null
    PersonVersionAdded: {
      personHash: string
      versionIndex: number
      addedBy: string
      timestamp: number
      fatherHash: string
      fatherVersionIndex: number
      motherHash: string
      motherVersionIndex: number
      tag: string
    } | null
    TokenRewardDistributed: {
      miner: string
      personHash: string
      versionIndex: number
      reward: string
    } | null
  }
}

// Helper to convert various types to bigint
function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string') {
    if (v.startsWith('0x') || v.startsWith('0X')) return BigInt(v)
    return BigInt(v)
  }
  throw new Error('unsupported type')
}

// Safe stringify for logging BigInt values
function safeStringify(value: any) {
  try {
    return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  } catch {
    return '[unstringifiable]'
  }
}

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
      suppressSubmittedToast?: boolean
      suppressSuccessToast?: boolean
      suppressErrorToast?: boolean
    } = {}
  ) => {
    if (!contract || !signer) {
      toast.show(t('wallet.notConnected', 'Please connect your wallet'))
      return null
    }

    try {

      // Debug wallet and network state
      if (signer && signer.provider) {
        try {
          const network = await signer.provider.getNetwork()
          const signerAddress = await signer.getAddress()
          const balance = await signer.provider.getBalance(signerAddress)
        } catch (walletStateError) {
          console.warn('Failed to get wallet state:', walletStateError)
        }
      }

      // Add a small delay to prevent nonce conflicts with rapid successive transactions
      await new Promise(resolve => setTimeout(resolve, 100))

      // Add timeout for wallet popup interaction (30 seconds)
      const walletTimeout = 30000
      console.log(`⏰ Setting ${walletTimeout/1000}s timeout for wallet confirmation...`)

      const contractPromise = contractMethod()

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('WALLET_POPUP_TIMEOUT: Wallet confirmation timed out. Please check if the wallet popup was closed or hidden.'))
        }, walletTimeout)
      })


      // Add window focus detection to catch when user switches away
      let windowBlurred = false
      const onBlur = () => {
        windowBlurred = true
        console.warn('🔍 Window lost focus - user may have switched to wallet or other app')
      }
      const onFocus = () => {
        if (windowBlurred) {
          windowBlurred = false
        }
      }

      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)

      let tx
      try {
        tx = await Promise.race([contractPromise, timeoutPromise])
      } finally {
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
      }

      if (!options.suppressSubmittedToast) {
        toast.show(t('transaction.submitted', 'Transaction submitted...'))
      }

      const receipt = await tx.wait()

      const successMsg = options.successMessage || t('transaction.success', 'Transaction successful')
      if (!options.suppressSuccessToast) {
        toast.show(successMsg)
      }

      options.onSuccess?.(receipt)
      return receipt
    } catch (error: any) {
      console.error('Transaction failed:', error)

      // Use unified error handling from errors.ts
      const friendly = getFriendlyError(error, t)
      const errorMsg = options.errorMessage 
        ? `${options.errorMessage}: ${friendly.message}`
        : friendly.message

      if (!options.suppressErrorToast) {
        toast.show(errorMsg)
      }

      // Create enhanced error with parsed info
      const enhancedError = {
        ...error,
        parsedMessage: errorMsg,
        customError: friendly.type,
        errorName: friendly.type,
        type: friendly.type,
        details: friendly.details,
        reason: friendly.reason,
        humanMessage: friendly.message
      }

      options.onError?.(enhancedError)

      // Throw enhanced error so calling code can catch it
      throw enhancedError
    }
  }, [contract, signer, toast, t])

  // Contract interaction methods based on actual DeepFamily.sol functions

  /**
   * Add a person version using ZK proof
   * Accepts snarkjs Groth16 proof format and handles conversion internally
   * Includes gas estimation with fallback, staticCall pre-check, and event parsing
   */
  const addPersonZK = useCallback(async (
    proof: Groth16Proof,
    publicSignals: Array<string | number | bigint>,
    fatherVersionIndex: number,
    motherVersionIndex: number,
    tag: string,
    metadataCID: string
  ): Promise<AddPersonZKResult | null> => {
    if (!contract || !signer) {
      toast.show(t('wallet.notConnected', 'Please connect your wallet'))
      return null
    }

    // Validate proof structure
    if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
      throw new Error('Invalid proof structure: missing pi_a, pi_b, or pi_c components')
    }

    if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 3) {
      throw new Error('Invalid proof.pi_a: expected array of length 3')
    }

    if (!Array.isArray(proof.pi_b) || proof.pi_b.length !== 3 || !Array.isArray(proof.pi_b[0]) || !Array.isArray(proof.pi_b[1]) || !Array.isArray(proof.pi_b[2])) {
      throw new Error('Invalid proof.pi_b: expected 3x2 array structure')
    }

    if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 3) {
      throw new Error('Invalid proof.pi_c: expected array of length 3')
    }

    // Validate public signals
    if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
      throw new Error('publicSignals length must be 7')
    }

    const TWO_POW_128 = 1n << 128n
    const TWO_POW_160 = 1n << 160n

    for (let i = 0; i < 6; i++) {
      const limb = toBigInt(publicSignals[i])
      if (limb < 0n || limb >= TWO_POW_128) {
        throw new Error(`publicSignals[${i}] not in [0,2^128)`)
      }
    }

    const submitter = toBigInt(publicSignals[6])
    if (submitter < 0n || submitter >= TWO_POW_160) {
      throw new Error('submitter out of uint160 range')
    }

    // Convert snarkjs format to contract format
    // Take first 2 elements of pi_a and pi_c
    const a = [toBigInt(proof.pi_a[0]), toBigInt(proof.pi_a[1])]
    // Note: snarkjs outputs G2 points as [[bx1, bx2], [by1, by2]] but Solidity verifier expects
    // the pairs in swapped order per limb for bn128 (see common Groth16 mappings)
    const b = [
      [toBigInt(proof.pi_b[0][1]), toBigInt(proof.pi_b[0][0])],
      [toBigInt(proof.pi_b[1][1]), toBigInt(proof.pi_b[1][0])],
    ]
    const c = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])]
    const pub = publicSignals.map(toBigInt)

    const addPersonArgs = [a, b, c, pub, fatherVersionIndex, motherVersionIndex, tag, metadataCID] as const

    // Debug logging

    // Verify submitter matches signer
    const senderAddress = await signer.getAddress()
    const expectedSubmitter = BigInt(senderAddress)

    try {
      let gasLimit: bigint | undefined

      // Try to estimate gas, with fallback to 6.5M if estimation fails
      try {
        const gasEstimate = await contract.addPersonZK.estimateGas(...addPersonArgs)
        gasLimit = gasEstimate * 120n / 100n
      } catch (estimateError: any) {
        console.warn('⚠️ Gas estimation failed, attempting static call and fallback gas limit.', estimateError)
        const decodedReason = extractRevertReason(contract, estimateError)
        if (decodedReason) {
          ;(estimateError as any).__dfDecodedReason = decodedReason
        }

        // Try staticCall to get a better error message
        try {
          await contract.addPersonZK.staticCall(...addPersonArgs)
          gasLimit = 6_500_000n
        } catch (staticError: any) {
          const staticReason = extractRevertReason(contract, staticError)
          if (staticReason) {
            ;(staticError as any).__dfDecodedReason = staticReason
          }
          throw staticError
        }
      }

      const tx = await contract.addPersonZK(...addPersonArgs, gasLimit ? { gasLimit } : {})

      toast.show(t('transaction.submitted', 'Transaction submitted...'))

      // Wait for transaction confirmation
      const receipt = await tx.wait()

      // Parse all events from the transaction receipt
      const events: AddPersonZKResult['events'] = {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        TokenRewardDistributed: null
      }

      let personHash = 'unknown'
      let versionIndex = 0
      let rewardAmount = 0


      for (const log of receipt.logs) {
        try {
          const parsedEvent = contract.interface.parseLog(log)
          if (parsedEvent) {

            switch (parsedEvent.name) {
              case 'PersonHashZKVerified':
                events.PersonHashZKVerified = {
                  personHash: parsedEvent.args.personHash,
                  prover: parsedEvent.args.prover
                }
                break

              case 'PersonVersionAdded':
                events.PersonVersionAdded = {
                  personHash: parsedEvent.args.personHash,
                  versionIndex: Number(parsedEvent.args.versionIndex),
                  addedBy: parsedEvent.args.addedBy,
                  timestamp: Number(parsedEvent.args.timestamp),
                  fatherHash: parsedEvent.args.fatherHash,
                  fatherVersionIndex: Number(parsedEvent.args.fatherVersionIndex),
                  motherHash: parsedEvent.args.motherHash,
                  motherVersionIndex: Number(parsedEvent.args.motherVersionIndex),
                  tag: parsedEvent.args.tag
                }
                personHash = events.PersonVersionAdded.personHash
                versionIndex = events.PersonVersionAdded.versionIndex
                break

              case 'TokenRewardDistributed':
                events.TokenRewardDistributed = {
                  miner: parsedEvent.args.miner,
                  personHash: parsedEvent.args.personHash,
                  versionIndex: Number(parsedEvent.args.versionIndex),
                  reward: parsedEvent.args.reward.toString()
                }
                // Convert from wei to token units (divide by 10^18)
                rewardAmount = Number(parsedEvent.args.reward) / Math.pow(10, 18)
                break
            }
          }
        } catch {
          continue
        }
      }


      // Additional debugging for TokenRewardDistributed
      if (!events.TokenRewardDistributed) {
        if (events.PersonVersionAdded) {
        }
      }

      toast.show(t('contract.addVersionSuccess', 'Person version added successfully'))

      return {
        hash: personHash,
        index: versionIndex,
        rewardAmount,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        events
      }
    } catch (contractError: any) {
      console.error('❌ Contract call failed:', contractError)
      console.error('📋 Full error object:', safeStringify(contractError))
      console.error('📋 Error properties:', {
        code: contractError?.code,
        reason: contractError?.reason,
        data: contractError?.data,
        message: contractError?.message,
        error: contractError?.error,
        transaction: contractError?.transaction
      })

      // Use unified error handling from errors.ts
      const friendly = getFriendlyError(contractError, t)

      console.error('📋 Error analysis:', {
        type: friendly.type,
        message: friendly.message,
        details: friendly.details,
        reason: friendly.reason,
        originalError: contractError
      })

      toast.show(t('contract.addVersionFailed', 'Failed to add person version') + ': ' + friendly.message)

      // Throw enhanced error with additional information
      const enhancedError = new Error(friendly.message)
      ;(enhancedError as any).type = friendly.type
      ;(enhancedError as any).details = friendly.details
      ;(enhancedError as any).originalError = contractError
      ;(enhancedError as any).reason = friendly.reason
      ;(enhancedError as any).humanMessage = friendly.message

      throw enhancedError
    }
  }, [contract, signer, toast, t])

  const mintPersonNFT = useCallback(async (
    proof: {
      a: [bigint, bigint]
      b: [[bigint, bigint], [bigint, bigint]]
      c: [bigint, bigint]
      publicSignals: [bigint, bigint, bigint, bigint, bigint]
    },
    personHash: string,
    versionIndex: number,
    tokenURI: string,
    coreInfo: {
      basicInfo: {
        fullNameCommitment: string
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
    },
    options?: {
      onSuccess?: (result: any) => void
      onError?: (error: any) => void
    }
  ) => {
    return executeTransaction(
      () => contract!.mintPersonNFT(proof.a, proof.b, proof.c, proof.publicSignals, personHash, versionIndex, tokenURI, coreInfo),
      {
        successMessage: t('contract.mintSuccess', 'NFT minted successfully'),
        errorMessage: t('contract.mintFailed', 'Failed to mint NFT'),
        onSuccess: options?.onSuccess,
        onError: options?.onError
      }
    )
  }, [executeTransaction, t, contract])

  const endorseVersion = useCallback(async (
    personHash: string,
    versionIndex: number,
    overrides?: any,
    txOptions?: { suppressToasts?: boolean }
  ) => {
    return executeTransaction(
      async () => {
        // Check if we can call view functions first
        try {
          const testReward = await contract!.DEEP_FAMILY_TOKEN_CONTRACT()
        } catch (connectivityError) {
          console.error('❌ Contract connectivity test failed:', connectivityError)
          throw new Error(`Contract connectivity issue: ${(connectivityError as any)?.message || connectivityError}`)
        }

        if (overrides && Object.keys(overrides).length > 0) {

          // Try to estimate gas first to catch issues early
          try {
            const gasEst = await contract!.endorseVersion.estimateGas(personHash, versionIndex, overrides)
          } catch (gasError) {
            console.error('❌ Gas estimation failed:', gasError)
            // Don't throw here, just log - sometimes gas estimation fails but actual call works
          }

          const result = await contract!.endorseVersion(personHash, versionIndex, overrides)
          return result
        } else {
          const result = await contract!.endorseVersion(personHash, versionIndex)
          return result
        }
      },
      {
        successMessage: t('contract.endorseSuccess', 'Endorsement submitted successfully'),
        errorMessage: t('contract.endorseFailed', 'Failed to endorse version'),
        suppressSubmittedToast: txOptions?.suppressToasts,
        suppressSuccessToast: txOptions?.suppressToasts,
        suppressErrorToast: txOptions?.suppressToasts
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
      console.warn(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  const listVersionEndorsements = useCallback(async (personHash: string, offset: number, pageSize: number) => {
    if (!contract) return null
    
    try {
      const result = await contract.listVersionEndorsements(personHash, offset, pageSize)
      return result
    } catch (error) {
      console.error('Failed to get endorsement stats:', error)
      console.warn(t('contract.queryFailed', 'Failed to query data'))
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
      console.warn(t('contract.queryFailed', 'Failed to query data'))
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
      console.warn(t('contract.queryFailed', 'Failed to query data'))
      return null
    }
  }, [contract, toast, t])

  // Utility functions
  const getPersonHash = useCallback(async (basicInfo: {
    fullNameCommitment: string
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
    listVersionEndorsements,
    getVersionDetails,
    getNFTDetails,
    getPersonHash,
  }
}
