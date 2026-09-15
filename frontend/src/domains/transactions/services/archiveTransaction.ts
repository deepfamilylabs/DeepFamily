import { ethers } from "ethers";
import { ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH } from "@deepfamily/protocol-core";
import { ARCHIVE_PREVIEW_REJECTED, ARCHIVE_VALIDATION_FAILED } from "../../../shared/lib/errors";

/**
 * The locale string shown in place of an archive error's message. The message
 * itself stays English, for logs and tests; getFriendlyError does the swap.
 */
export interface ArchiveErrorI18n {
  key: string;
  params?: Record<string, string | number>;
  /** Translated on its own and passed to `key` as `{{guidance}}`. */
  guidanceKey?: string;
}

export const archiveValidationError = (message: string, i18n: ArchiveErrorI18n, reason?: string) =>
  Object.assign(new Error(message), {
    code: ARCHIVE_VALIDATION_FAILED,
    i18n,
    ...(reason ? { reason } : {}),
  });

/** The writer closed the fee preview. Nothing was sent, so callers report nothing. */
export const archivePreviewRejectedError = (message: string) =>
  Object.assign(new Error(message), {
    code: ARCHIVE_PREVIEW_REJECTED,
    i18n: { key: "archive.errors.previewRejected" } satisfies ArchiveErrorI18n,
  });

export interface ArchiveTransactionPreview {
  canonicalPayload: string;
  payloadHash: string;
  payloadBytes: number;
  segmentCount: number;
  estimated: true;
  estimatedGas: bigint;
  gasLimit: bigint;
  estimatedFee: bigint;
  maximumFee: bigint;
  nativeSymbol: string;
}

// The eSpace eth block gas limit already represents the eSpace allowance.
// A null cap means the network's current block limit is the limiting profile rule.
export const ARCHIVE_CHAIN_PROFILES: Record<
  string,
  { maxTransactionGas: bigint | null; calldataGasPerByte: bigint; nativeSymbol: string }
> = {
  "1": { maxTransactionGas: 16_777_216n, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
  "11155111": { maxTransactionGas: 16_777_216n, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
  "1030": { maxTransactionGas: null, calldataGasPerByte: 100n, nativeSymbol: "CFX" },
  "71": { maxTransactionGas: null, calldataGasPerByte: 100n, nativeSymbol: "CFX" },
  "31337": { maxTransactionGas: null, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
};

export async function estimateArchiveTransaction(input: {
  contractMethod: any;
  args: readonly unknown[];
  provider: any;
  calldata: string;
  payload: string;
  kind: "Story" | "Metadata" | "Seal" | "Mint";
}): Promise<ArchiveTransactionPreview> {
  const guidance =
    input.kind === "Story"
      ? "Split the text into another logical story record."
      : input.kind === "Mint"
        ? "Reduce the public biography before minting; the NFT and biography must fit in one transaction."
        : input.kind === "Metadata"
          ? "The current network cannot atomically store this metadata."
          : "Refresh the story and try again.";
  const guidanceKey = `archive.errors.guidance.${input.kind.toLowerCase()}`;
  const estimationFailed = { key: "archive.errors.gasEstimationFailed", guidanceKey };
  let estimatedGas: bigint;
  try {
    if (typeof input.contractMethod.estimateGas !== "function")
      throw archiveValidationError("RPC gas estimation is unavailable", estimationFailed);
    estimatedGas = BigInt(await input.contractMethod.estimateGas(...input.args));
    if (estimatedGas <= 0n)
      throw archiveValidationError("RPC returned an invalid gas estimate", estimationFailed);
  } catch (error) {
    // A successful simulation does not authorize sending an unestimated transaction.
    if (typeof input.contractMethod.staticCall === "function") {
      try {
        await input.contractMethod.staticCall(...input.args);
      } catch (simulationError) {
        throw simulationError;
      }
    }
    throw Object.assign(
      archiveValidationError(`Archive gas estimation failed. ${guidance}`, estimationFailed),
      { cause: error },
    );
  }
  const [network, block, fees] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getBlock("latest"),
    input.provider.getFeeData(),
  ]);
  const profile = ARCHIVE_CHAIN_PROFILES[String(network.chainId)];
  if (!profile)
    throw archiveValidationError("Archive transaction limits are not configured for this network", {
      key: "archive.errors.networkNotConfigured",
    });
  if (!block || BigInt(block.gasLimit) <= 0n)
    throw archiveValidationError("Current block gas limit is unavailable", {
      key: "archive.errors.blockGasLimitUnavailable",
    });
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (
    gasLimit > BigInt(block.gasLimit) ||
    (profile.maxTransactionGas !== null && gasLimit > profile.maxTransactionGas)
  ) {
    throw archiveValidationError(
      `Buffered archive gas exceeds the network transaction limit. ${guidance}`,
      { key: "archive.errors.gasLimitExceeded", guidanceKey },
    );
  }
  if (gasLimit < BigInt(ethers.getBytes(input.calldata).length) * profile.calldataGasPerByte) {
    throw archiveValidationError("RPC gas estimate is below the network calldata gas floor", {
      key: "archive.errors.gasBelowCalldataFloor",
    });
  }
  const gasPrice = fees.gasPrice ?? fees.maxFeePerGas;
  const maximumGasPrice = fees.maxFeePerGas ?? fees.gasPrice;
  if (
    gasPrice === null ||
    gasPrice === undefined ||
    maximumGasPrice === null ||
    maximumGasPrice === undefined
  ) {
    throw archiveValidationError("Network fee estimate is unavailable", {
      key: "archive.errors.feeUnavailable",
    });
  }
  const payloadBytes = ethers.getBytes(input.payload).length;
  return Object.freeze({
    canonicalPayload: input.payload,
    payloadHash: ethers.keccak256(input.payload),
    payloadBytes,
    segmentCount: Math.ceil(payloadBytes / ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH),
    estimated: true as const,
    estimatedGas,
    gasLimit,
    estimatedFee: estimatedGas * BigInt(gasPrice),
    maximumFee: gasLimit * BigInt(maximumGasPrice),
    nativeSymbol: profile.nativeSymbol,
  });
}

export function assertBlobRefMatches(
  actual: any,
  expected: {
    payloadHash: string;
    payloadLength: number;
    segmentCount: number;
    pointer?: string;
  },
) {
  if (
    !actual ||
    String(actual.payloadHash).toLowerCase() !== expected.payloadHash.toLowerCase() ||
    BigInt(actual.payloadLength) !== BigInt(expected.payloadLength) ||
    BigInt(actual.segmentCount) !== BigInt(expected.segmentCount) ||
    !ethers.isAddress(actual.pointer) ||
    actual.pointer === ethers.ZeroAddress ||
    (expected.pointer && String(actual.pointer).toLowerCase() !== expected.pointer.toLowerCase())
  ) {
    throw archiveValidationError("Archive receipt/reference does not match the frozen payload", {
      key: "archive.errors.confirmationMismatch",
    });
  }
}
