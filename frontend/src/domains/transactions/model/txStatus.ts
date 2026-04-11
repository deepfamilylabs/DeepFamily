/**
 * Unified transaction flow state model.
 *
 * All transaction flows (endorse, mint, addVersion, addStoryChunk, sealStory)
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

export type TxFlowState<TResult = unknown, TError = TxFlowError> = {
  status: TxFlowStatus;
  /** Human-readable description of the current step, suitable for UI display. */
  stepMessage: string | null;
  error: TError | null;
  txHash: string | null;
  receipt: unknown | null;
  result: TResult | null;
};

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
