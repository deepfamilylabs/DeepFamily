import type { TFunction } from "i18next";

type SafeLogValue = string | number | boolean | null;

export type FriendlyError = {
  type: string;
  message: string;
  details: string;
  reason?: string;
  code?: SafeLogValue;
  retryable?: boolean;
};

export type SafeLogError = {
  name?: string;
  message?: string;
  shortMessage?: string;
  code?: SafeLogValue;
  reason?: string;
  stack?: string;
};

const truncate = (value: string, maxLen: number) => {
  if (!value) return value;
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "…";
};

const MAX_ERROR_DETAILS_LENGTH = 1200;
const MAX_NESTED_STRING_COUNT = 80;
const MAX_NESTED_DEPTH = 6;
const MAX_OBJECT_KEYS_PER_LEVEL = 30;
const MAX_COLLECTED_STRING_LENGTH = 4096;

const STANDARD_ERROR_SELECTOR = "0x08c379a0";
const STANDARD_PANIC_SELECTOR = "0x4e487b71";

/**
 * Return a minimal, whitelisted error shape safe for console logging.
 * Avoids leaking large nested objects that may contain sensitive UI state.
 */
export const sanitizeErrorForLogging = (error: any): SafeLogError => {
  if (error == null) return { message: String(error) };
  if (typeof error === "string") return { message: truncate(error, 500) };
  if (typeof error === "number" || typeof error === "boolean") return { message: String(error) };

  const name = typeof error?.name === "string" ? truncate(error.name, 120) : undefined;
  const message = typeof error?.message === "string" ? truncate(error.message, 800) : undefined;
  const shortMessage =
    typeof error?.shortMessage === "string" ? truncate(error.shortMessage, 800) : undefined;
  const reason = typeof error?.reason === "string" ? truncate(error.reason, 200) : undefined;

  const codeRaw = error?.code;
  const code: SafeLogValue =
    typeof codeRaw === "string" || typeof codeRaw === "number" || typeof codeRaw === "boolean"
      ? codeRaw
      : null;

  const stack = typeof error?.stack === "string" ? truncate(error.stack, 2000) : undefined;

  return { name, message, shortMessage, code, reason, stack };
};

const getPrimaryErrorCode = (error: any): SafeLogValue | undefined => {
  const candidates = [
    error?.code,
    error?.error?.code,
    error?.info?.error?.code,
    error?.cause?.code,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
  }
  return undefined;
};

const toSafeDebugValue = (value: unknown): SafeLogValue => {
  if (value == null) return null;
  if (typeof value === "string") return truncate(value, 400);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
};

const getNestedOwnValue = (value: unknown, path: string[]): unknown => {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    const obj = current as object;
    if (!Object.getOwnPropertyNames(obj).includes(segment)) return undefined;
    try {
      current = (obj as Record<string, unknown>)[segment];
    } catch {
      return undefined;
    }
  }
  return current;
};

export const summarizeErrorForDev = (error: any): Record<string, SafeLogValue | string[]> => {
  const summary: Record<string, SafeLogValue | string[]> = {
    ...sanitizeErrorForLogging(error),
  };

  if (error && typeof error === "object") {
    summary.rootKeys = Object.getOwnPropertyNames(error).slice(0, 20);
  }

  const interestingPaths = [
    ["data"],
    ["data", "message"],
    ["data", "data"],
    ["error"],
    ["error", "code"],
    ["error", "message"],
    ["error", "data"],
    ["error", "data", "message"],
    ["error", "data", "data"],
    ["info"],
    ["info", "error"],
    ["info", "error", "code"],
    ["info", "error", "message"],
    ["info", "error", "data"],
    ["info", "error", "data", "message"],
    ["info", "error", "data", "data"],
    ["shortMessage"],
  ];

  for (const path of interestingPaths) {
    const value = getNestedOwnValue(error, path);
    const safeValue = toSafeDebugValue(value);
    if (safeValue != null) {
      summary[path.join(".")] = safeValue;
      continue;
    }

    if (value && typeof value === "object") {
      summary[`${path.join(".")}.__keys`] = Object.getOwnPropertyNames(value).slice(0, 20);
    }
  }

  return summary;
};

