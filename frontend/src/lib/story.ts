import { ethers, Contract, type JsonRpcSigner } from 'ethers'
import DeepFamilyAbi from '../abi/DeepFamily.json'
import type { StoryChunk } from '../types/graph'

const WALLET_CONFIRMATION_TIMEOUT_MS = 30000

export function computeStoryHash(chunks: StoryChunk[]): string {
  if (!chunks || chunks.length === 0) return ethers.ZeroHash
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  let accumulator = ethers.ZeroHash
  for (const chunk of sorted) {
    accumulator = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'uint256', 'bytes32'],
        [accumulator, BigInt(chunk.chunkIndex), chunk.chunkHash]
      )
    )
  }
  return accumulator
}

/**
 * Result from adding a story chunk
 */
export interface AddStoryChunkResult {
  chunkIndex: number
  contentLength: number
  transactionHash: string
  blockNumber: number
  newChunk: StoryChunk  // Return complete chunk data for immediate UI update
  events: {
    StoryChunkAdded: {
      tokenId: string
      chunkIndex: number
      contentLength: number
      chunkHash: string
      editor: string
    } | null
  }
}

/**
 * Result from sealing a story
 */
export interface SealStoryResult {
  totalChunks: number
  fullStoryHash: string
  transactionHash: string
  blockNumber: number
  events: {
    StorySealed: {
      tokenId: string
      totalChunks: number
      fullStoryHash: string
      sealer: string
    } | null
  }
}

/**
 * Add a story chunk to an NFT
 */
export async function addStoryChunk(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
  chunkIndex: number,
  content: string,
  expectedHash: string
): Promise<AddStoryChunkResult> {
  const contract = new Contract(contractAddress, DeepFamilyAbi.abi, signer)

  try {
    console.log('🚀 Adding story chunk...')
    console.log('  Token ID:', tokenId)
    console.log('  Chunk Index:', chunkIndex)
    console.log('  Content Length:', content.length)
    console.log('  Expected Hash:', expectedHash)

    // Send transaction (with wallet confirmation timeout)
    const tx = await withWalletConfirmationTimeout(
      () => contract.addStoryChunk(tokenId, chunkIndex, content, expectedHash || ethers.ZeroHash),
      'addStoryChunk'
    )
    console.log('✅ Transaction sent:', tx.hash)

    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...')
    const receipt = await tx.wait()
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

    // Parse events
    const events = {
      StoryChunkAdded: null as any
    }

    let parsedChunkIndex = chunkIndex
    let parsedContentLength = content.length

    console.log(`🔍 Parsing ${receipt.logs.length} logs...`)

    for (const log of receipt.logs) {
      try {
        const parsedEvent = contract.interface.parseLog(log)
        if (parsedEvent) {
          console.log(`📊 Event detected: ${parsedEvent.name}`)

          if (parsedEvent.name === 'StoryChunkAdded') {
            events.StoryChunkAdded = {
              tokenId: parsedEvent.args.tokenId.toString(),
              chunkIndex: Number(parsedEvent.args.chunkIndex),
              contentLength: Number(parsedEvent.args.contentLength),
              chunkHash: parsedEvent.args.chunkHash,
              editor: parsedEvent.args.editor
            }
            parsedChunkIndex = events.StoryChunkAdded.chunkIndex
            parsedContentLength = events.StoryChunkAdded.contentLength
            console.log('✅ StoryChunkAdded event parsed:', events.StoryChunkAdded)
          }
        }
      } catch (error) {
        console.log('🔍 Unparseable log:', log.topics)
        continue
      }
    }

    // Build new chunk data for immediate UI update
    const newChunk: StoryChunk = {
      chunkIndex: parsedChunkIndex,
      chunkHash: events.StoryChunkAdded?.chunkHash || ethers.keccak256(ethers.toUtf8Bytes(content)),
      content: content,
      timestamp: Math.floor(Date.now() / 1000), // Use current time as approximation
      editor: events.StoryChunkAdded?.editor || await signer.getAddress()
    }

    return {
      chunkIndex: parsedChunkIndex,
      contentLength: parsedContentLength,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      newChunk,
      events
    }
  } catch (error: any) {
    console.error('❌ Add story chunk failed:', error)
    throw parseStoryContractError(error, contract)
  }
}

/**
 * Seal a story to make it immutable
 */
export async function sealStory(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string
): Promise<SealStoryResult> {
  const contract = new Contract(contractAddress, DeepFamilyAbi.abi, signer)

  try {
    console.log('🚀 Sealing story...')
    console.log('  Token ID:', tokenId)

    // Send transaction (with wallet confirmation timeout)
    const tx = await withWalletConfirmationTimeout(
      () => contract.sealStory(tokenId),
      'sealStory'
    )
    console.log('✅ Transaction sent:', tx.hash)

    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...')
    const receipt = await tx.wait()
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

    // Parse events
    const events = {
      StorySealed: null as any
    }

    let parsedTotalChunks = 0
    let parsedFullStoryHash = ethers.ZeroHash

    console.log(`🔍 Parsing ${receipt.logs.length} logs...`)

    for (const log of receipt.logs) {
      try {
        const parsedEvent = contract.interface.parseLog(log)
        if (parsedEvent) {
          console.log(`📊 Event detected: ${parsedEvent.name}`)

          if (parsedEvent.name === 'StorySealed') {
            events.StorySealed = {
              tokenId: parsedEvent.args.tokenId.toString(),
              totalChunks: Number(parsedEvent.args.totalChunks),
              fullStoryHash: parsedEvent.args.fullStoryHash,
              sealer: parsedEvent.args.sealer
            }
            parsedTotalChunks = events.StorySealed.totalChunks
            parsedFullStoryHash = events.StorySealed.fullStoryHash
            console.log('✅ StorySealed event parsed:', events.StorySealed)
          }
        }
      } catch (error) {
        console.log('🔍 Unparseable log:', log.topics)
        continue
      }
    }

    return {
      totalChunks: parsedTotalChunks,
      fullStoryHash: parsedFullStoryHash,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      events
    }
  } catch (error: any) {
    console.error('❌ Seal story failed:', error)
    throw parseStoryContractError(error, contract)
  }
}

