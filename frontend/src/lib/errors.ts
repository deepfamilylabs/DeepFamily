import { TFunction } from 'i18next'

export type FriendlyError = {
  type: string
  message: string
  details: string
  reason?: string
}

// Contract selector -> error name
export const ERROR_SELECTOR_MAP: Record<string, string> = {
  // DeepFamily contract errors (keccak256 selector first 4 bytes)
  '0xe5d242ed': 'InvalidPersonHash',
  '0x1f9510eb': 'InvalidFatherVersionIndex',
  '0x782ce69f': 'InvalidMotherVersionIndex',
  '0xdd4272d0': 'InvalidVersionIndex',
  '0xbf12b9de': 'InvalidFullName',
  '0xbf5672c6': 'InvalidTagLength',
  '0xc0341f60': 'InvalidCIDLength',
  '0xce303472': 'InvalidBirthPlace',
  '0x37698471': 'InvalidDeathPlace',
  '0x0a0a261c': 'InvalidDeathMonth',
  '0x8d177e83': 'InvalidDeathDay',
  '0x918a2912': 'InvalidBirthMonth',
  '0x27aafdf4': 'InvalidBirthDay',
  '0xf8e2f35b': 'InvalidBirthYear',
  '0xf283c519': 'InvalidStory',
  '0x13f04adb': 'InvalidTokenURI',
  '0x076490f6': 'InvalidZKProof',
  '0x5fce01bb': 'VerifierNotSet',
  '0xabd45c1f': 'NameVerifierNotSet',
  '0x2872d6ce': 'DuplicateVersion',
  '0xf0d7613e': 'MustEndorseVersionFirst',
  '0x8051cbca': 'VersionAlreadyMinted',
  '0xbce3d23c': 'BasicInfoMismatch',
  '0xbd8cc731': 'CallerMismatch',
  '0x591c8367': 'InvalidParentHash',
  '0x0e745b7a': 'MustBeAdult',
  '0x9865d99a': 'TokenContractNotSet',
  '0x3f6cc768': 'InvalidTokenId',
  '0xbb43d2ee': 'EndorsementFeeTransferFailed',
  '0x499fddb1': 'ProtocolFeeTooHigh',
  '0x54d92fcb': 'AlreadyEndorsed',
  '0x175f16a1': 'NotEndorsed',
  '0xc9e9ce40': 'PageSizeExceedsLimit',
  '0xaf9f22fb': 'DirectETHNotAccepted',
  '0x1fcb6b91': 'StoryAlreadySealed',
  '0x7df0b861': 'ChunkIndexOutOfRange',
  '0x3be7efcc': 'InvalidChunkContent',
  '0x5b00bc40': 'ChunkHashMismatch',
  '0xfb8cd7ea': 'StoryNotFound',
  '0xdaffd8a5': 'MustBeNFTHolder',
  '0xfb8f41b2': 'ERC20InsufficientAllowance',
  '0x08c379a0': 'Error'
}