export const formatErrorSummaryForDev = (error: any): string => {
  try {
    return JSON.stringify(summarizeErrorForDev(error), null, 2);
  } catch {
    return JSON.stringify(sanitizeErrorForLogging(error), null, 2);
  }
};

// Contract selector -> error name
export const ERROR_SELECTOR_MAP: Record<string, string> = {
  // DeepFamily contract errors (keccak256 selector first 4 bytes)
  "0xe5d242ed": "InvalidPersonHash",
  "0x1f9510eb": "InvalidFatherVersionIndex",
  "0x782ce69f": "InvalidMotherVersionIndex",
  "0xdd4272d0": "InvalidVersionIndex",
  "0xbf12b9de": "InvalidFullName",
  "0xbf5672c6": "InvalidTagLength",
  "0xc0341f60": "InvalidCIDLength",
  "0xce303472": "InvalidBirthPlace",
  "0x37698471": "InvalidDeathPlace",
  "0x0a0a261c": "InvalidDeathMonth",
  "0x8d177e83": "InvalidDeathDay",
  "0x918a2912": "InvalidBirthMonth",
  "0x27aafdf4": "InvalidBirthDay",
  "0xf8e2f35b": "InvalidBirthYear",
  "0xf283c519": "InvalidStory",
  "0x13f04adb": "InvalidTokenURI",
  "0x076490f6": "InvalidZKProof",
  "0x10c40e8c": "InvalidVerifierAddress",
  "0x7b49acb9": "InvalidAttestationRegistry",
  "0x1c449cf3": "InvalidDeepFamilyAddress",
  "0xf50c0ccc": "DeepFamilyAlreadyBound",
  "0x455eb246": "OnlyDeepFamily",
  "0x98dce1a9": "VerifierRouteNotSet",
  "0xc5556b05": "UnsupportedProofEncoding",
  "0x67610d0b": "MalformedProofData",
  "0xdd90c870": "UnsupportedPurpose",
  "0xd320a69c": "InvalidAttestationRefVersion",
  "0xc93cfd0e": "InvalidAttestationSubject",
  "0x1c9e8fa4": "InvalidAttestationAction",
  "0xfd6dd1e8": "InvalidAttestationPayloadDigest",
  "0xdf898f55": "InvalidAttestationSignatureSuite",
  "0x855cd736": "InvalidAttestationSignerKey",
  "0x62f958e5": "InvalidAttestationURI",
  "0x21672418": "InvalidAttestationIssuedAt",
  "0x5bca1dbe": "InvalidAttestationExpiresAt",
  "0x51d2baff": "InvalidAttestationRevocation",
  "0x7137314d": "DuplicateAttestationReference",
  "0x2872d6ce": "DuplicateVersion",
  "0x349cbe19": "InvalidTrustedEndorser",
  "0x25f05b56": "TrustedEndorserAlreadyAdded",
  "0x6580f338": "TrustedEndorserNotFound",
  "0x36e7a56e": "MustBeVersionContributor",
  "0xf0d7613e": "MustEndorseVersionFirst",
  "0x8051cbca": "VersionAlreadyMinted",
  "0xbce3d23c": "BasicInfoMismatch",
  "0xbd8cc731": "CallerMismatch",
  "0x591c8367": "InvalidParentHash",
  "0x0e745b7a": "MustBeAdult",
  "0x9865d99a": "TokenContractNotSet",
  "0x9996b315": "AddressEmptyCode",
  "0x4c9c8ce3": "ERC1967InvalidImplementation",
  "0xb398979f": "ERC1967NonPayable",
  "0xd6bda275": "FailedCall",
  "0xf92ee8a9": "InvalidInitialization",
  "0xd7e6bcf8": "NotInitializing",
  "0xe07c8dba": "UUPSUnauthorizedCallContext",
  "0xaa1d49a4": "UUPSUnsupportedProxiableUUID",
  "0x7e273289": "ERC721NonexistentToken",
  "0x59171fc1": "ERC721EnumerableForbiddenBatchMint",
  "0x64283d7b": "ERC721IncorrectOwner",
  "0x177e802f": "ERC721InsufficientApproval",
  "0xa9fbf51f": "ERC721InvalidApprover",
  "0x5b08ba18": "ERC721InvalidOperator",
  "0x89c62b64": "ERC721InvalidOwner",
  "0x64a0ae92": "ERC721InvalidReceiver",
  "0x73c6ac6e": "ERC721InvalidSender",
  "0xa57d13dc": "ERC721OutOfBoundsIndex",
  "0x1e4fbdf7": "OwnableInvalidOwner",
  "0x118cdaa7": "OwnableUnauthorizedAccount",
  "0x3ee5aeb5": "ReentrancyGuardReentrantCall",
  "0xbb43d2ee": "EndorsementFeeTransferFailed",
  "0x499fddb1": "ProtocolFeeTooHigh",
  "0x54d92fcb": "AlreadyEndorsed",
  "0x175f16a1": "NotEndorsed",
  "0xc9e9ce40": "PageSizeExceedsLimit",
  "0xaf9f22fb": "DirectETHNotAccepted",
  "0x1fcb6b91": "StoryAlreadySealed",
  "0x7df0b861": "ChunkIndexOutOfRange",
  "0x3be7efcc": "InvalidChunkContent",
  "0x5b00bc40": "ChunkHashMismatch",
  "0xfb8cd7ea": "StoryNotFound",
  "0xdaffd8a5": "MustBeNFTHolder",
  "0x081f37d2": "OnlyDeepFamilyContract",
  "0xd92e233d": "ZeroAddress",
  "0x0dc149f0": "AlreadyInitialized",
  "0x87138d5c": "NotInitialized",
  "0xf62a0f66": "AllowanceBelowZero",
  "0xfb8f41b2": "ERC20InsufficientAllowance",
  "0x08c379a0": "Error",
};

