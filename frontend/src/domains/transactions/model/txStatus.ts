/**
 * Unified transaction flow state model.
 *
 * All transaction flows (endorse, mint, addVersion, addStoryRecord, sealStory)
 * expose their state through this type. UI components consume `status` and
 * `stepMessage` to render progress, and `error` / `result` for outcomes.
 */

export type TxFlowStatus =
  | "idle"
  | "validating"
  | "simulating"
  | "approving"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

export type TxFlowProgressStatus = Exclude<TxFlowStatus, "idle" | "success" | "error">;

export type TransactionTracking =
  | { state: "none" }
  | { state: "submitted"; transactionHash: string }
  | { state: "confirmed"; transactionHash: string; receipt?: import("@deepfamily/chain-client").TransactionReceiptLike };

type TxFlowCommon = { stepMessage: string | null; tracking: TransactionTracking };

export type TxFlowState<TResult = unknown, TError = TxFlowError> = TxFlowCommon & (
  | { status: "idle" | TxFlowProgressStatus; error: null; result: null }
  | { status: "success"; error: null; result: TResult }
  | { status: "error"; error: TError; result: null }
);

export type TxFlowActions<TArgs extends unknown[] = unknown[], TResult = unknown> = {
  /** Reset the flow to idle state. */
  reset: () => void;
  /** Execute the transaction flow. */
  run: (...args: TArgs) => Promise<void>;
  /** Execute the transaction flow and resolve/reject with the runner result. */
  runOrThrow: (...args: TArgs) => Promise<TResult>;
};

export type TxFlowError = {
  /** Error classification (e.g. "UserRejected", "InsufficientFunds", "ContractRevert"). */
  type: string;
  /** Human-readable error message. */
  message: string;
  /** Technical details for debugging. */
  details?: string;
  /** Decoded revert reason, if available. */
  reason?: string;
};

export function trackedTransactionHash(tracking: TransactionTracking | undefined): string | undefined {
  return tracking && tracking.state !== "none" ? tracking.transactionHash : undefined;
}
