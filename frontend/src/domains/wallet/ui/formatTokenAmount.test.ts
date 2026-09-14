import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "./formatTokenAmount";

const ONE = 10n ** 18n;

describe("formatTokenAmount", () => {
  it("shows three decimals, rounded half up", () => {
    expect(formatTokenAmount((ONE * 123456n) / 100000n, 18)).toBe("1.235");
    expect(formatTokenAmount(0n, 18)).toBe("0.000");
  });

  it("groups the whole part by thousands", () => {
    expect(formatTokenAmount(113777n * ONE, 18)).toBe("113,777.000");
    expect(formatTokenAmount(100_000_000_000n * ONE, 18)).toBe("100,000,000,000.000");
  });

  it("calls dust what it is instead of rounding it to zero", () => {
    expect(formatTokenAmount(123n, 18)).toBe("< 0.001");
    expect(formatTokenAmount(ONE / 1000n, 18)).toBe("0.001");
  });

  it("respects the token's own decimals", () => {
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.500");
  });
});