// Human-friendly defaults (English) for both contract and generic errors
export const REASON_FRIENDLY_MAP: Record<string, string> = {
  InvalidPersonHash: "Person hash is invalid for the provided inputs.",
  InvalidFatherVersionIndex: "Father version index is invalid or missing.",
  InvalidMotherVersionIndex: "Mother version index is invalid or missing.",
  InvalidVersionIndex: "Version index is invalid.",
  InvalidFullName: "Full name does not meet format requirements.",
  InvalidTagLength: "Tag is too long.",
  InvalidCIDLength: "Metadata CID is too long.",
  InvalidBirthPlace: "Birth place is invalid.",
  InvalidDeathPlace: "Death place is invalid.",
  InvalidDeathMonth: "Death month is invalid.",
  InvalidDeathDay: "Death day is invalid.",
  InvalidBirthMonth: "Birth month is invalid.",
  InvalidBirthDay: "Birth day is invalid.",
  InvalidBirthYear: "Birth year is invalid.",
  InvalidStory: "Story content is invalid.",
  InvalidTokenURI: "Token URI is invalid.",
  InvalidZKProof: "Zero-knowledge proof failed verification.",
  InvalidVerifierAddress: "Verifier contract address is invalid.",
  InvalidAttestationRegistry: "Attestation registry address is invalid.",
  InvalidDeepFamilyAddress: "DeepFamily contract address is invalid.",
  DeepFamilyAlreadyBound: "DeepFamily attestation registry is already bound.",
  OnlyDeepFamily: "Only the bound DeepFamily contract may anchor attestations.",
  VerifierRouteNotSet: "Verifier contract is not configured.",
  UnsupportedProofEncoding: "Proof encoding is not supported.",
  MalformedProofData: "Proof data is malformed.",
  UnsupportedPurpose: "Proof purpose is not supported by the verifier.",
  InvalidAttestationRefVersion: "Attestation reference version is not supported.",
  InvalidAttestationSubject: "Attestation subject does not match this action.",
  InvalidAttestationAction: "Attestation action digest does not match this transaction.",
  InvalidAttestationPayloadDigest: "Attestation payload digest is invalid.",
  InvalidAttestationSignatureSuite: "Attestation signature suite is not supported.",
  InvalidAttestationSignerKey: "Attestation signer key is invalid.",
  InvalidAttestationURI: "Attestation URI must be an IPFS CID reference.",
  InvalidAttestationIssuedAt: "Attestation issue time is outside the allowed range.",
  InvalidAttestationExpiresAt: "Attestation expiry time is invalid or expired.",
  InvalidAttestationRevocation: "Attestation revocation reference is invalid.",
  DuplicateAttestationReference: "This attestation reference is already anchored.",
  DuplicateVersion: "This version already exists on-chain.",
  InvalidTrustedEndorser: "Recommended source account is invalid.",
  TrustedEndorserAlreadyAdded: "Recommended source account has already been added.",
  TrustedEndorserNotFound: "Recommended source account is not in this version list.",
  MustBeVersionContributor: "Only the version contributor can manage recommended sources.",
  MustEndorseVersionFirst: "You must endorse a version before this action.",
  VersionAlreadyMinted: "Version has already been minted.",
  BasicInfoMismatch: "Basic information does not match stored version.",
  CallerMismatch: "Caller address does not match proof submitter.",
  InvalidParentHash: "Parent hash is invalid.",
  MustBeAdult: "The person must be an adult to proceed.",
  TokenContractNotSet: "Token contract is not configured.",
  ERC721NonexistentToken: "Token ID does not exist.",
  ERC721EnumerableForbiddenBatchMint: "Batch minting is not supported by this NFT contract.",
  ERC721IncorrectOwner: "NFT owner does not match the expected owner.",
  ERC721InsufficientApproval: "NFT approval is insufficient for this action.",
  ERC721InvalidApprover: "NFT approver address is invalid.",
  ERC721InvalidOperator: "NFT operator address is invalid.",
  ERC721InvalidOwner: "NFT owner address is invalid.",
  ERC721InvalidReceiver: "NFT receiver address is invalid.",
  ERC721InvalidSender: "NFT sender address is invalid.",
  ERC721OutOfBoundsIndex: "NFT index is out of bounds.",
  OwnableInvalidOwner: "Owner address is invalid.",
  OwnableUnauthorizedAccount: "Current wallet is not authorized for this owner-only action.",
  ReentrancyGuardReentrantCall: "Contract rejected a reentrant call.",
  InvalidTokenId: "Token ID is invalid.",
  EndorsementFeeTransferFailed: "Endorsement fee transfer failed.",
  ProtocolFeeTooHigh: "Protocol fee exceeds allowed limit.",
  AlreadyEndorsed: "Already endorsed this version.",
  NotEndorsed: "This version is not endorsed.",
  PageSizeExceedsLimit: "Page size exceeds limit.",
  DirectETHNotAccepted: "Direct ETH transfers are not accepted.",
  StoryAlreadySealed: "Story has already been sealed.",
  ChunkIndexOutOfRange: "Story chunk index out of range.",
  InvalidChunkContent: "Story chunk content invalid.",
  ChunkHashMismatch: "Story chunk hash mismatch.",
  StoryNotFound: "Story not found.",
  MustBeNFTHolder: "NFT holder permission required for this action.",
  OnlyDeepFamilyContract: "Only the DeepFamily contract can call this token function.",
  ZeroAddress: "Address cannot be zero.",
  AlreadyInitialized: "Contract has already been initialized.",
  NotInitialized: "Contract has not been initialized.",
  AllowanceBelowZero: "Token allowance cannot be reduced below zero.",
  Error: "Contract reverted.",
  rejected: "Transaction was cancelled by user.",
  EVM_PANIC: "Contract execution hit a Solidity panic.",
  WALLET_POPUP_TIMEOUT:
    "Wallet confirmation timed out. Please try again and make sure to confirm in the wallet popup.",
  REPLACEMENT_UNDERPRICED:
    "There is a pending transaction with the same nonce. Please raise gas price/priority fee or wait.",
  GAS_ERROR: "Gas limit or price too low. Please increase gas and retry.",
  OUT_OF_GAS: "Transaction ran out of gas during execution.",
  INSUFFICIENT_FUNDS: "Insufficient balance to cover gas fees.",
  INSUFFICIENT_DEEP_BALANCE: "Insufficient DEEP token balance for endorsement.",
  NETWORK_ERROR: "Network error. Please check your connection.",
  USER_REJECTED: "Transaction was cancelled by user.",
  WALLET_NOT_CONNECTED: "Please connect your wallet.",
  WALLET_UNAUTHORIZED: "Wallet authorization is required for this action.",
  WALLET_METHOD_UNSUPPORTED: "Wallet does not support this request.",
  WALLET_DISCONNECTED: "Wallet is disconnected. Please reconnect your wallet.",
  WALLET_CHAIN_DISCONNECTED: "Wallet is not connected to the requested network.",
  WALLET_CHAIN_NOT_ADDED: "This network is not added to your wallet.",
  WALLET_REQUEST_PENDING:
    "Wallet has a pending request. Open your wallet to confirm or cancel it, then try again.",
  CALL_EXCEPTION: "Contract validation failed. Please check input data.",
  ERC20InsufficientAllowance: "Allowance insufficient. Please re-approve the token allowance.",
};

