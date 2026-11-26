import { InheritanceError } from "./inheritanceErrors";

const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const SECONDS_PER_DAY = 86_400n;
const MAX_DATE_SECONDS = 8_640_000_000_000n;

/** Asset Worker text for an unclaimable period count; the interface localizes it. */
export const SHIELDED_PERIODS_BEYOND_TIME_LIMIT_MESSAGE =
  "The last funded periods would fall due after the uint64 time limit and could never be claimed.";

/**
 * Claim proves each period index's maturity, `eligibleFrom + (index + 1) * periodDays` days,
 * within uint64 time, and all budgets of one heir under one policy share one index sequence.
 * `periods` counts the indices those budgets still need.
 */
export function shieldedPeriodsMatureInTime(
  eligibleFrom: bigint,
  periodDays: bigint,
  periods: bigint,
): boolean {
  return eligibleFrom + periods * periodDays * SECONDS_PER_DAY <= MAX_UINT64;
}

/** Days are protocol integers, never floating point or calendar-month units. */
export function parseShieldedPeriodDays(value: string): bigint {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]{0,9}$/.test(trimmed)) throw new InheritanceError("periodDaysInvalid");
  const days = BigInt(trimmed);
  if (days > MAX_UINT32) throw new InheritanceError("periodDaysInvalid");
  return days;
}

/** uint64 timestamps can exceed Date's range; never render an invalid date. */
export function formatShieldedTimestamp(
  seconds: bigint,
  kind: "date" | "dateTime" = "dateTime",
): string | undefined {
  if (seconds < 0n || seconds > MAX_DATE_SECONDS) return undefined;
  const date = new Date(Number(seconds * 1000n));
  return kind === "date" ? date.toLocaleDateString() : date.toLocaleString();
}

/**
 * A new budget's first period starts this long after its family eligibility
 * snapshot, which also bounds how long that snapshot can back a funding proof.
 */
export const SHIELDED_FUNDING_START_DELAY_SECONDS = 7200n;