// Human-friendly defaults (English) for both contract and generic errors
export const REASON_FRIENDLY_MAP: Record<string, string> = {
  InvalidPersonHash: 'Person hash is invalid for the provided inputs.',
  InvalidFatherVersionIndex: 'Father version index is invalid or missing.',
  InvalidMotherVersionIndex: 'Mother version index is invalid or missing.',
  InvalidVersionIndex: 'Version index is invalid.',
  InvalidFullName: 'Full name does not meet format requirements.',
  InvalidTagLength: 'Tag is too long.',
  InvalidCIDLength: 'Metadata CID is too long.',
  InvalidBirthPlace: 'Birth place is invalid.',
  InvalidDeathPlace: 'Death place is invalid.',
  InvalidDeathMonth: 'Death month is invalid.',
  InvalidDeathDay: 'Death day is invalid.',
  InvalidBirthMonth: 'Birth month is invalid.',
  InvalidBirthDay: 'Birth day is invalid.',
  InvalidBirthYear: 'Birth year is invalid.',
  InvalidStory: 'Story content is invalid.',
  InvalidTokenURI: 'Token URI is invalid.',
  InvalidZKProof: 'Zero-knowledge proof failed verification.',
  VerifierNotSet: 'Verifier contract is not configured.',
  NameVerifierNotSet: 'Name verifier contract is not configured.',
  DuplicateVersion: 'This version already exists on-chain.',
  MustEndorseVersionFirst: 'You must endorse a version before this action.',
  VersionAlreadyMinted: 'Version has already been minted.',
  BasicInfoMismatch: 'Basic information does not match stored version.',
  CallerMismatch: 'Caller address does not match proof submitter.',
  InvalidParentHash: 'Parent hash is invalid.',
  MustBeAdult: 'The person must be an adult to proceed.',
  TokenContractNotSet: 'Token contract is not configured.',
  InvalidTokenId: 'Token ID is invalid.',
  EndorsementFeeTransferFailed: 'Endorsement fee transfer failed.',
  ProtocolFeeTooHigh: 'Protocol fee exceeds allowed limit.',
  AlreadyEndorsed: 'Already endorsed this version.',
  NotEndorsed: 'This version is not endorsed.',
  PageSizeExceedsLimit: 'Page size exceeds limit.',
  DirectETHNotAccepted: 'Direct ETH transfers are not accepted.',
  StoryAlreadySealed: 'Story has already been sealed.',
  ChunkIndexOutOfRange: 'Story chunk index out of range.',
  InvalidChunkContent: 'Story chunk content invalid.',
  ChunkHashMismatch: 'Story chunk hash mismatch.',
  StoryNotFound: 'Story not found.',
  MustBeNFTHolder: 'NFT holder permission required for this action.',
  rejected: 'Transaction was cancelled by user.',
  WALLET_POPUP_TIMEOUT: 'Wallet confirmation timed out. Please try again and make sure to confirm in the wallet popup.',
  REPLACEMENT_UNDERPRICED: 'There is a pending transaction with the same nonce. Please raise gas price/priority fee or wait.',
  GAS_ERROR: 'Gas limit or price too low. Please increase gas and retry.',
  OUT_OF_GAS: 'Transaction ran out of gas during execution.',
  INSUFFICIENT_FUNDS: 'Insufficient balance to cover gas fees.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  USER_REJECTED: 'Transaction was cancelled by user.',
  CALL_EXCEPTION: 'Contract validation failed. Please check input data.',
  ERC20InsufficientAllowance: 'Allowance insufficient. Please re-approve the token allowance.'
}

const normalizeReason = (val?: string) => {
  if (!val) return undefined
  return val.replace(/\(\)$/, '')
}

export const resolveErrorReason = (error: any): string | undefined => {
  const extractSelectorReason = () => {
    const dataFields = [error?.data, error?.error?.data, error?.data?.data, error?.error?.error?.data]
    for (const data of dataFields) {
      if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) continue
      const selector = data.slice(0, 10)
      if (ERROR_SELECTOR_MAP[selector]) return ERROR_SELECTOR_MAP[selector]
    }
    return undefined
  }

  const selectorReason = extractSelectorReason()
  if (selectorReason) return selectorReason

  const directReason = normalizeReason(error?.reason)
  if (directReason) return directReason

  const msg = (error?.message || '') as string

  if (error?.code === 'ACTION_REJECTED' || error?.code === 4001 || /user (rejected|denied)/i.test(msg) || /UserRejected/i.test(msg)) {
    return 'USER_REJECTED'
  }

  if (error?.code === 'REPLACEMENT_UNDERPRICED' || /replacement fee too low/i.test(msg)) {
    return 'REPLACEMENT_UNDERPRICED'
  }

  if (error?.code === 'UNPREDICTABLE_GAS_LIMIT' || /gas/i.test(msg)) {
    return 'GAS_ERROR'
  }

  if (/out of gas/i.test(msg)) {
    return 'OUT_OF_GAS'
  }

  if (/insufficient allowance|ERC20InsufficientAllowance/i.test(msg)) return 'ERC20InsufficientAllowance'
  if (/insufficient funds|ERC20InsufficientBalance/i.test(msg)) return 'INSUFFICIENT_FUNDS'

  // Network errors
  if (error?.code === 'NETWORK_ERROR' || /network/i.test(msg)) {
    return 'NETWORK_ERROR'
  }

  // Wallet popup timeout
  if (/WALLET_POPUP_TIMEOUT/i.test(msg)) {
    return 'WALLET_POPUP_TIMEOUT'
  }

  // General call exception (fallback for contract errors without specific reason)
  if (error?.code === 'CALL_EXCEPTION') {
    return 'CALL_EXCEPTION'
  }

  return undefined
}

