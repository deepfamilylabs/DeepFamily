import { ethers } from "ethers";
import { ARCHIVE_MAX_SEGMENT_PAYLOAD_LENGTH } from "@deepfamily/protocol-core";

export const archiveValidationError = (message: string) =>
  Object.assign(new Error(message), { code: "ARCHIVE_VALIDATION_FAILED" });

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
  kind: "Story" | "Metadata" | "Seal";
}): Promise<ArchiveTransactionPreview> {
  const guidance =
    input.kind === "Story"
      ? "Split the text into another logical story record."
      : input.kind === "Metadata"
        ? "The current network cannot atomically store this metadata."
        : "Refresh the story and try again.";
  let estimatedGas: bigint;
  try {
    if (typeof input.contractMethod.estimateGas !== "function")
      throw archiveValidationError("RPC gas estimation is unavailable");
    estimatedGas = BigInt(await input.contractMethod.estimateGas(...input.args));
    if (estimatedGas <= 0n) throw archiveValidationError("RPC returned an invalid gas estimate");
  } catch (error) {
    // A successful simulation does not authorize sending an unestimated transaction.
    if (typeof input.contractMethod.staticCall === "function") {
      try {
        await input.contractMethod.staticCall(...input.args);
      } catch (simulationError) {
        throw simulationError;
      }
    }
    throw Object.assign(new Error(`Archive gas estimation failed. ${guidance}`), {
      code: "ARCHIVE_VALIDATION_FAILED",
      cause: error,
    });
  }
  const [network, block, fees] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getBlock("latest"),
    input.provider.getFeeData(),
  ]);
  const profile = ARCHIVE_CHAIN_PROFILES[String(network.chainId)];
  if (!profile)
    throw archiveValidationError("Archive transaction limits are not configured for this network");
  if (!block || BigInt(block.gasLimit) <= 0n)
    throw archiveValidationError("Current block gas limit is unavailable");
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (
    gasLimit > BigInt(block.gasLimit) ||
    (profile.maxTransactionGas !== null && gasLimit > profile.maxTransactionGas)
  ) {
    throw archiveValidationError(
      `Buffered archive gas exceeds the network transaction limit. ${guidance}`,
    );
  }
  if (gasLimit < BigInt(ethers.getBytes(input.calldata).length) * profile.calldataGasPerByte) {
    throw archiveValidationError("RPC gas estimate is below the network calldata gas floor");
  }
  const gasPrice = fees.gasPrice ?? fees.maxFeePerGas;
  const maximumGasPrice = fees.maxFeePerGas ?? fees.gasPrice;
  if (
    gasPrice === null ||
    gasPrice === undefined ||
    maximumGasPrice === null ||
    maximumGasPrice === undefined
  ) {
    throw archiveValidationError("Network fee estimate is unavailable");
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
    throw archiveValidationError("Archive receipt/reference does not match the frozen payload");
  }
}
