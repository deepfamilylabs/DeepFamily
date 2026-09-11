/**
 * What a transaction modal is doing right now.
 *
 * Every modal answers the same five-way question in three places — which form
 * sections stand, what the status area renders, which buttons the footer shows.
 * Deriving it independently in each is what let four consecutive states go
 * unnoticed, so the priority order lives here and nowhere else, and every
 * consumer switches on the result with a `never` check to make a newly added
 * phase a compile error rather than a silent fall-through.
 */
export type TransactionPhase =
  /** The user's turn: the form is the subject. */
  | "form"
  /** Working, with nothing for the user to do but wait. */
  | "busy"
  /** A frozen wallet-bound package is waiting for a decision. */
  | "review"
  /** Finished; the result is the subject. */
  | "done"
  /** Failed; the form stays up to be corrected. */
  | "failed"
  /** This target cannot proceed at all; only the target picker is useful. */
  | "blocked";

export function resolveTransactionPhase(input: {
  successResult: unknown;
  errorResult: unknown;
  transactionPreview?: unknown;
  isBusy: boolean;
  isBlocked?: boolean;
}): TransactionPhase {
  if (input.successResult) return "done";
  if (input.errorResult) return "failed";
  if (input.transactionPreview) return "review";
  if (input.isBusy) return "busy";
  if (input.isBlocked) return "blocked";
  return "form";
}

/** Marks a switch over `TransactionPhase` as total. */
export function assertPhaseHandled(phase: never): never {
  throw new Error(`Unhandled transaction phase: ${String(phase)}`);
}
