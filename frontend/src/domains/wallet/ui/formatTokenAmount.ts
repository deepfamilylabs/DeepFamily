/**
 * A token amount for display: three decimals rounded half up, the whole part
 * grouped by thousands, and "< 0.001" for dust rather than a misleading 0.000.
 * Shared by the native balance and DEEP so the account menu reads as one table.
 */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const thousandth = unit / 1000n;

  if (raw > 0n && raw < thousandth) return "< 0.001";

  const milli = raw <= 0n ? 0n : (raw * 1000n + unit / 2n) / unit;
  const whole = (milli / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (milli % 1000n).toString().padStart(3, "0");

  return `${whole}.${fraction}`;
}
