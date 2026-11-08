import type { ChainErrorOptions, ChainOperation } from "./errors.js";
import type { TransactionReceiptLike, TransactionResponseLike } from "./types.js";
import type { TransactionReceiptResult, WaitForTransactionInput } from "./receipts.js";
export interface ChainReadInput<T> extends ChainErrorOptions {
  read: () => Promise<T>;
  operation?: Extract<ChainOperation, "read" | "estimate" | "verify">;
}
export function runChainRead<T>(input: ChainReadInput<T>): Promise<T>;
export interface ExecuteChainTransactionInput<TReceipt extends TransactionReceiptLike, TTx extends TransactionResponseLike<TReceipt>> extends Omit<WaitForTransactionInput<TReceipt>, "transaction"> {
  send: () => Promise<TTx>;
  provider?: { getBlockNumber(): Promise<number> };
  fromBlock?: number;
  assertActive?: () => void;
  /** Complete asynchronous wallet/scope checks before the final synchronous cancellation guard. */
  beforeSend?: () => void | Promise<void>;
  label?: string;
  /** Durable callers can journal the original response before receipt waiting starts. */
  onTransactionSubmitted?: (transaction: TTx) => void | Promise<void>;
  onConfirmed?: (transactionHash: string, receipt: TReceipt) => void | Promise<void>;
}
export function executeChainTransaction<TReceipt extends TransactionReceiptLike = TransactionReceiptLike, TTx extends TransactionResponseLike<TReceipt> = TransactionResponseLike<TReceipt>>(input: ExecuteChainTransactionInput<TReceipt, TTx>): Promise<TransactionReceiptResult<TReceipt> & { transaction: TTx }>;
export function waitForTransactionHashReceipt<TReceipt extends TransactionReceiptLike>(input: Omit<WaitForTransactionInput<TReceipt>, "transaction" | "expected" | "replacementPolicy"> & {
  transactionHash: string;
  provider: { waitForTransaction(hash: string, confirmations?: number, timeoutMs?: number): Promise<TReceipt | null> };
}): Promise<TransactionReceiptResult<TReceipt>>;
