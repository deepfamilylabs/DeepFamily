import {
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  INHERITANCE_PERIOD_SECONDS,
  type DecodedShieldedNotePayload,
} from "@deepfamily/protocol-core";
import type { BigNumberish } from "ethers";
import type { OwnedShieldedNote } from "./shieldedPoolChain";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

type Note = OwnedShieldedNote<DecodedShieldedNotePayload>;
type BudgetPayload = Extract<DecodedShieldedNotePayload, { kind: "budget" }>;
type PeriodWallet = Pick<LocalShieldedWalletSnapshot, "spentNullifiers">;

export type ShieldedSelectableValueNote = OwnedShieldedNote<
  Extract<DecodedShieldedNotePayload, { kind: "value" }>
>;
export type ShieldedSelectableBudgetNote = OwnedShieldedNote<BudgetPayload>;

const MAX_UINT64 = (1n << 64n) - 1n;
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

const BUDGET_IDENTITY_FIELDS = [
  "rootIdentityCommitment",
  "rootVersionIndex",
  "policySalt",
  "allocationKeyCommitment",
  "heirIdentityCommitment",
  "eligibleFrom",
  "enrollmentSalt",
  "heirOwnerCommitment",
  "amountPerPeriod",
] as const satisfies readonly (keyof BudgetPayload)[];

function budgetIdentity(note: BudgetPayload): string {
  return BUDGET_IDENTITY_FIELDS.map((field) => note[field].toString()).join(":");
}

/** Match the policy, enrollment, owner, rate and bounds enforced by merge preparation. */
export function selectCompatibleBudgetPair(
  notes: readonly Note[],
): [ShieldedSelectableBudgetNote, ShieldedSelectableBudgetNote] | undefined {
  const budgets = uniqueNotes(
    notes.filter((note): note is ShieldedSelectableBudgetNote => note.note.kind === "budget"),
  ).sort((a, b) => compareBigInt(a.commitment, b.commitment));
  const groups = new Map<string, ShieldedSelectableBudgetNote[]>();
  for (const budget of budgets) {
    const { amountPerPeriod: rate, remaining } = budget.note;
    if (
      rate <= 0n ||
      remaining < 0n ||
      remaining > MAX_UINT128 ||
      remaining % rate !== 0n ||
      remaining / rate > MAX_UINT64
    )
      continue;
    const identity = budgetIdentity(budget.note);
    const group = groups.get(identity) ?? [];
    group.push(budget);
    groups.set(identity, group);
  }
  let best: [ShieldedSelectableBudgetNote, ShieldedSelectableBudgetNote] | undefined;
  for (const group of groups.values()) {
    const rate = group[0].note.amountPerPeriod;
    const periodLimit = rate * MAX_UINT64;
    const remainingLimit = periodLimit < MAX_UINT128 ? periodLimit : MAX_UINT128;
    const suffixMinimum = Array<bigint>(group.length);
    for (let index = group.length - 1; index >= 0; index -= 1) {
      const remaining = group[index].note.remaining;
      suffixMinimum[index] =
        index === group.length - 1 || remaining < suffixMinimum[index + 1]
          ? remaining
          : suffixMinimum[index + 1];
    }
    for (let first = 0; first < group.length - 1; first += 1) {
      if (group[first].note.remaining + suffixMinimum[first + 1] > remainingLimit) continue;
      for (let second = first + 1; second < group.length; second += 1) {
        const pair: [ShieldedSelectableBudgetNote, ShieldedSelectableBudgetNote] = [
          group[first],
          group[second],
        ];
        const remaining = pair[0].note.remaining + pair[1].note.remaining;
        if (remaining > remainingLimit) continue;
        if (!best || comparePairs(pair, best) < 0) best = pair;
        // Later partners have larger commitments than this valid partner.
        break;
      }
      // This is the group's smallest commitment with a valid partner.
      break;
    }
  }
  return best;
}

function findClaimPeriods(
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  budget: BudgetPayload,
  now: bigint,
): bigint[] {
  const elapsed = now - budget.eligibleFrom;
  if (elapsed < INHERITANCE_PERIOD_SECONDS || budget.amountPerPeriod <= 0n) return [];
  const fundedCount = budget.remaining / budget.amountPerPeriod;
  const target = Number(fundedCount < 12n ? fundedCount : 12n);
  if (target < 1) return [];
  const dueCount = elapsed / INHERITANCE_PERIOD_SECONDS;
  const policyCommitment = computeShieldedPolicyCommitment(budget);
  const result: bigint[] = [];
  const scanLimit = dueCount < MAX_AUTOMATIC_PERIOD_SCAN ? dueCount : MAX_AUTOMATIC_PERIOD_SCAN;
  for (let index = 0n; index < scanLimit && result.length < target; index += 1n) {
    const nullifier = computeShieldedPeriodNullifier({
      derivedSecretField,
      policyCommitment,
      periodIndex: index,
    });
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
  if (now - budget.eligibleFrom < INHERITANCE_PERIOD_SECONDS) {
    throw new Error("No whole period is due yet");
  }
  if (budget.amountPerPeriod <= 0n || budget.remaining < budget.amountPerPeriod) {
    throw new Error("The selected budget cannot pay a whole period");
  }
  const periods = findClaimPeriods(wallet, derivedSecretField, budget, now);
  if (!periods.length) {
    throw new Error("No unclaimed due period was found; enter exact period indices");
  }
  return periods;
}

/** Find a usable budget without asking the holder to select a ticket or period indices. */
export function selectClaimBudget(
  notes: readonly Note[],
  wallet: PeriodWallet,
  derivedSecretField: BigNumberish,
  now: bigint,
): { budget: ShieldedSelectableBudgetNote; periodIndices: bigint[] } | undefined {
  const budgets = uniqueNotes(
    notes.filter((note): note is ShieldedSelectableBudgetNote => note.note.kind === "budget"),
  ).sort(
    (a, b) =>
      compareBigInt(a.note.eligibleFrom, b.note.eligibleFrom) ||
      compareBigInt(a.commitment, b.commitment),
  );
  for (const budget of budgets) {
    const periodIndices = findClaimPeriods(wallet, derivedSecretField, budget.note, now);
    if (periodIndices.length) return { budget, periodIndices };
  }
  return undefined;
}
