const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_DATE_SECONDS = 8_640_000_000_000n;
export const SECONDS_PER_DAY = 86_400n;

/** Days are protocol integers, never floating point or calendar-month units. */
export function parseShieldedPeriodDays(value: string): bigint | undefined {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]{0,9}$/.test(trimmed)) return undefined;
  const days = BigInt(trimmed);
  return days > MAX_UINT32 ? undefined : days;
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
