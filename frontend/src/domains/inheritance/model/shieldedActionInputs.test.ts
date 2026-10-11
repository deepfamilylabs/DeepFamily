import { describe, expect, it } from "vitest";
import { formatUnits } from "ethers";
import { parseShieldedAmount, parseShieldedFundingPeriods } from "./shieldedActionInputs";

describe("shielded amount inputs", () => {
  it("keeps exact base units for fractional token amounts and the smallest transferable unit", () => {
    expect(parseShieldedAmount("1.2345", 4)).toBe(12345n);
    expect(parseShieldedAmount("0.000000000000000001", 18)).toBe(1n);
    expect(parseShieldedAmount("1", 0)).toBe(1n);
    expect(parseShieldedAmount("1.2300", 2)).toBe(123n);
  });

  it("rejects a fraction of a base unit instead of rounding the payment", () => {
    expect(parseShieldedAmount("1.234", 2)).toBeUndefined();
    expect(parseShieldedAmount("0.0000000000000000001", 18)).toBeUndefined();
    expect(parseShieldedAmount("1.5", 0)).toBeUndefined();
  });

  it.each(["", ".", "0", "0.00", "-0", "-0.00", "-1", "+1", "1e3", "1,5", " 1 "])(
    "declines nonpositive or malformed payment %s",
    (value) => {
      expect(parseShieldedAmount(value, 18)).toBeUndefined();
    },
  );

  it("accepts the largest uint128 payment exactly and rejects the next base unit", () => {
    const maximum = (1n << 128n) - 1n;
    expect(parseShieldedAmount(maximum.toString(), 0)).toBe(maximum);
    expect(parseShieldedAmount(formatUnits(maximum, 18), 18)).toBe(maximum);
    expect(parseShieldedAmount((maximum + 1n).toString(), 0)).toBeUndefined();
    expect(parseShieldedAmount(formatUnits(maximum + 1n, 18), 18)).toBeUndefined();
  });

  it.each([NaN, -1, 1.5, Infinity])("declines invalid token precision %s", (decimals) => {
    expect(parseShieldedAmount("1", decimals)).toBeUndefined();
  });
});

describe("shielded funding period inputs", () => {
  it("accepts whole periods exactly through the uint64 boundary", () => {
    expect(parseShieldedFundingPeriods("1")).toBe(1n);
    expect(parseShieldedFundingPeriods("12")).toBe(12n);
    expect(parseShieldedFundingPeriods("9007199254740993")).toBe(9007199254740993n);
    expect(parseShieldedFundingPeriods("18446744073709551615")).toBe(18446744073709551615n);
    expect(parseShieldedFundingPeriods("18446744073709551616")).toBeUndefined();
  });

  it.each(["", "0", "-0", "-1", "+1", "01", "1.0", "1.5", "1e3", " 1 ", "0x10"])(
    "declines a noncanonical or nonpositive period count %s",
    (value) => {
      expect(parseShieldedFundingPeriods(value)).toBeUndefined();
    },
  );
});
