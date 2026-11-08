import { ethers } from "ethers";
import { normalizeChainError, runChainRead, validateArchiveGas } from "@deepfamily/chain-client";
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
  normalizeChainError(Object.assign(new Error(message), {
    code: ARCHIVE_VALIDATION_FAILED,
    i18n,
    ...(reason ? { reason } : {}),
  }), { category: "validation" });

/** The writer closed the fee preview. Nothing was sent, so callers report nothing. */
export const archivePreviewRejectedError = (message: string) =>
  normalizeChainError(Object.assign(new Error(message), {
    code: ARCHIVE_PREVIEW_REJECTED,
    i18n: { key: "archive.errors.previewRejected" } satisfies ArchiveErrorI18n,
  }), { category: "cancelled", operation: "submit" });

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

export async function estimateArchiveTransaction(input: {
  contractMethod: { estimateGas?: (...args: unknown[]) => Promise<bigint>; staticCall?: (...args: unknown[]) => Promise<unknown> };
  args: readonly unknown[];
  provider: Pick<ethers.Provider, "getNetwork" | "getBlock" | "getFeeData">;
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
    estimatedGas = BigInt(await runChainRead({ read: () => input.contractMethod.estimateGas!(...input.args), operation: "estimate" }));
    if (estimatedGas <= 0n)
      throw archiveValidationError("RPC returned an invalid gas estimate", estimationFailed);
  } catch (error) {
    // A successful simulation does not authorize sending an unestimated transaction.
    if (typeof input.contractMethod.staticCall === "function") {
      try {
        await runChainRead({ read: () => input.contractMethod.staticCall!(...input.args), operation: "estimate" });
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
  let validated: ReturnType<typeof validateArchiveGas>;
  try {
    validated = validateArchiveGas({ estimatedGas, chainId: network.chainId,
      blockGasLimit: block?.gasLimit, calldata: input.calldata });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const keys: Record<string, string> = {
      ARCHIVE_NETWORK_NOT_CONFIGURED: "archive.errors.networkNotConfigured",
      ARCHIVE_BLOCK_GAS_UNAVAILABLE: "archive.errors.blockGasLimitUnavailable",
      ARCHIVE_GAS_LIMIT_EXCEEDED: "archive.errors.gasLimitExceeded",
      ARCHIVE_GAS_BELOW_CALLDATA_FLOOR: "archive.errors.gasBelowCalldataFloor",
    };
    throw archiveValidationError(error instanceof Error ? error.message : "Archive gas validation failed", {
      key: typeof code === "string" ? keys[code] ?? estimationFailed.key : estimationFailed.key,
      guidanceKey,
    });
  }
  const { gasLimit, nativeSymbol } = validated;
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
    nativeSymbol,
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
