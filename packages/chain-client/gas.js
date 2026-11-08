import { getBytes } from "ethers";
import { chainTrackingError } from "./errors.js";

export const ARCHIVE_CHAIN_PROFILES = Object.freeze(
  Object.fromEntries(
    Object.entries({
      1: { maxTransactionGas: 16_777_216n, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
      11155111: { maxTransactionGas: 16_777_216n, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
      1030: { maxTransactionGas: null, calldataGasPerByte: 100n, nativeSymbol: "CFX" },
      71: { maxTransactionGas: null, calldataGasPerByte: 100n, nativeSymbol: "CFX" },
      31337: { maxTransactionGas: null, calldataGasPerByte: 0n, nativeSymbol: "ETH" },
    }).map(([key, value]) => [key, Object.freeze(value)]),
  ),
);

function positiveInteger(value, message, code) {
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error();
    if (value == null || BigInt(value) <= 0n) throw new Error();
    return BigInt(value);
  } catch {
    throw chainTrackingError(message, code);
  }
}

export function validateArchiveGas({ estimatedGas, chainId, blockGasLimit, calldata }) {
  const estimate = positiveInteger(
    estimatedGas,
    "Archive gas estimate must be positive",
    "ARCHIVE_GAS_ESTIMATE_INVALID",
  );
  const profile = ARCHIVE_CHAIN_PROFILES[String(chainId)];
  if (!profile)
    throw chainTrackingError(
      "Archive transaction limits are not configured for this network",
      "ARCHIVE_NETWORK_NOT_CONFIGURED",
    );
  const blockLimit = positiveInteger(
    blockGasLimit,
    "Current block gas limit is unavailable",
    "ARCHIVE_BLOCK_GAS_UNAVAILABLE",
  );
  const gasLimit = (estimate * 120n + 99n) / 100n;
  if (
    gasLimit > blockLimit ||
    (profile.maxTransactionGas !== null && gasLimit > profile.maxTransactionGas)
  ) {
    throw chainTrackingError(
      "Buffered archive gas exceeds the network transaction limit",
      "ARCHIVE_GAS_LIMIT_EXCEEDED",
    );
  }
  if (gasLimit < BigInt(getBytes(calldata).length) * profile.calldataGasPerByte) {
    throw chainTrackingError(
      "RPC gas estimate is below the network calldata gas floor",
      "ARCHIVE_GAS_BELOW_CALLDATA_FLOOR",
    );
  }
  return { estimatedGas: estimate, gasLimit, nativeSymbol: profile.nativeSymbol };
}
