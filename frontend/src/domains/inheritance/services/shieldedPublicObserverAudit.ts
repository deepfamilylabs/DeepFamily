import { SHIELDED_POOL_ACTION } from "@deepfamily/protocol-core";

type ShieldedAction = (typeof SHIELDED_POOL_ACTION)[keyof typeof SHIELDED_POOL_ACTION];

export type PublicNoteOutput = {
  commitment: bigint;
  shardId: bigint;
};

/**
 * One successful pool action, in chain order. `outputs[0]` and
 * `outputs[1]` are the two NoteAppended events after its ActionExecuted event.
 * `inputShardIds` come from that same public action boundary.
 */
export type PublicPoolActionObservation = {
  txHash: string;
  /** Log index of ActionExecuted, needed when a transaction invokes the pool more than once. */
  actionLogIndex?: number;
  action: ShieldedAction;
  inputShardIds: readonly [bigint, bigint];
  outputs: readonly [PublicNoteOutput, PublicNoteOutput];
};

export type KnownFundingClaimLink = {
  verdict: "directly-linkable" | "not-established" | "incomplete-history";
  claimTxHash: string;
  claimActionLogIndex?: number;
  claimInputShardIds: readonly [bigint, bigint];
  knownFundingCommitment: bigint;
  /** Conservative inventory of all budget-shaped outputs before the claim in this shard. */
  candidateBudgetCommitments: bigint[];
};

const BUDGET_OUTPUT_ACTIONS = new Set<ShieldedAction>([
  SHIELDED_POOL_ACTION.Fund,
  SHIELDED_POOL_ACTION.Claim,
]);

/**
 * Check a narrow public-data inference, not a general anonymity guarantee.
 * The circuits make output slot 0 a budget note for the actions above. A
 * successful Claim publicly exposes both input shard slots, which may differ.
 * If every budget-shaped note ever appended to those shards before this claim is
 * known to belong to the same child as initial funding, an observer can
 * identify the child even when additional funding creates another possible budget input.
 *
 * Feed this only complete, chain-ordered, receipt-verified pool transactions
 * through the target claim. The caller should reconcile all NoteAppended logs
 * and shard roots first. A result of `not-established` does not imply privacy:
 * timing, wallet reuse, nullifier knowledge, or other side information may link
 * the claim. `knownChildBudgetCommitments` is observer-supplied knowledge: only
 * include commitments whose child ownership the observer can substantiate.
 * This inventory intentionally keeps earlier budget outputs even
 * when they may have been spent, so it cannot undercount candidates by guessing
 * secret nullifier-to-note relationships.
 */
export function auditKnownFundingClaimLink(input: {
  actions: readonly PublicPoolActionObservation[];
  knownFundingCommitment: bigint;
  /** Additional budgets known to belong to the initial funding's child. */
  knownChildBudgetCommitments?: readonly bigint[];
  claimTxHash: string;
  /** Required only if the same transaction contains multiple Claim actions. */
  claimActionLogIndex?: number;
  historyVerifiedFromDeployment: boolean;
}): KnownFundingClaimLink {
  const claims = input.actions.flatMap((action, index) =>
    action.txHash === input.claimTxHash &&
    action.action === SHIELDED_POOL_ACTION.Claim &&
    (input.claimActionLogIndex === undefined || action.actionLogIndex === input.claimActionLogIndex)
      ? [index]
      : [],
  );
  if (claims.length === 0) throw new Error("Target claim is absent from public action history");
  if (claims.length > 1) {
    throw new Error("Multiple claims share this transaction; provide claimActionLogIndex");
  }
  const claimIndex = claims[0];
  const claim = input.actions[claimIndex];
  const priorActions = input.actions.slice(0, claimIndex);
  const funding = priorActions.find(
    (action) =>
      action.action === SHIELDED_POOL_ACTION.Fund &&
      action.outputs[0].commitment === input.knownFundingCommitment,
  );
  if (!funding) throw new Error("Known commitment is not an earlier funding output");

  const candidateBudgetCommitments = priorActions
    .filter(
      (action) =>
        BUDGET_OUTPUT_ACTIONS.has(action.action) &&
        claim.inputShardIds.includes(action.outputs[0].shardId),
    )
    .map((action) => action.outputs[0].commitment);
  const knownChildBudgets = new Set([
    input.knownFundingCommitment,
    ...(input.knownChildBudgetCommitments ?? []),
  ]);
  return {
    verdict: !input.historyVerifiedFromDeployment
      ? "incomplete-history"
      : candidateBudgetCommitments.length > 0 &&
          candidateBudgetCommitments.every((commitment) => knownChildBudgets.has(commitment))
        ? "directly-linkable"
        : "not-established",
    claimTxHash: input.claimTxHash,
    ...(claim.actionLogIndex === undefined ? {} : { claimActionLogIndex: claim.actionLogIndex }),
    claimInputShardIds: claim.inputShardIds,
    knownFundingCommitment: input.knownFundingCommitment,
    candidateBudgetCommitments,
  };
}
