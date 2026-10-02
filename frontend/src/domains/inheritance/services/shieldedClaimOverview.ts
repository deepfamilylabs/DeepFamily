import {
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  INHERITANCE_PERIOD_SECONDS,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { BigNumberish } from "ethers";
import { selectClaimBudget, type ShieldedSelectableBudgetNote } from "./shieldedActionSelection";
import type { OwnedShieldedNote } from "./shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type PeriodWallet = Pick<LocalShieldedWalletSnapshot, "spentNullifiers">;

export type ShieldedClaimOverview = {
  status: "claimable" | "notDue" | "exhausted" | "noFunds" | "scanLimited";
  /** All valid, eligible, unspent budget balances; this is not a one-click payout. */
  totalRemaining: bigint;
  /** Exactly the budget and period batch used by automatic claim selection. */
  claim?: {
    budget: ShieldedSelectableBudgetNote;
    secondBudget?: ShieldedSelectableBudgetNote;
    periodIndices: bigint[];
    amount: bigint;
  };
  /** Earliest future unpaid period that the available budgets can still fund. */
  nextDueAt?: bigint;
  /** A capped search left the future schedule or automatic selection unknown. */
  scanLimited: boolean;
};

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
// Match nextClaimPeriods' automatic search; dates beyond it must stay unknown.
export const SHIELDED_CLAIM_OVERVIEW_SCAN_LIMIT = 100_000n;

type PolicyFunding = {
  policyCommitment: bigint;
  eligibleFrom: bigint;
  fundedPeriods: bigint;
  mixedStartTimes: boolean;
};

function validBudget(note: Note): note is ShieldedSelectableBudgetNote {
  if (note.note.kind !== "budget") return false;
  const { amountPerPeriod, remaining, eligibleFrom } = note.note;
  return (
    amountPerPeriod > 0n &&
    amountPerPeriod <= MAX_UINT128 &&
    remaining >= 0n &&
    remaining <= MAX_UINT128 &&
    remaining % amountPerPeriod === 0n &&
    remaining / amountPerPeriod <= MAX_UINT64 &&
    eligibleFrom >= 0n &&
    eligibleFrom <= MAX_UINT64
  );
}

function futureFundedPeriod(
  funding: PolicyFunding,
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  now: bigint,
): { nextDueAt?: bigint; scanLimited: boolean } {
  const elapsed = now - funding.eligibleFrom;
  const dueCount = elapsed > 0n ? elapsed / INHERITANCE_PERIOD_SECONDS : 0n;
  // Every spent period needs its own nullifier. This lower bound avoids walking
  // huge old clocks when all remaining funds are already needed by due periods.
  if (dueCount - BigInt(wallet.spentNullifiers.size) >= funding.fundedPeriods) {
    return { scanLimited: false };
  }

  let unpaidDuePeriods = 0n;
  for (let index = 0n; index < SHIELDED_CLAIM_OVERVIEW_SCAN_LIMIT; index += 1n) {
    const dueAt = funding.eligibleFrom + (index + 1n) * INHERITANCE_PERIOD_SECONDS;
    if (dueAt > MAX_UINT64) return { scanLimited: false };
    const nullifier = computeShieldedPeriodNullifier({
      derivedSecretField,
      policyCommitment: funding.policyCommitment,
      periodIndex: index,
    });
    if (wallet.spentNullifiers.has(nullifier)) continue;
    if (dueAt > now) return { nextDueAt: dueAt, scanLimited: false };
    unpaidDuePeriods += 1n;
    if (unpaidDuePeriods >= funding.fundedPeriods) return { scanLimited: false };
  }
  return { scanLimited: true };
}

/**
 * Summarize already recovered, unspent budget notes after the caller filters
 * current lineage eligibility. No secrets or plaintext are persisted or sent
 * anywhere. Multiple budgets for one policy share one enrollment and period
 * nullifier sequence, so their future funding is evaluated together.
 */
export function getShieldedClaimOverview(
  notes: readonly Note[],
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  now: bigint,
): ShieldedClaimOverview {
  if (now < 0n || now > MAX_UINT64) throw new RangeError("Claim timestamp must fit in uint64");
  const budgets = [
    ...new Map(notes.filter(validBudget).map((budget) => [budget.commitment, budget])).values(),
  ];
  const totalRemaining = budgets.reduce((sum, budget) => sum + budget.note.remaining, 0n);
  if (!budgets.length || totalRemaining === 0n) {
    return {
      status: budgets.length ? "exhausted" : "noFunds",
      totalRemaining,
      scanLimited: false,
    };
  }

  const automatic = selectClaimBudget(budgets, wallet, derivedSecretField, now);
  const claim = automatic
    ? {
        ...automatic,
        amount: automatic.budget.note.amountPerPeriod * BigInt(automatic.periodIndices.length),
      }
    : undefined;
  const policies = new Map<bigint, PolicyFunding>();
  for (const budget of budgets) {
    if (budget.note.remaining === 0n) continue;
    const policyCommitment = computeShieldedPolicyCommitment(budget.note);
    const previous = policies.get(policyCommitment);
    policies.set(policyCommitment, {
      policyCommitment,
      eligibleFrom: previous?.eligibleFrom ?? budget.note.eligibleFrom,
      fundedPeriods:
        (previous?.fundedPeriods ?? 0n) + budget.note.remaining / budget.note.amountPerPeriod,
      mixedStartTimes:
        !!previous?.mixedStartTimes ||
        (previous !== undefined && previous.eligibleFrom !== budget.note.eligibleFrom),
    });
  }

  let nextDueAt: bigint | undefined;
  let scanLimited = false;
  for (const funding of policies.values()) {
    // Distinct initial allocations under one policy can start on different
    // dates while sharing the period-nullifier sequence. A single date would
    // claim more certainty than the wallet snapshot provides.
    if (funding.mixedStartTimes) {
      scanLimited = true;
      continue;
    }
    const future = futureFundedPeriod(funding, wallet, derivedSecretField, now);
    scanLimited ||= future.scanLimited;
    if (
      future.nextDueAt !== undefined &&
      (nextDueAt === undefined || future.nextDueAt < nextDueAt)
    ) {
      nextDueAt = future.nextDueAt;
    }
  }
  // A different capped policy may have an earlier future slot. Keep the date
  // unknown instead of presenting a partial result as the earliest date.
  if (scanLimited) nextDueAt = undefined;
  return {
    status: claim ? "claimable" : scanLimited ? "scanLimited" : "notDue",
    totalRemaining,
    claim,
    nextDueAt,
    scanLimited,
  };
}
