import { describe, expect, it } from "vitest";
import {
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  INHERITANCE_PERIOD_SECONDS,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { ShieldedSelectableBudgetNote } from "./shieldedActionSelection";
import { getShieldedClaimOverview } from "./shieldedClaimOverview";

type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget" }>;
const secret = "987654321";
const start = 1_000n;
const period = INHERITANCE_PERIOD_SECONDS;

function budget(
  commitment: bigint,
  overrides: Partial<BudgetPayload> = {},
): ShieldedSelectableBudgetNote {
  return {
    commitment,
    shardId: 0n,
    leafIndex: commitment,
    root: 999n,
    ciphertext: new Uint8Array(),
    ciphertextHashField: 123n,
    blockNumber: 1,
    logIndex: Number(commitment),
    note: {
      kind: "budget",
      rootIdentityCommitment: 111n,
      rootVersionIndex: 3n,
      policySalt: 222n,
      allocationKeyCommitment: 333n,
      heirIdentityCommitment: 444n,
      eligibleFrom: start,
      enrollmentSalt: 555n,
      heirOwnerCommitment: 666n,
      amountPerPeriod: 100n,
      remaining: 300n,
      nonce: commitment,
      ...overrides,
    },
  };
}

function spent(note: BudgetPayload, index: bigint): bigint {
  return computeShieldedPeriodNullifier({
    derivedSecretField: secret,
    policyCommitment: computeShieldedPolicyCommitment(note),
    periodIndex: index,
  });
}

describe("shielded claim overview", () => {
  it("shows the first future due date without counting funds as claimable early", () => {
    const note = budget(1n);
    const result = getShieldedClaimOverview(
      [note],
      { spentNullifiers: new Set() },
      secret,
      start + period - 1n,
    );
    expect(result.status).toBe("notDue");
    expect(result.totalRemaining).toBe(300n);
    expect(result.claim).toBeUndefined();
    expect(result.nextDueAt).toBe(start + period);
  });

  it("shows exactly the amount and periods of the automatic next claim", () => {
    const note = budget(1n);
    const result = getShieldedClaimOverview(
      [note],
      { spentNullifiers: new Set() },
      secret,
      start + 2n * period,
    );
    expect(result.claim).toEqual({ budget: note, periodIndices: [0n, 1n], amount: 200n });
    expect(result.nextDueAt).toBe(start + 3n * period);
  });

  it("skips paid periods shared across budgets and deduplicates budget commitments", () => {
    const first = budget(1n, { remaining: 100n });
    const second = budget(2n, { remaining: 100n });
    const wallet = { spentNullifiers: new Set([spent(first.note, 0n)]) };
    const result = getShieldedClaimOverview(
      [first, { ...first }, second],
      wallet,
      secret,
      start + period,
    );
    expect(result.totalRemaining).toBe(200n);
    expect(result.claim).toBeUndefined();
    expect(result.nextDueAt).toBe(start + 2n * period);
  });

  it("does not invent a next date when allocations sharing a policy started on different days", () => {
    const first = budget(1n, { remaining: 100n });
    const later = budget(2n, { remaining: 100n, eligibleFrom: start + 10n * period });
    const wallet = { spentNullifiers: new Set([spent(first.note, 0n)]) };
    const result = getShieldedClaimOverview([first, later], wallet, secret, start + 2n * period);
    expect(result.status).toBe("claimable");
    expect(result.scanLimited).toBe(true);
    expect(result.nextDueAt).toBeUndefined();
  });

  it("keeps no funds, exhausted funds, and invalid budgets distinct", () => {
    const wallet = { spentNullifiers: new Set<bigint>() };
    expect(getShieldedClaimOverview([], wallet, secret, start).status).toBe("noFunds");
    expect(
      getShieldedClaimOverview([budget(1n, { remaining: 0n })], wallet, secret, start).status,
    ).toBe("exhausted");
    expect(
      getShieldedClaimOverview([budget(2n, { amountPerPeriod: 0n })], wallet, secret, start).status,
    ).toBe("noFunds");
  });
});