const RETRYABLE_REASONS = new Set([
  "USER_REJECTED",
  "WALLET_POPUP_TIMEOUT",
  "WALLET_REQUEST_PENDING",
  "NETWORK_ERROR",
  "WALLET_UNAUTHORIZED",
  "WALLET_DISCONNECTED",
  "WALLET_CHAIN_DISCONNECTED",
  "WALLET_CHAIN_NOT_ADDED",
  "REPLACEMENT_UNDERPRICED",
  "GAS_ERROR",
]);

const normalizeReason = (val?: string) => {
  if (!val) return undefined;
  return val.replace(/\(\)$/, "");
};

const getKnownReasonFromErrorCode = (error: any): string | undefined => {
  const code = getPrimaryErrorCode(error);
  if (code === -32002) return "WALLET_REQUEST_PENDING";
  if (code === 4001 || code === "ACTION_REJECTED") return "USER_REJECTED";
  if (code === 4100) return "WALLET_UNAUTHORIZED";
  if (code === 4200) return "WALLET_METHOD_UNSUPPORTED";
  if (code === 4900) return "WALLET_DISCONNECTED";
  if (code === 4901) return "WALLET_CHAIN_DISCONNECTED";
  if (code === 4902) return "WALLET_CHAIN_NOT_ADDED";
  if (typeof code !== "string") return undefined;

  const normalized = normalizeReason(code);
  if (!normalized) return undefined;
  if (normalized === "UserRejected" || normalized === "UserRejectedRequestError") {
    return "USER_REJECTED";
  }
  if (REASON_FRIENDLY_MAP[normalized]) return normalized;
  return undefined;
};

