import { ethers } from "ethers";

export const DEEP_DECIMALS = 18;
/** The per-period amount the page suggests is this many recent mining rewards, times k. */
export const SUGGESTED_REWARDS_PER_PERIOD = 1000n;
export const MAX_AMOUNT_PER_PERIOD = (1n << 192n) - 1n;

const MULTIPLIER_DECIMALS = 6;
const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function parseDecimal(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!DECIMAL_PATTERN.test(value)) return null;
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  return ethers.parseUnits(value, decimals);
}

/** A positive DEEP amount typed by the user, in wei; null when it is not one. */
export function parseDeepAmount(input: string): bigint | null {
  const amount = parseDecimal(input, DEEP_DECIMALS);
  return amount !== null && amount > 0n ? amount : null;
}

/** The multiplier k, scaled by 10^6; null when it is not a positive number. */
export function parseMultiplier(input: string): bigint | null {
  const multiplier = parseDecimal(input, MULTIPLIER_DECIMALS);
  return multiplier !== null && multiplier > 0n ? multiplier : null;
}

/** 1000 × the token's recent mining reward × k, the pre-filled per-period amount. */
export function suggestAmountPerPeriod(recentReward: bigint, scaledMultiplier: bigint): bigint {
  return (recentReward * SUGGESTED_REWARDS_PER_PERIOD * scaledMultiplier) / MULTIPLIER_SCALE;
}

/** A plain decimal string that `parseDeepAmount` reads back to the same value. */
export function toDeepInput(amount: bigint): string {
  const text = ethers.formatUnits(amount, DEEP_DECIMALS);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** Grouped whole part, fraction cut (not rounded) to `fractionDigits`. */
export function formatDeepAmount(amount: bigint, fractionDigits = 4): string {
  const scale = 10n ** BigInt(DEEP_DECIMALS);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(DEEP_DECIMALS, "0")
    .slice(0, fractionDigits)
    .replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
