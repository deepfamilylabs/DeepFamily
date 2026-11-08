import type { TransactionReceiptLike, TransactionResponseLike, TransactionScope } from "./types.js";
export interface WaitForTransactionInput<TReceipt extends TransactionReceiptLike> {
  transaction: TransactionResponseLike<TReceipt>;
  expected?: TransactionScope;
  onSubmitted?: (transactionHash: string) => void | Promise<void>;
  confirmations?: number;
  timeoutMs?: number;
  requireSuccess?: boolean;
  /** Contract creation and journal recovery cannot infer an exact replacement. */
  replacementPolicy?: "fee-only" | "reject";
}
export interface TransactionReceiptResult<TReceipt extends TransactionReceiptLike> {
  receipt: TReceipt;
  transactionHash: string;
}
export function waitForExactTransactionReceipt<TReceipt extends TransactionReceiptLike>(input: WaitForTransactionInput<TReceipt>): Promise<TransactionReceiptResult<TReceipt>>;
