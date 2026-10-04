import {
  computeShieldedPeriodNullifier,
  getShieldedBudgetCommitments,
  SECONDS_PER_DAY,
  type ShieldedScope,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { BigNumberish } from "ethers";
import type { OwnedShieldedNote } from "./shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget" }>;
type PeriodWallet = Pick<
  LocalShieldedWalletSnapshot,
  "spentNullifiers" | "chainId" | "poolAddress"
>;

export type ShieldedSelectableValueNote = OwnedShieldedNote<
  Extract<DecodedShieldedNotePayload, { kind: "value" }>
>;
export type ShieldedSelectableBudgetNote = OwnedShieldedNote<BudgetPayload>;

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_AUTOMATIC_PERIOD_SCAN = 100_000n;

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueNotes<T extends Note>(notes: readonly T[]): T[] {
  return [...new Map(notes.map((note) => [note.commitment, note])).values()];
}

function orderedPair<T extends Note>(a: T, b: T): [T, T] {
  return a.commitment < b.commitment ? [a, b] : [b, a];
}

function comparePairs<T extends Note>(a: readonly [T, T], b: readonly [T, T]): number {
  return (
    compareBigInt(a[0].commitment, b[0].commitment) ||
    compareBigInt(a[1].commitment, b[1].commitment)
  );
}

/**
 * Choose from locally recovered, unspent notes. Prefer the smallest sufficient
 * single note, then the smallest sufficient two-note total when allowed.
 * Ties use commitment order, independently of the wallet's replay order.
 */
export function selectValueNotes(
  notes: readonly Note[],
  amount: bigint,
  maxInputs: 1 | 2 = 1,
): ShieldedSelectableValueNote[] | undefined {
  if (amount <= 0n || amount > MAX_UINT128) return undefined;
  const values = uniqueNotes(
    notes.filter(
      (note): note is ShieldedSelectableValueNote =>
        note.note.kind === "value" && note.note.amount > 0n,
    ),
  ).sort(
    (a, b) =>
      compareBigInt(a.note.amount, b.note.amount) || compareBigInt(a.commitment, b.commitment),
  );
  const single = values.find((note) => note.note.amount >= amount);
  if (single) return [single];
  if (maxInputs !== 2) return undefined;

  let best: [ShieldedSelectableValueNote, ShieldedSelectableValueNote] | undefined;
  let bestTotal: bigint | undefined;
  for (let index = 0; index < values.length - 1; index += 1) {
    const first = values[index];
    const needed = amount - first.note.amount;
    // Find the smallest sufficient partner without an exhaustive pair walk.
    let low = index + 1;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle].note.amount < needed) low = middle + 1;
      else high = middle;
    }
    const second = values[low];
    if (!second) continue;
    const total = first.note.amount + second.note.amount;
    const pair = orderedPair(first, second);
    if (
      bestTotal === undefined ||
      total < bestTotal ||
      (total === bestTotal && best && comparePairs(pair, best) < 0)
    ) {
      best = pair;
      bestTotal = total;
    }
  }
  return best;
}

/** Stable key for budget notes that may fund a single claim together. */
export function getShieldedClaimBudgetKey(note: BudgetPayload, scope: ShieldedScope): string {
  const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(note, scope);
  return [
    policyCommitment,
    enrollmentCommitment,
    note.rootIdentityCommitment,
    note.rootVersionIndex,
    note.heirIdentityCommitment,
    note.eligibleFrom,
    note.amountPerPeriod,
    note.periodDays,
  ]
    .map(String)
    .join(":");
}

function findClaimPeriods(
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  budget: BudgetPayload,
  now: bigint,
): bigint[] {
  const elapsed = now - budget.eligibleFrom;
  if (
    typeof budget.periodDays !== "bigint" ||
    budget.periodDays < 1n ||
    budget.periodDays > MAX_UINT32
  )
    return [];
  const periodSeconds = budget.periodDays * SECONDS_PER_DAY;
  if (elapsed < periodSeconds || budget.amountPerPeriod <= 0n) return [];
  const fundedCount = budget.remaining / budget.amountPerPeriod;
  const target = Number(fundedCount < 12n ? fundedCount : 12n);
  if (target < 1) return [];
  const dueCount = elapsed / periodSeconds;
  const policyCommitment = getShieldedBudgetCommitments(budget, wallet).policyCommitment;
  const result: bigint[] = [];
  const scanLimit = dueCount < MAX_AUTOMATIC_PERIOD_SCAN ? dueCount : MAX_AUTOMATIC_PERIOD_SCAN;
  for (let index = 0n; index < scanLimit && result.length < target; index += 1n) {
    const nullifier = computeShieldedPeriodNullifier(
      {
        derivedSecretField,
        policyCommitment,
        periodIndex: index,
      },
      wallet,
    );
    if (!wallet.spentNullifiers.has(nullifier)) result.push(index);
  }
  return result;
}

/** Select at most 12 earliest due periods, excluding locally replayed spent nullifiers. */
export function nextClaimPeriods(
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  budget: BudgetPayload,
  now: bigint,
): bigint[] {
  if (
    typeof budget.periodDays !== "bigint" ||
    budget.periodDays < 1n ||
    budget.periodDays > MAX_UINT32
  ) {
    throw new Error("Budget period days must be a positive uint32");
  }
  if (now - budget.eligibleFrom < budget.periodDays * SECONDS_PER_DAY) {
    throw new Error("No whole period is due yet");
  }
  if (budget.amountPerPeriod <= 0n || budget.remaining < budget.amountPerPeriod) {
    throw new Error("The selected budget cannot pay a whole period");
  }
  const periods = findClaimPeriods(wallet, derivedSecretField, budget, now);
  if (!periods.length) {
    throw new Error("No unclaimed due period could be selected");
  }
  return periods;
}

/** Find a usable budget without asking the holder to select a ticket or period indices. */
export function selectClaimBudget(
  notes: readonly Note[],
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  now: bigint,
):
  | {
      budget: ShieldedSelectableBudgetNote;
      secondBudget?: ShieldedSelectableBudgetNote;
      periodIndices: bigint[];
    }
  | undefined {
  const budgets = uniqueNotes(
    notes.filter((note): note is ShieldedSelectableBudgetNote => note.note.kind === "budget"),
  ).sort(
    (a, b) =>
      compareBigInt(a.note.eligibleFrom, b.note.eligibleFrom) ||
      compareBigInt(a.commitment, b.commitment),
  );
  for (const budget of budgets) {
    const periodIndices = findClaimPeriods(wallet, derivedSecretField, budget.note, now);
    if (!periodIndices.length) continue;
    if (periodIndices.length < 12) {
      for (const secondBudget of budgets) {
        if (
          secondBudget.commitment === budget.commitment ||
          secondBudget.note.remaining <= 0n ||
          getShieldedClaimBudgetKey(secondBudget.note, wallet) !==
            getShieldedClaimBudgetKey(budget.note, wallet)
        )
          continue;
        const remaining = budget.note.remaining + secondBudget.note.remaining;
        if (remaining > MAX_UINT128 || remaining / budget.note.amountPerPeriod > MAX_UINT64)
          continue;
        const combinedPeriods = findClaimPeriods(
          wallet,
          derivedSecretField,
          { ...budget.note, remaining },
          now,
        );
        if (combinedPeriods.length > periodIndices.length)
          return { budget, secondBudget, periodIndices: combinedPeriods };
      }
    }
    return { budget, periodIndices };
  }
  return undefined;
}