const isRetryableReason = (reason?: string) => Boolean(reason && RETRYABLE_REASONS.has(reason));

const collectNestedStrings = (value: unknown): string[] => {
  const out = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number) => {
    if (out.size >= MAX_NESTED_STRING_COUNT || depth > MAX_NESTED_DEPTH) return;

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed) out.add(truncate(trimmed, MAX_COLLECTED_STRING_LENGTH));
      return;
    }
    if (!current || typeof current !== "object") return;
    if (seen.has(current as object)) return;
    seen.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current.slice(0, MAX_OBJECT_KEYS_PER_LEVEL)) {
        visit(item, depth + 1);
        if (out.size >= MAX_NESTED_STRING_COUNT) break;
      }
      return;
    }

    for (const key of Object.getOwnPropertyNames(current).slice(0, MAX_OBJECT_KEYS_PER_LEVEL)) {
      try {
        visit((current as Record<string, unknown>)[key], depth + 1);
      } catch {}
      if (out.size >= MAX_NESTED_STRING_COUNT) break;
    }
  };

  visit(value, 0);
  return [...out];
};

const collectNestedHexData = (value: unknown): string[] =>
  collectNestedStrings(value).filter((item) => /^0x[0-9a-fA-F]{8,}/.test(item));

const parseHexWord = (word: string): number | null => {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null;
  try {
    const value = BigInt(`0x${word}`);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  } catch {
    return null;
  }
};