/**
 * Parse contract errors into user-friendly messages
 */
function parseStoryContractError(error: any, contract: Contract): Error {
  console.error('[Story] Contract error:', error)

  if (error?.code === 'WALLET_POPUP_TIMEOUT' || error?.type === 'WALLET_POPUP_TIMEOUT' || typeof error?.message === 'string' && /wallet confirmation timed out/i.test(error.message)) {
    const err = new Error('Wallet confirmation timed out. Please reopen your wallet and confirm the transaction.')
    ;(err as any).type = 'WALLET_POPUP_TIMEOUT'
    ;(err as any).code = 'WALLET_POPUP_TIMEOUT'
    return err
  }

  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') {
    const err = new Error('Transaction was rejected by user')
    ;(err as any).type = 'USER_REJECTED'
    ;(err as any).code = 'USER_REJECTED'
    return err
  }

  if (error?.code === -32002 || (typeof error?.message === 'string' && /request (?:is )?already pending/i.test(error.message))) {
    const err = new Error('Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.')
    ;(err as any).type = 'WALLET_REQUEST_PENDING'
    ;(err as any).code = 'WALLET_REQUEST_PENDING'
    return err
  }

  // Check for custom errors in the error data
  if (error?.data && typeof error.data === 'string') {
    // Common custom error selectors
    const customErrors: Record<string, string> = {
      '0xdaffd8a5': 'MustBeNFTHolder',
      '0x82b42900': 'Unauthorized',
      '0x3ee5aeb5': 'OnlyOwner',
      '0x579b9c8a': 'StorySealed',
      '0x6512e97e': 'ChunkIndexExists',
      '0x766e8709': 'InvalidChunkIndex',
      '0x7b51ba7e': 'ContentTooLong',
      '0x9b9623c8': 'ExpectedHashMismatch',
      '0x5b00bc40': 'ChunkHashMismatch',
      '0x7df0b861': 'ChunkIndexOutOfRange',
    }

    const errorSelector = error.data.slice(0, 10)
    const customError = customErrors[errorSelector]

    if (customError) {
      const err = new Error(getErrorMessage(customError))
      ;(err as any).type = customError
      return err
    }
  }

  // Check for standard error messages
  if (error?.message) {
    if (error.message.includes('execution reverted')) {
      // Try to extract custom error from message
      const customErrorMatch = error.message.match(/custom error '(\w+)'/)
      if (customErrorMatch) {
        const customError = customErrorMatch[1]
        const err = new Error(getErrorMessage(customError))
        ;(err as any).type = customError
        return err
      }
      const err = new Error('Transaction failed: execution reverted')
      ;(err as any).type = 'EXECUTION_REVERTED'
      return err
    }

    if (error.message.includes('user rejected')) {
      const err = new Error('Transaction was rejected by user')
      ;(err as any).type = 'USER_REJECTED'
      return err
    }

    if (error.message.includes('insufficient funds')) {
      const err = new Error('Insufficient funds for gas')
      ;(err as any).type = 'INSUFFICIENT_FUNDS'
      return err
    }
  }

  // Fallback to original error message or generic error
  const err = new Error(error?.message || 'An unknown error occurred')
  ;(err as any).type = 'UNKNOWN_ERROR'
  return err
}

/**
 * Get user-friendly error message for custom error names
 */
function getErrorMessage(errorName: string): string {
  const messages: Record<string, string> = {
    MustBeNFTHolder: 'You must own this NFT to edit its story',
    Unauthorized: 'Not authorized to perform this action',
    OnlyOwner: 'Only the owner can perform this action',
    StorySealed: 'Story is sealed and cannot be modified',
    ChunkIndexExists: 'Chunk at this index already exists',
    InvalidChunkIndex: 'Invalid chunk index',
    ContentTooLong: 'Content exceeds maximum length',
    ExpectedHashMismatch: 'Expected hash does not match',
    ChunkHashMismatch: 'Chunk content does not match expected hash',
    ChunkIndexOutOfRange: 'Chunk index is out of valid range'
  }

  return messages[errorName] || `Contract error: ${errorName}`
}

/**
 * Apply a timeout while waiting for the wallet confirmation step.
 * Prevents the UI from hanging indefinitely when Fluent hides the popup.
 */
async function withWalletConfirmationTimeout<T>(
  sendTx: () => Promise<T>,
  action: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutError = new Error('Wallet confirmation timed out. Please reopen your wallet and confirm the transaction.')
  ;(timeoutError as any).type = 'WALLET_POPUP_TIMEOUT'
  ;(timeoutError as any).code = 'WALLET_POPUP_TIMEOUT'
  ;(timeoutError as any).action = action

  console.log(`[Wallet] Awaiting confirmation for ${action}...`)

  const txPromise = sendTx()
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError), WALLET_CONFIRMATION_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([txPromise, timeoutPromise])
    if (timeoutId) clearTimeout(timeoutId)
    return result
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    // Avoid unhandled rejections if the original txPromise resolves later
    if (err === timeoutError) {
      console.warn(`[Wallet] Confirmation timeout exceeded (${WALLET_CONFIRMATION_TIMEOUT_MS}ms) for ${action}`)
      txPromise.catch(() => {})
    }
    throw err
  }
}
