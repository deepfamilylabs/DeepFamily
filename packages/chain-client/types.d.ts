export type IntegerLike = number | bigint | string;
export interface TransactionScope {
  chainId?: IntegerLike | null;
  from?: string | null;
  to?: string | null;
  data?: string | null;
  value?: IntegerLike | null;
  nonce?: IntegerLike | null;
}
export interface TransactionReceiptLike {
  hash?: string;
  transactionHash?: string;
  status?: IntegerLike | null;
  blockNumber?: number;
}
export interface TransactionResponseLike<TReceipt extends TransactionReceiptLike = TransactionReceiptLike> extends TransactionScope {
  hash: string;
  wait(confirmations?: number, timeoutMs?: number): Promise<TReceipt | null>;
  replaceableTransaction?: (fromBlock: number) => TransactionResponseLike<TReceipt>;
}
export type ConfirmationFailure = "read" | "mismatch";
export interface TransactionErrorContext {
  transactionHash?: string;
  transactionConfirmed?: boolean;
  verificationFailure?: ConfirmationFailure;
}