const decodeUtf8Hex = (hex: string): string | null => {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const decoded = new TextDecoder().decode(bytes).trim();
    return decoded || null;
  } catch {
    return null;
  }
};

const decodeStandardRevertData = (data: string): string | undefined => {
  const normalized = data.toLowerCase();
  if (normalized.startsWith(STANDARD_PANIC_SELECTOR)) return "EVM_PANIC";
  if (!normalized.startsWith(STANDARD_ERROR_SELECTOR)) return undefined;

  const payload = data.slice(10);
  if (payload.length < 128) return undefined;

  const offsetBytes = parseHexWord(payload.slice(0, 64));
  if (offsetBytes == null) return undefined;

  const lengthOffset = offsetBytes * 2;
  const lengthBytes = parseHexWord(payload.slice(lengthOffset, lengthOffset + 64));
  if (lengthBytes == null) return undefined;

  const textOffset = lengthOffset + 64;
  if (payload.length < textOffset + lengthBytes * 2) return undefined;

  const textHex = payload.slice(textOffset, textOffset + lengthBytes * 2);
  return decodeUtf8Hex(textHex) ?? undefined;
};

const extractCustomErrorNameFromMessage = (msg?: string): string | undefined => {
  if (!msg) return undefined;

  const customPatterns = [
    /reverted with custom error '([A-Za-z_]\w*)\(/,
    /execution reverted(?::)?\s*([A-Za-z_]\w*)\(\)/i,
    /execution reverted(?::)?\s*([A-Za-z_]\w*)$/i,
  ];

  for (const pattern of customPatterns) {
    const match = msg.match(pattern);
    if (match?.[1]) return normalizeReason(match[1]);
  }

  return undefined;
};

const extractSelectorReason = (value: unknown): string | undefined => {
  for (const data of collectNestedHexData(value)) {
    const standardReason = decodeStandardRevertData(data);
    if (standardReason) return normalizeReason(standardReason);

    const selector = data.slice(0, 10);
    if (ERROR_SELECTOR_MAP[selector]) return ERROR_SELECTOR_MAP[selector];
  }
  return undefined;
};

const extractReasonFromMessages = (value: unknown): string | undefined => {
  for (const msg of collectNestedStrings(value)) {
    const customErrorName = extractCustomErrorNameFromMessage(msg);
    if (customErrorName) return customErrorName;
  }
  return undefined;
};

export const resolveErrorReason = (error: any): string | undefined => {
  const cachedReason = normalizeReason(error?.__dfDecodedReason);
  if (cachedReason) return cachedReason;

  const directReasonCandidates = [
    error?.reason,
    error?.data?.reason,
    error?.error?.reason,
    error?.info?.error?.reason,
  ];
  for (const candidate of directReasonCandidates) {
    const normalized = normalizeReason(candidate);
    if (normalized) return normalized;
  }

  const typedReason = normalizeReason(error?.type);
  if (typedReason && REASON_FRIENDLY_MAP[typedReason]) return typedReason;

  const selectorReason = extractSelectorReason(error);
  if (selectorReason) return selectorReason;

  const messageReason = extractReasonFromMessages(error);
  if (messageReason) return messageReason;

  const msg = collectNestedStrings(error).join("\n");
  const codeReason = getKnownReasonFromErrorCode(error);

  if (
    error?.code === "ACTION_REJECTED" ||
    error?.code === 4001 ||
    /user (rejected|denied)/i.test(msg) ||
    /UserRejected/i.test(msg)
  ) {
    return "USER_REJECTED";
  }

  if (/connect your wallet|no wallet connected/i.test(msg)) {
    return "WALLET_NOT_CONNECTED";
  }

  if (/invalidtokenid|invalid token id/i.test(msg)) {
    return "InvalidTokenId";
  }

  if (/nonexistent token|query for nonexistent token|token does not exist/i.test(msg)) {
    return "ERC721NonexistentToken";
  }

  if (codeReason === "WALLET_REQUEST_PENDING" || /request (?:is )?already pending/i.test(msg)) {
    return "WALLET_REQUEST_PENDING";
  }

  if (codeReason && codeReason !== "CALL_EXCEPTION") {
    return codeReason;
  }

  if (error?.code === "REPLACEMENT_UNDERPRICED" || /replacement fee too low/i.test(msg)) {
    return "REPLACEMENT_UNDERPRICED";
  }

  if (/out of gas/i.test(msg)) {
    return "OUT_OF_GAS";
  }

  if (
    error?.code === "UNPREDICTABLE_GAS_LIMIT" ||
    /cannot estimate gas|gas required exceeds allowance|intrinsic gas too low|gas limit|gas price/i.test(
      msg,
    )
  ) {
    return "GAS_ERROR";
  }

  if (/insufficient allowance|ERC20InsufficientAllowance/i.test(msg))
    return "ERC20InsufficientAllowance";
  if (/insufficient funds|ERC20InsufficientBalance/i.test(msg)) return "INSUFFICIENT_FUNDS";

  if (error?.code === "NETWORK_ERROR" || /network/i.test(msg)) {
    return "NETWORK_ERROR";
  }

  if (/WALLET_POPUP_TIMEOUT/i.test(msg)) {
    return "WALLET_POPUP_TIMEOUT";
  }

  if (error?.code === "CALL_EXCEPTION") {
    return "CALL_EXCEPTION";
  }

  if (codeReason) return codeReason;

  return undefined;
};

