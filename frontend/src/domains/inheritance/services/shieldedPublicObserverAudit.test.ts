import { describe, expect, it } from "vitest";
import { SHIELDED_POOL_ACTION } from "@deepfamily/protocol-core";
import {
  auditKnownFundingClaimLink,
  type PublicPoolActionObservation,
} from "./shieldedPublicObserverAudit";

const shield: PublicPoolActionObservation = {
  txHash: "shield",
  action: SHIELDED_POOL_ACTION.Shield,
  inputShardIds: [0n, 0n],
  outputs: [
    { commitment: 11n, shardId: 0n },
    { commitment: 12n, shardId: 0n },
  ],
};
const funding: PublicPoolActionObservation = {
  txHash: "funding",
  action: SHIELDED_POOL_ACTION.Fund,
  inputShardIds: [0n, 0n],
  outputs: [
    { commitment: 101n, shardId: 0n },
    { commitment: 102n, shardId: 0n },
  ],
};
const claim: PublicPoolActionObservation = {
  txHash: "claim",
  action: SHIELDED_POOL_ACTION.Claim,
  inputShardIds: [0n, 0n],
  outputs: [
    { commitment: 201n, shardId: 0n },
    { commitment: 202n, shardId: 0n },
  ],
};

function audit(
  actions: readonly PublicPoolActionObservation[],
  historyVerifiedFromDeployment = true,
) {
  return auditKnownFundingClaimLink({
    actions,
    knownFundingCommitment: 101n,
    claimTxHash: "claim",
    historyVerifiedFromDeployment,
  });
}

describe("public observer linkability audit", () => {
  it("links a claim to a known funding when its shard has one budget candidate", () => {
    const result = audit([shield, funding, claim]);
    expect(result).toEqual({
      verdict: "directly-linkable",
      claimTxHash: "claim",
      claimInputShardIds: [0n, 0n],
      knownFundingCommitment: 101n,
      candidateBudgetCommitments: [101n],
    });
  });

  it("counts another budget in the same shard and makes no anonymity claim", () => {
    const otherFunding: PublicPoolActionObservation = {
      ...funding,
      txHash: "other-fund",
      outputs: [
        { commitment: 301n, shardId: 0n },
        { commitment: 302n, shardId: 0n },
      ],
    };
    const result = audit([shield, funding, otherFunding, claim]);
    expect(result.verdict).toBe("not-established");
    expect(result.candidateBudgetCommitments).toEqual([101n, 301n]);
  });

  it("links a claim when all same-shard budgets are known to be for the same child", () => {
    const sameChildAdditionalFunding: PublicPoolActionObservation = {
      ...funding,
      txHash: "same-child-additional-fund",
      action: SHIELDED_POOL_ACTION.Fund,
      outputs: [
        { commitment: 301n, shardId: 0n },
        { commitment: 302n, shardId: 0n },
      ],
    };
    const actions = [shield, funding, sameChildAdditionalFunding, claim];
    const result = auditKnownFundingClaimLink({
      actions,
      knownFundingCommitment: 101n,
      knownChildBudgetCommitments: [301n],
      claimTxHash: "claim",
      historyVerifiedFromDeployment: true,
    });
    expect(result.verdict).toBe("directly-linkable");
    expect(result.candidateBudgetCommitments).toEqual([101n, 301n]);

    const unknownChildFunding: PublicPoolActionObservation = {
      ...funding,
      txHash: "unknown-child-fund",
      outputs: [
        { commitment: 401n, shardId: 0n },
        { commitment: 402n, shardId: 0n },
      ],
    };
    const withUnknownChild = auditKnownFundingClaimLink({
      actions: [shield, funding, sameChildAdditionalFunding, unknownChildFunding, claim],
      knownFundingCommitment: 101n,
      knownChildBudgetCommitments: [301n],
      claimTxHash: "claim",
      historyVerifiedFromDeployment: true,
    });
    expect(withUnknownChild.verdict).toBe("not-established");
    expect(withUnknownChild.candidateBudgetCommitments).toEqual([101n, 301n, 401n]);
  });

  it("counts only the claim input shard, including budget continuations", () => {
    const otherShardBudget: PublicPoolActionObservation = {
      ...funding,
      txHash: "other-shard-budget",
      action: SHIELDED_POOL_ACTION.Fund,
      outputs: [
        { commitment: 301n, shardId: 1n },
        { commitment: 302n, shardId: 1n },
      ],
    };
    expect(audit([shield, funding, otherShardBudget, claim]).verdict).toBe("directly-linkable");
    const laterClaim: PublicPoolActionObservation = {
      ...claim,
      txHash: "later-claim",
      outputs: [
        { commitment: 401n, shardId: 0n },
        { commitment: 402n, shardId: 0n },
      ],
    };
    const afterFirstClaim = auditKnownFundingClaimLink({
      actions: [shield, funding, claim, laterClaim],
      knownFundingCommitment: 101n,
      claimTxHash: "later-claim",
      historyVerifiedFromDeployment: true,
    });
    expect(afterFirstClaim.verdict).toBe("not-established");
    expect(afterFirstClaim.candidateBudgetCommitments).toEqual([101n, 201n]);
  });

  it("refuses a unique-link conclusion without complete verified history", () => {
    expect(audit([shield, funding, claim], false).verdict).toBe("incomplete-history");
    expect(
      auditKnownFundingClaimLink({
        actions: [shield, funding, claim],
        knownFundingCommitment: 101n,
        knownChildBudgetCommitments: [201n],
        claimTxHash: "claim",
        historyVerifiedFromDeployment: false,
      }).verdict,
    ).toBe("incomplete-history");
    expect(() => audit([shield, claim])).toThrow("earlier funding output");
    expect(() => audit([shield, funding, { ...claim, inputShardIds: [0n, 1n] }])).not.toThrow();
  });
});
