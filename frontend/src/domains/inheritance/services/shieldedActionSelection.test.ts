import { describe, expect, it } from "vitest";
import {
  computeShieldedPeriodNullifier,
  getShieldedBudgetCommitments,
  DEFAULT_SHIELDED_PERIOD_DAYS,
  SECONDS_PER_DAY,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import {
  getShieldedClaimBudgetKey,
  nextClaimPeriods,
  selectClaimBudget,
  type ShieldedSelectableBudgetNote,
} from "./shieldedActionSelection";

const scope = { chainId: 1030n, poolAddress: "0x0000000000000000000000000000000000000001" };

type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget"; binding?: "owner" }>;
const secret = "987654321";
const eligibleFrom = 1_000n;

function publicNote(commitment: bigint) {
  return {
    commitment,
    shardId: 0n,
    leafIndex: commitment,
    root: 999n,
    ciphertext: new Uint8Array(),
    ciphertextHashField: 123n,
    blockNumber: 1,
    logIndex: Number(commitment),
  };
}

function value(commitment: bigint, amount: bigint) {
  return {
    ...publicNote(commitment),
    note: { kind: "value" as const, ownerCommitment: 444n, amount, nonce: commitment },
  };
}

function budget(
  commitment: bigint,
  overrides: Partial<BudgetPayload> = {},
): ShieldedSelectableBudgetNote {
  return {
    ...publicNote(commitment),
    note: {
      kind: "budget",
      budgetOrigin: 0n,
      rootIdentityCommitment: 111n,
      rootVersionIndex: 3n,
      policySalt: 222n,
      allocationKeyCommitment: 333n,
      heirIdentityCommitment: 444n,
      eligibleFrom,
      enrollmentSalt: 555n,
      heirOwnerCommitment: 666n,
      amountPerPeriod: 100n,
      periodDays: 30n,
      remaining: 1_200n,
      nonce: commitment,
      ...overrides,
    },
  };
}

function spentPeriod(
  note: Extract<DecodedShieldedNotePayload, { kind: "budget" }>,
  periodIndex: bigint,
): bigint {
  return computeShieldedPeriodNullifier(
    {
      derivedSecretField: secret,
      policyCommitment: getShieldedBudgetCommitments(note, scope).policyCommitment,
      periodIndex,
    },
    scope,
  );
}

describe("automatic shielded claim selection", () => {
  it("uses the wallet's chain and pool for rule keys and already claimed periods", () => {
    const note = budget(1n, { remaining: 100n });
    const now = eligibleFrom + DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY;
    const spentNullifiers = new Set([spentPeriod(note.note, 0n)]);
    expect(selectClaimBudget([note], { ...scope, spentNullifiers }, secret, now)).toBeUndefined();
    for (const alternative of [
      { ...scope, chainId: 71n },
      { ...scope, poolAddress: "0x0000000000000000000000000000000000000002" },
    ]) {
      expect(getShieldedClaimBudgetKey(note.note, alternative)).not.toBe(
        getShieldedClaimBudgetKey(note.note, scope),
      );
      expect(
        selectClaimBudget([note], { ...alternative, spentNullifiers }, secret, now)?.periodIndices,
      ).toEqual([0n]);
    }
  });

  it("selects only whole due periods and caps a claim at the funded whole periods", () => {
    const note = budget(1n, { remaining: 300n });
    const wallet = { ...scope, spentNullifiers: new Set<bigint>() };
    expect(
      selectClaimBudget(
        [note],
        wallet,
        secret,
        eligibleFrom + DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY - 1n,
      ),
    ).toBeUndefined();
    expect(
      nextClaimPeriods(
        wallet,
        secret,
        note.note,
        eligibleFrom + DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY,
      ),
    ).toEqual([0n]);
    expect(
      nextClaimPeriods(
        wallet,
        secret,
        note.note,
        eligibleFrom + 5n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
      ),
    ).toEqual([0n, 1n, 2n]);
  });

  it("skips previously claimed period nullifiers without changing the wallet", () => {
    const note = budget(1n, { remaining: 300n });
    const wallet = {
      ...scope,
      spentNullifiers: new Set([spentPeriod(note.note, 0n), spentPeriod(note.note, 2n)]),
    };
    const original = new Set(wallet.spentNullifiers);
    const selected = selectClaimBudget(
      [note],
      wallet,
      secret,
      eligibleFrom + 5n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
    );
    expect(selected?.budget).toBe(note);
    expect(selected?.periodIndices).toEqual([1n, 3n, 4n]);
    expect(wallet.spentNullifiers).toEqual(original);
  });

  it("selects two compatible budgets when they can pay more due periods", () => {
    const first = budget(1n, { remaining: 100n });
    const second = budget(2n, { remaining: 200n });
    const selected = selectClaimBudget(
      [first, second],
      { ...scope, spentNullifiers: new Set() },
      secret,
      eligibleFrom + 4n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
    );
    expect(selected?.budget).toBe(first);
    expect(selected?.secondBudget).toBe(second);
    expect(selected?.periodIndices).toEqual([0n, 1n, 2n]);
    expect(
      selectClaimBudget(
        [first, second],
        { ...scope, spentNullifiers: new Set() },
        secret,
        eligibleFrom + DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY,
      )?.secondBudget,
    ).toBeUndefined();
    expect(
      selectClaimBudget(
        [first, budget(2n, { remaining: 200n, enrollmentSalt: 999n })],
        { ...scope, spentNullifiers: new Set() },
        secret,
        eligibleFrom + 4n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
      )?.secondBudget,
    ).toBeUndefined();
  });

  it("limits one automatic claim to the circuit's three period slots", () => {
    const note = budget(1n, { remaining: 5_000n });
    expect(
      nextClaimPeriods(
        { ...scope, spentNullifiers: new Set() },
        secret,
        note.note,
        eligibleFrom + 50n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY),
      ),
    ).toEqual(Array.from({ length: 3 }, (_, index) => BigInt(index)));
  });

  it("finds a payable rule after exhausted, immature and fully claimed budgets", () => {
    const now = eligibleFrom + 2n * (DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY);
    const claimed = budget(2n, { policySalt: 999n, eligibleFrom: eligibleFrom - 1n });
    const payable = budget(4n);
    const wallet = {
      ...scope,
      spentNullifiers: new Set([spentPeriod(claimed.note, 0n), spentPeriod(claimed.note, 1n)]),
    };
    const notes = [
      budget(1n, { remaining: 0n }),
      claimed,
      budget(3n, { eligibleFrom: now }),
      payable,
      value(5n, 100n),
    ];
    expect(selectClaimBudget(notes, wallet, secret, now)?.budget).toBe(payable);
    expect(selectClaimBudget([...notes].reverse(), wallet, secret, now)?.budget).toBe(payable);
  });

  it("reports no payable selection when every due period is spent and explains manual failures", () => {
    const note = budget(1n);
    const wallet = { ...scope, spentNullifiers: new Set([spentPeriod(note.note, 0n)]) };
    const now = eligibleFrom + DEFAULT_SHIELDED_PERIOD_DAYS * SECONDS_PER_DAY;
    expect(selectClaimBudget([note], wallet, secret, now)).toBeUndefined();
    expect(() => nextClaimPeriods(wallet, secret, note.note, now)).toThrow(
      "No unclaimed due period",
    );
    expect(() => nextClaimPeriods(wallet, secret, note.note, now - 1n)).toThrow("No whole period");
    expect(() => nextClaimPeriods(wallet, secret, budget(2n, { remaining: 0n }).note, now)).toThrow(
      "cannot pay a whole period",
    );
  });
});