// Derive a readable message from various error fields (fallback when no reason)
export const deriveReadableError = (err: any): string | null => {
  const unwrap = (msg: unknown) => (typeof msg === "string" ? msg.trim() : "");
  const candidates: Array<string | undefined> = [
    err?.parsedMessage,
    err?.shortMessage,
    err?.reason,
    err?.data?.message,
    err?.error?.message,
    err?.info?.error?.message,
    err?.message,
  ];

  for (const msg of candidates) {
    const cleaned = unwrap(msg);
    if (cleaned) return cleaned;
  }

  const errorName =
    err?.customError || err?.errorName || err?.data?.errorName || err?.info?.error?.name;
  const errorArgs = err?.data?.errorArgs || err?.errorArgs;
  if (errorName) {
    const argsStr = Array.isArray(errorArgs) ? `(${errorArgs.join(", ")})` : "";
    return `${errorName}${argsStr}`;
  }

  const code = err?.code || err?.error?.code || err?.info?.error?.code;
  if (code) return `Error code: ${code}`;

  return null;
};

export const getFriendlyError = (error: any, t: TFunction): FriendlyError => {
  const reason = resolveErrorReason(error);
  const humanMessage = error?.humanMessage || error?.message;
  const derivedRaw = deriveReadableError(error);
  const code = getPrimaryErrorCode(error);

  if (reason) {
    const fallback = REASON_FRIENDLY_MAP[reason] || humanMessage || "Transaction failed.";
    const translated = t(`errors.contractError.${reason}`, fallback);
    const friendly = typeof translated === "string" ? translated : fallback;
    return {
      type: reason,
      message: friendly,
      details: friendly,
      reason,
      code,
      retryable: isRetryableReason(reason),
    };
  }

  const unknown = t("errors.unknown", "Submission failed. Please retry or check your input.");
  const fallbackUnknown =
    typeof unknown === "string" ? unknown : "Submission failed. Please retry or check your input.";
  const details =
    typeof error?.details === "string"
      ? error.details
      : String(error?.details ?? derivedRaw ?? error?.message ?? fallbackUnknown);
  const safeDetails = truncate(details, MAX_ERROR_DETAILS_LENGTH);

  return {
    type: error?.type || "UNKNOWN_ERROR",
    message: fallbackUnknown,
    details: safeDetails,
    code,
    retryable: false,
  };
};

