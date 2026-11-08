import type { TransactionErrorContext } from "./types.js";
export type ChainErrorCategory = "cancelled" | "wallet" | "network" | "reverted" | "validation" | "verification" | "unknown";
export type ChainOperation = "read" | "estimate" | "submit" | "confirm" | "verify";
/** Foreign rejection normalized into Error; missing diagnostics use the consumer's translated fallback. */
export class ChainOperationError extends Error {
  readonly messageAvailable: boolean;
  constructor(message?: unknown, fallbackMessage?: string);
}
export interface ChainErrorOptions extends TransactionErrorContext {
  operation?: ChainOperation;
  category?: ChainErrorCategory;
  label?: string;
}
export interface ChainErrorDetails extends TransactionErrorContext {
  category: ChainErrorCategory;
  operation: ChainOperation;
  code: string | number;
  retryable: boolean;
}
export type TransactionContextError = Error & TransactionErrorContext & { readonly chainError?: ChainErrorDetails };
/** Reads only public tracking fields without invoking getters. */
export function getTransactionErrorContext(error: unknown): TransactionErrorContext;
/** A safe canonical view; never contains raw diagnostics, calldata, causes or private material. */
export function getChainErrorDetails(error: unknown, options?: ChainErrorOptions): ChainErrorDetails;
/** Preserves Error identity and domain-specific fields; attaches immutable public metadata. */
export function normalizeChainError(error: unknown, options?: ChainErrorOptions): TransactionContextError;
export function withTransactionHash(error: unknown, transactionHash: string | undefined): TransactionContextError;
export function withConfirmedTransaction(error: unknown, transactionHash: string, verificationFailure: import("./types.js").ConfirmationFailure): TransactionContextError;
export function readConfirmedDetails<T>(transactionHash: string, read: () => Promise<T>): Promise<T>;
export function verifyConfirmedDetails<T>(transactionHash: string, verify: () => Promise<T>): Promise<T>;
