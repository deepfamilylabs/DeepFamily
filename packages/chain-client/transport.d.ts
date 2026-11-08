import type { ChainErrorDetails, TransactionContextError } from "./errors.js";
export interface SerializedChainError {
  message: string;
  chainError: ChainErrorDetails;
}
/** Only known public codes and validated transaction context accompany the sanitized message. */
export function serializeChainError(error: unknown, safeMessage: string): SerializedChainError;
/** Invalid metadata becomes a generic error; arbitrary input properties are never copied. */
export function restoreChainError(input: unknown): TransactionContextError;