// Attempt to extract a revert reason/custom error from a contract error object
export const extractRevertReason = (
  contract: { interface?: any } | null,
  rawError: any,
): string | null => {
  if (!rawError) return null;
  if (rawError.__dfDecodedReason) return rawError.__dfDecodedReason;

  const directReason =
    rawError?.reason ??
    rawError?.data?.reason ??
    rawError?.error?.reason ??
    rawError?.info?.error?.reason;
  if (directReason) return normalizeReason(directReason) ?? directReason;

  for (const data of collectNestedHexData(rawError)) {
    const standardReason = decodeStandardRevertData(data);
    if (standardReason) return normalizeReason(standardReason) ?? standardReason;

    try {
      const parsedError = contract?.interface?.parseError?.(data);
      if (parsedError) return parsedError.name;
    } catch {}

    const selector = data.slice(0, 10);
    if (ERROR_SELECTOR_MAP[selector]) {
      return ERROR_SELECTOR_MAP[selector];
    }
  }

  for (const msg of collectNestedStrings(rawError)) {
    const customErrorName = extractCustomErrorNameFromMessage(msg);
    if (customErrorName) return customErrorName;

    const match = msg.match(/execution reverted:?\s*(.+)/i);
    if (match?.[1]) return match[1];
  }

  return null;
};

export type NormalizeFriendlyErrorOptions = {
  contract?: { interface?: any } | null;
  fallbackMessage?: string;
  fallbackType?: string;
  messageOverrides?: Record<string, string>;
};

export const defaultErrorTranslator = (_key: string, fallback?: string) => fallback ?? _key;

const attachDecodedReason = (error: any, contract?: { interface?: any } | null): any => {
  if (!contract) return error;
  const decodedReason = extractRevertReason(contract, error);
  if (!decodedReason) return error;

  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, "__dfDecodedReason", {
        value: decodedReason,
        configurable: true,
        writable: true,
      });
      return error;
    } catch {}
  }

  return {
    message: typeof error?.message === "string" ? error.message : String(error),
    __dfDecodedReason: decodedReason,
  };
};

export const normalizeFriendlyError = (
  error: any,
  t: TFunction,
  options: NormalizeFriendlyErrorOptions = {},
): FriendlyError => {
  const enrichedError = attachDecodedReason(error, options.contract);
  const friendly = getFriendlyError(enrichedError, t);
  const reason = friendly.reason || friendly.type;
  const overriddenMessage = reason ? options.messageOverrides?.[reason] : undefined;
  const isUnknown = friendly.type === "UNKNOWN_ERROR";
  const message =
    overriddenMessage ||
    (isUnknown && options.fallbackMessage ? options.fallbackMessage : friendly.message);
  const details =
    overriddenMessage && friendly.details === friendly.message
      ? overriddenMessage
      : friendly.details;

  return {
    ...friendly,
    type: isUnknown && options.fallbackType ? options.fallbackType : friendly.type,
    message,
    details,
    retryable: friendly.retryable ?? isRetryableReason(reason),
  };
};

export const getFriendlyErrorMessage = (
  error: any,
  t: TFunction,
  fallbackMessage: string,
  options: Omit<NormalizeFriendlyErrorOptions, "fallbackMessage"> & {
    preferDetailsForUnknown?: boolean;
  } = {},
): string => {
  const { preferDetailsForUnknown, ...normalizeOptions } = options;
  const friendly = normalizeFriendlyError(error, t, {
    ...normalizeOptions,
    fallbackMessage,
  });
  if (preferDetailsForUnknown && friendly.type === "UNKNOWN_ERROR" && friendly.details) {
    return friendly.details;
  }
  return friendly.message;
};

export const normalizeErrorToError = (
  error: any,
  t: TFunction = defaultErrorTranslator as TFunction,
  options: NormalizeFriendlyErrorOptions = {},
): Error => {
  const friendly = normalizeFriendlyError(error, t, options);
  const normalized = new Error(friendly.message);
  (normalized as any).type = friendly.type;
  (normalized as any).reason = friendly.reason;
  (normalized as any).details = friendly.details;
  (normalized as any).code = friendly.reason || friendly.type || friendly.code;
  (normalized as any).retryable = friendly.retryable;
  (normalized as any).friendly = friendly;
  return normalized;
};
