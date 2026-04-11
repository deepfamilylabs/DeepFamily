/**
 * Transaction error classification helpers.
 *
 * Provides utilities for normalizing raw ethers/wallet errors into the
 * structured TxFlowError format used by all transaction flows.
 */
import { resolveErrorReason } from "../../../shared/lib/errors";
import type { TxFlowError } from "./txStatus";

/** Well-known error types for transaction flows. */
export const TX_ERROR_TYPES = {
  USER_REJECTED: "UserRejected",
  INSUFFICIENT_FUNDS: "InsufficientFunds",
  INSUFFICIENT_ALLOWANCE: "InsufficientAllowance",
  CONTRACT_REVERT: "ContractRevert",
  NETWORK_ERROR: "NetworkError",
  TIMEOUT: "Timeout",
  UNKNOWN: "Unknown",
} as const;

/**
 * Check whether an error represents a user-initiated rejection
 * (e.g. MetaMask "user denied transaction signature").
 */
export function isUserRejection(error: unknown): boolean {
  return resolveErrorReason(error) === "USER_REJECTED";
}

/**
 * Build a TxFlowError from a raw error, using `classify` for type detection
 * and `message` for a human-readable summary.
 */
export function toTxFlowError(
  error: unknown,
  message: string,
  type?: string,
): TxFlowError {
  const e = error as any;
  const reason = resolveErrorReason(error);
  return {
    type: type ?? (reason === "USER_REJECTED" ? TX_ERROR_TYPES.USER_REJECTED : TX_ERROR_TYPES.UNKNOWN),
    message,
    details: e?.shortMessage || e?.message || String(error),
    reason: e?.reason ?? reason,
  };
}
