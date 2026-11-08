import { ownValue } from "./internal.js";
import { getChainErrorDetails, normalizeChainError } from "./errors.js";

const categories = new Set(["cancelled", "wallet", "network", "reverted", "validation", "verification", "unknown"]);
const operations = new Set(["read", "estimate", "submit", "confirm", "verify"]);
const publicCodes = new Set([
  "CHAIN_OPERATION_FAILED", "CHAIN_WALLET_SCOPE_CHANGED", "CHAIN_WALLET_UNAVAILABLE",
  "UNKNOWN_ERROR", "NOT_IMPLEMENTED", "UNSUPPORTED_OPERATION", "NETWORK_ERROR", "SERVER_ERROR",
  "TIMEOUT", "BAD_DATA", "CANCELLED", "BUFFER_OVERRUN", "NUMERIC_FAULT", "INVALID_ARGUMENT",
  "MISSING_ARGUMENT", "UNEXPECTED_ARGUMENT", "CALL_EXCEPTION", "INSUFFICIENT_FUNDS", "NONCE_EXPIRED",
  "REPLACEMENT_UNDERPRICED", "TRANSACTION_REPLACED", "UNCONFIGURED_NAME", "OFFCHAIN_FAULT",
  "ACTION_REJECTED", "WALLET_REQUEST_PENDING", "UNPREDICTABLE_GAS_LIMIT",
  "TRANSACTION_REPLACEMENT_CANCELLED", "TRANSACTION_REPLACEMENT_MISMATCH", "TRANSACTION_RECEIPT_MISMATCH",
  "ARCHIVE_GAS_ESTIMATE_INVALID", "ARCHIVE_NETWORK_NOT_CONFIGURED", "ARCHIVE_BLOCK_GAS_UNAVAILABLE",
  "ARCHIVE_GAS_LIMIT_EXCEEDED", "ARCHIVE_GAS_BELOW_CALLDATA_FLOOR", "ARCHIVE_VALIDATION_FAILED",
  "ARCHIVE_PREVIEW_REJECTED",
]);
const publicNumberCodes = new Set([4001, 4100, 4200, 4900, 4901, 4902, -32700, -32600, -32601, -32602, -32603]);
const publicCode = (value) => publicCodes.has(value) || publicNumberCodes.has(value) ||
  typeof value === "number" && Number.isSafeInteger(value) && value >= -32099 && value <= -32000;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const safeMessage = (value, fallback = "Chain operation failed") =>
  typeof value === "string" && value.trim() ? value.slice(0, 1200) : fallback;

/** The caller supplies already-sanitized wording; no raw Error or cause crosses the boundary. */
export function serializeChainError(error, message) {
  const details = getChainErrorDetails(error);
  const transactionHash = typeof details.transactionHash === "string" && hashPattern.test(details.transactionHash)
    ? details.transactionHash : undefined;
  const transactionConfirmed = transactionHash ? details.transactionConfirmed : undefined;
  const chainError = {
    category: details.category,
    operation: details.operation,
    code: publicCode(details.code) ? details.code : "CHAIN_OPERATION_FAILED",
    retryable: transactionHash || transactionConfirmed ? false : details.retryable,
    ...(transactionHash ? { transactionHash } : {}),
    ...(typeof transactionConfirmed === "boolean" ? { transactionConfirmed } : {}),
    ...(transactionConfirmed === true && details.verificationFailure ? { verificationFailure: details.verificationFailure } : {}),
  };
  return { message: safeMessage(message), chainError };
}

/** Validate the public DTO and rebuild only its safe error contract, never arbitrary properties. */
export function restoreChainError(input) {
  const error = new Error(safeMessage(ownValue(input, "message")));
  const view = ownValue(input, "chainError");
  const category = ownValue(view, "category");
  const operation = ownValue(view, "operation");
  const code = ownValue(view, "code");
  const retryable = ownValue(view, "retryable");
  const transactionHash = ownValue(view, "transactionHash");
  const transactionConfirmed = ownValue(view, "transactionConfirmed");
  const verificationFailure = ownValue(view, "verificationFailure");
  if (!categories.has(category) || !operations.has(operation) || !publicCode(code) || typeof retryable !== "boolean" ||
      transactionHash !== undefined && (typeof transactionHash !== "string" || !hashPattern.test(transactionHash)) ||
      transactionConfirmed !== undefined && typeof transactionConfirmed !== "boolean" ||
      transactionConfirmed === true && !transactionHash ||
      verificationFailure !== undefined && (transactionConfirmed !== true || !["read", "mismatch"].includes(verificationFailure))) {
    return normalizeChainError(error);
  }
  Object.defineProperty(error, "code", { value: code, configurable: true });
  return normalizeChainError(error, {
    category, operation,
    ...(transactionHash ? { transactionHash } : {}),
    ...(typeof transactionConfirmed === "boolean" ? { transactionConfirmed } : {}),
    ...(verificationFailure ? { verificationFailure } : {}),
  });
}
