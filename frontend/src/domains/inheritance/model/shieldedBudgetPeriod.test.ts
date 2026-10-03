import { describe, expect, it } from "vitest";
import { formatShieldedTimestamp, parseShieldedPeriodDays } from "./shieldedBudgetPeriod";

describe("budget period input and dates", () => {
  it.each(["1", "7", "365", "366", "4294967295"])("accepts %s whole days exactly", (input) => {
    expect(parseShieldedPeriodDays(input)).toBe(BigInt(input));
  });

  it.each(["", "0", "-1", "+7", "07", "1.5", "1e3", "4294967296", "9007199254740993"])(
    "rejects invalid or unsupported days %s",
    (input) => {
      expect(() => parseShieldedPeriodDays(input)).toThrow("periodDaysInvalid");
    },
  );

  it("formats supported timestamps and safely declines unrepresentable uint64 dates", () => {
    expect(formatShieldedTimestamp(1_000n)).toBe(new Date(1_000_000).toLocaleString());
    expect(formatShieldedTimestamp(1_000n, "date")).toBe(new Date(1_000_000).toLocaleDateString());
    expect(formatShieldedTimestamp(8_640_000_000_000n)).not.toBeUndefined();
    expect(formatShieldedTimestamp(8_640_000_000_001n)).toBeUndefined();
    expect(formatShieldedTimestamp((1n << 64n) - 1n)).toBeUndefined();
    expect(formatShieldedTimestamp(-1n)).toBeUndefined();
  });
});
