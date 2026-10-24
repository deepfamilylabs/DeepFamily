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

export type ShieldedSelectableBudgetNote = OwnedShieldedNote<BudgetPayload>;

const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_AUTOMATIC_PERIOD_SCAN = 100_000n;

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueNotes<T extends Note>(notes: readonly T[]): T[] {
  return [...new Map(notes.map((note) => [note.commitment, note])).values()];
}

/** Stable key for budget notes sharing one allowance and period-nullifier sequence. */
export function getShieldedClaimBudgetKey(note: BudgetPayload, scope: ShieldedScope): string {
  const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(note, scope);
  return [
    note.binding === "identity" ? "identity" : "owner",
    note.keyMode ?? 0n,
    note.binding === "identity" ? "identity-derived" : note.heirOwnerCommitment,
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
  const target = Number(fundedCount < 3n ? fundedCount : 3n);
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

/** Select at most 3 earliest due periods, excluding locally replayed spent nullifiers. */
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
    return { budget, periodIndices };
  }
  return undefined;
}