// Derive a readable message from various error fields (fallback when no reason)
export const deriveReadableError = (err: any): string | null => {
  const unwrap = (msg: unknown) => (typeof msg === 'string' ? msg.trim() : '')
  const candidates: Array<string | undefined> = [
    err?.parsedMessage,
    err?.shortMessage,
    err?.reason,
    err?.data?.message,
    err?.error?.message,
    err?.info?.error?.message,
    err?.message
  ]

  for (const msg of candidates) {
    const cleaned = unwrap(msg)
    if (cleaned) return cleaned
  }

  const errorName = err?.customError || err?.errorName || err?.data?.errorName || err?.info?.error?.name
  const errorArgs = err?.data?.errorArgs || err?.errorArgs
  if (errorName) {
    const argsStr = Array.isArray(errorArgs) ? `(${errorArgs.join(', ')})` : ''
    return `${errorName}${argsStr}`
  }

  const code = err?.code || err?.error?.code || err?.info?.error?.code
  if (code) return `Error code: ${code}`

  return null
}

export const getFriendlyError = (error: any, t: TFunction): FriendlyError => {
  const reason = resolveErrorReason(error)
  const humanMessage = error?.humanMessage || error?.message
  const derivedRaw = deriveReadableError(error)

  if (reason) {
    const fallback = humanMessage || REASON_FRIENDLY_MAP[reason] || 'Transaction failed.'
    const translated = t(`errors.contractError.${reason}`, fallback)
    const friendly = typeof translated === 'string' ? translated : fallback
    return {
      type: reason,
      message: friendly,
      details: friendly,
      reason
    }
  }

  const unknown = t('errors.unknown', 'Submission failed. Please retry or check your input.')
  const fallbackUnknown = typeof unknown === 'string' ? unknown : 'Submission failed. Please retry or check your input.'
  const details = typeof error?.details === 'string'
    ? error.details
    : String(error?.details ?? derivedRaw ?? error?.message ?? fallbackUnknown)

  return {
    type: error?.type || 'UNKNOWN_ERROR',
    message: fallbackUnknown,
    details
  }
}

// Attempt to extract a revert reason/custom error from a contract error object
export const extractRevertReason = (contract: { interface?: any } | null, rawError: any): string | null => {
  if (!rawError) return null
  if (rawError.__dfDecodedReason) return rawError.__dfDecodedReason

  const directReason = rawError?.reason || rawError?.data?.reason || rawError?.error?.reason
  if (directReason) return directReason

  const dataFields = [rawError?.data, rawError?.error?.data, rawError?.data?.data, rawError?.error?.error?.data]
  for (const data of dataFields) {
    if (typeof data !== 'string') continue
    try {
      const parsedError = contract?.interface?.parseError?.(data)
      if (parsedError) return parsedError.name
    } catch {}

    const selector = data.slice(0, 10)
    if (ERROR_SELECTOR_MAP[selector]) {
      return ERROR_SELECTOR_MAP[selector]
    }
  }

  const messageFields = [rawError?.error?.message, rawError?.shortMessage, rawError?.message]
  for (const msg of messageFields) {
    if (!msg || typeof msg !== 'string') continue
    const match = msg.match(/execution reverted:?\s*(.+)/i)
    if (match?.[1]) return match[1]
  }

  return null
}
