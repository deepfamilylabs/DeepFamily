import { describe, expect, it } from "vitest";
import {
  formatShieldedTimestamp,
  parseShieldedPeriodDays,
  shieldedPeriodsMatureInTime,
} from "./shieldedBudgetPeriod";

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

  it("accepts a last period falling due exactly at the uint64 limit and nothing later", () => {
    const max = (1n << 64n) - 1n;
    const day = 86_400n;
    expect(shieldedPeriodsMatureInTime(max - 3n * day, 1n, 3n)).toBe(true);
    expect(shieldedPeriodsMatureInTime(max - 3n * day + 1n, 1n, 3n)).toBe(false);
    // The longest interval leaves room for 49,710 periods.
    const longest = 4_294_967_295n;
    expect(shieldedPeriodsMatureInTime(1_700_000_000n, longest, 49_710n)).toBe(true);
    expect(shieldedPeriodsMatureInTime(1_700_000_000n, longest, 49_711n)).toBe(false);
  });
});
