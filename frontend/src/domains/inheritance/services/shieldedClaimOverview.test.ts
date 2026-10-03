import { describe, expect, it } from "vitest";
import {
  computeShieldedPeriodNullifier,
  getShieldedBudgetCommitments,
  INHERITANCE_PERIOD_SECONDS,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { ShieldedSelectableBudgetNote } from "./shieldedActionSelection";
import { getShieldedClaimOverview, listShieldedClaimBudgetOptions } from "./shieldedClaimOverview";

type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget"; binding?: "owner" }>;
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

function spent(
  note: Extract<DecodedShieldedNotePayload, { kind: "budget" }>,
  index: bigint,
): bigint {
  return computeShieldedPeriodNullifier({
    derivedSecretField: secret,
    policyCommitment: getShieldedBudgetCommitments(note).policyCommitment,
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

describe("shielded claim budget options", () => {
  it("separates arrangements and start times with stable keys and ordering", () => {
    const first = budget(2n, { remaining: 100n });
    const compatible = budget(3n, { remaining: 200n });
    const otherRule = budget(1n, { policySalt: 223n });
    const later = budget(4n, { eligibleFrom: start + period });
    const wallet = { spentNullifiers: new Set<bigint>() };
    const now = start + 3n * period;
    const result = listShieldedClaimBudgetOptions(
      [later, compatible, otherRule, first],
      wallet,
      secret,
      now,
    );

    expect(result.map((option) => option.notes.map((note) => note.commitment))).toEqual([
      [1n],
      [2n, 3n],
      [4n],
    ]);
    expect(new Set(result.map((option) => option.key)).size).toBe(3);
    expect(result[0].overview.claim?.secondBudget).toBeUndefined();
    expect(result[2].overview.claim?.secondBudget).toBeUndefined();
    expect(
      listShieldedClaimBudgetOptions(
        [first, otherRule, compatible, later],
        wallet,
        secret,
        now,
      ).map((option) => option.key),
    ).toEqual(result.map((option) => option.key));
    expect(
      listShieldedClaimBudgetOptions(
        [budget(99n, { remaining: 500n, nonce: 1_234n })],
        wallet,
        secret,
        now,
      )[0].key,
    ).toBe(result[1].key);
  });

  it("combines compatible fragments with no more than two inputs or twelve periods", () => {
    const first = budget(1n, { remaining: 600n });
    const second = budget(2n, { remaining: 600n });
    const third = budget(3n, { remaining: 600n });
    const result = listShieldedClaimBudgetOptions(
      [
        third,
        second,
        first,
        { ...first },
        budget(4n, { remaining: 0n }),
        budget(5n, { remaining: 99n }),
        budget(6n, { amountPerPeriod: 0n }),
      ],
      { spentNullifiers: new Set() },
      secret,
      start + 20n * period,
    );

    expect(result).toHaveLength(1);
    expect(result[0].notes).toEqual([first, second, third]);
    expect(result[0].overview.totalRemaining).toBe(1_800n);
    expect(result[0].overview.claim).toEqual({
      budget: first,
      secondBudget: second,
      periodIndices: Array.from({ length: 12 }, (_, index) => BigInt(index)),
      amount: 1_200n,
    });
  });

  it("only offers unpaid due periods within an arrangement", () => {
    const note = budget(1n, { remaining: 400n });
    const result = listShieldedClaimBudgetOptions(
      [note],
      { spentNullifiers: new Set([spent(note.note, 0n), spent(note.note, 2n)]) },
      secret,
      start + 4n * period,
    );

    expect(result[0].overview.claim).toEqual({
      budget: note,
      periodIndices: [1n, 3n],
      amount: 200n,
    });
  });

  it("groups public and private notes with the same claim arrangement", () => {
    const privateNote = budget(1n, { remaining: 100n });
    const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(
      privateNote.note,
    );
    const publicNote: ShieldedSelectableBudgetNote = {
      ...budget(2n),
      note: {
        kind: "budget",
        binding: "identity",
        policyCommitment,
        enrollmentCommitment,
        rootIdentityCommitment: privateNote.note.rootIdentityCommitment,
        rootVersionIndex: privateNote.note.rootVersionIndex,
        heirIdentityCommitment: privateNote.note.heirIdentityCommitment,
        eligibleFrom: privateNote.note.eligibleFrom,
        amountPerPeriod: privateNote.note.amountPerPeriod,
        remaining: 100n,
        nonce: 2n,
      },
    };
    const wallet = { spentNullifiers: new Set<bigint>() };
    const now = start + 2n * period;
    const result = listShieldedClaimBudgetOptions([publicNote, privateNote], wallet, secret, now);

    expect(result).toHaveLength(1);
    expect(result[0].notes).toEqual([privateNote, publicNote]);
    expect(result[0].key).toBe(
      listShieldedClaimBudgetOptions([publicNote], wallet, secret, now)[0].key,
    );
    expect(result[0].overview.claim).toEqual({
      budget: privateNote,
      secondBudget: publicNote,
      periodIndices: [0n, 1n],
      amount: 200n,
    });
  });
});
