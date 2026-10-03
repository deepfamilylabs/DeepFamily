import { InheritanceError } from "./inheritanceErrors";

const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_DATE_SECONDS = 8_640_000_000_000n;

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
