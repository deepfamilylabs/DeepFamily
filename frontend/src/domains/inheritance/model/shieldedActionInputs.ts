import { parseUnits } from "ethers";

const AMOUNT_LIMIT = 1n << 128n;
const MAX_FUNDING_PERIODS = (1n << 64n) - 1n;

/** Parse a positive protocol amount without rounding fractional base units. */
export function parseShieldedAmount(value: string, decimals: number): bigint | undefined {
  if (!Number.isSafeInteger(decimals) || decimals < 0) return undefined;
  try {
    const amount = parseUnits(value, decimals);
    return amount > 0n && amount < AMOUNT_LIMIT ? amount : undefined;
  } catch {
    return undefined;
  }
}

/** Funding periods are positive decimal uint64 integers, with no fractional notation. */
export function parseShieldedFundingPeriods(value: string): bigint | undefined {
  if (!/^[1-9][0-9]{0,19}$/.test(value)) return undefined;
  const periods = BigInt(value);
  return periods <= MAX_FUNDING_PERIODS ? periods : undefined;
}
