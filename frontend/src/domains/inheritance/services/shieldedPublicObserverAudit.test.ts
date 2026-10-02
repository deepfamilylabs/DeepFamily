import { describe, expect, it } from "vitest";
import { SHIELDED_POOL_ACTION } from "@deepfamily/protocol-core";
import {
  auditKnownAllocationClaimLink,
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
const policy: PublicPoolActionObservation = {
  txHash: "policy",
  action: SHIELDED_POOL_ACTION.PrivateTransfer,
  inputShardIds: [0n, 0n],
  outputs: [
    { commitment: 21n, shardId: 0n },
    { commitment: 22n, shardId: 0n },
  ],
};
const allocation: PublicPoolActionObservation = {
  txHash: "allocation",
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
  return auditKnownAllocationClaimLink({
    actions,
    knownAllocationCommitment: 101n,
    claimTxHash: "claim",
    historyVerifiedFromDeployment,
  });
}

describe("public observer linkability audit", () => {
  it("links a claim to a known allocation when its shard has one budget candidate", () => {
    const result = audit([shield, policy, allocation, claim]);
    expect(result).toEqual({
      verdict: "directly-linkable",
      claimTxHash: "claim",
      claimInputShardId: 0n,
      knownAllocationCommitment: 101n,
      candidateBudgetCommitments: [101n],
    });
  });

  it("counts another budget in the same shard and makes no anonymity claim", () => {
    const otherAllocation: PublicPoolActionObservation = {
      ...allocation,
      txHash: "other-allocation",
      outputs: [
        { commitment: 301n, shardId: 0n },
        { commitment: 302n, shardId: 0n },
      ],
    };
    const result = audit([shield, policy, allocation, otherAllocation, claim]);
    expect(result.verdict).toBe("not-established");
    expect(result.candidateBudgetCommitments).toEqual([101n, 301n]);
  });

  it("links a claim when all same-shard budgets are known to be for the same child", () => {
    const sameChildTopUp: PublicPoolActionObservation = {
      ...allocation,
      txHash: "same-child-top-up",
      action: SHIELDED_POOL_ACTION.Fund,
      outputs: [
        { commitment: 301n, shardId: 0n },
        { commitment: 302n, shardId: 0n },
      ],
    };
    const actions = [shield, policy, allocation, sameChildTopUp, claim];
    const result = auditKnownAllocationClaimLink({
      actions,
      knownAllocationCommitment: 101n,
      knownChildBudgetCommitments: [301n],
      claimTxHash: "claim",
      historyVerifiedFromDeployment: true,
    });
    expect(result.verdict).toBe("directly-linkable");
    expect(result.candidateBudgetCommitments).toEqual([101n, 301n]);

    const unknownChildAllocation: PublicPoolActionObservation = {
      ...allocation,
      txHash: "unknown-child-allocation",
      outputs: [
        { commitment: 401n, shardId: 0n },
        { commitment: 402n, shardId: 0n },
      ],
    };
    const withUnknownChild = auditKnownAllocationClaimLink({
      actions: [shield, policy, allocation, sameChildTopUp, unknownChildAllocation, claim],
      knownAllocationCommitment: 101n,
      knownChildBudgetCommitments: [301n],
      claimTxHash: "claim",
      historyVerifiedFromDeployment: true,
    });
    expect(withUnknownChild.verdict).toBe("not-established");
    expect(withUnknownChild.candidateBudgetCommitments).toEqual([101n, 301n, 401n]);
  });

  it("counts only the claim input shard, including budget continuations", () => {
    const otherShardBudget: PublicPoolActionObservation = {
      ...allocation,
      txHash: "other-shard-budget",
      action: SHIELDED_POOL_ACTION.Fund,
      outputs: [
        { commitment: 301n, shardId: 1n },
        { commitment: 302n, shardId: 1n },
      ],
    };
    expect(audit([shield, policy, allocation, otherShardBudget, claim]).verdict).toBe(
      "directly-linkable",
    );
    const laterClaim: PublicPoolActionObservation = {
      ...claim,
      txHash: "later-claim",
      outputs: [
        { commitment: 401n, shardId: 0n },
        { commitment: 402n, shardId: 0n },
      ],
    };
    const afterFirstClaim = auditKnownAllocationClaimLink({
      actions: [shield, policy, allocation, claim, laterClaim],
      knownAllocationCommitment: 101n,
      claimTxHash: "later-claim",
      historyVerifiedFromDeployment: true,
    });
    expect(afterFirstClaim.verdict).toBe("not-established");
    expect(afterFirstClaim.candidateBudgetCommitments).toEqual([101n, 201n]);
  });

  it("refuses a unique-link conclusion without complete verified history", () => {
    expect(audit([shield, policy, allocation, claim], false).verdict).toBe("incomplete-history");
    expect(
      auditKnownAllocationClaimLink({
        actions: [shield, policy, allocation, claim],
        knownAllocationCommitment: 101n,
        knownChildBudgetCommitments: [201n],
        claimTxHash: "claim",
        historyVerifiedFromDeployment: false,
      }).verdict,
    ).toBe("incomplete-history");
    expect(() => audit([shield, policy, claim])).toThrow("earlier allocation output");
    expect(() =>
      audit([shield, policy, allocation, { ...claim, inputShardIds: [0n, 1n] }]),
    ).not.toThrow();
  });
});
