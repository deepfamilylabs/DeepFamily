import { describe, expect, it } from "vitest";
import {
  formatDeepAmount,
  parseDeepAmount,
  parseMultiplier,
  suggestAmountPerPeriod,
  toDeepInput,
} from "./inheritanceAmounts";

const DEEP = 10n ** 18n;

describe("inheritance amounts", () => {
  it("parses positive decimal DEEP amounts and rejects everything else", () => {
    expect(parseDeepAmount("1")).toBe(DEEP);
    expect(parseDeepAmount(" 2.5 ")).toBe(25n * 10n ** 17n);
    expect(parseDeepAmount("0.000000000000000001")).toBe(1n);
    for (const bad of ["", "0", "0.0", "-1", "1e3", "1,000", "abc", "1.", ".5"]) {
      expect(parseDeepAmount(bad)).toBeNull();
    }
    // More precision than the token has would silently round; refuse it instead.
    expect(parseDeepAmount("0.0000000000000000001")).toBeNull();
  });

  it("suggests 1000 × recent reward × k with k to six decimals", () => {
    const reward = 113_777n * DEEP;
    expect(suggestAmountPerPeriod(reward, parseMultiplier("1")!)).toBe(113_777_000n * DEEP);
    expect(suggestAmountPerPeriod(reward, parseMultiplier("0.5")!)).toBe(56_888_500n * DEEP);
    expect(suggestAmountPerPeriod(3n, parseMultiplier("0.000001")!)).toBe(0n);
    expect(parseMultiplier("0")).toBeNull();
    expect(parseMultiplier("0.0000001")).toBeNull();
  });

  it("round-trips input text and formats grouped amounts without rounding up", () => {
    expect(toDeepInput(1000n * DEEP)).toBe("1000");
    expect(toDeepInput(15n * 10n ** 17n)).toBe("1.5");
    expect(parseDeepAmount(toDeepInput(123_456_789n))).toBe(123_456_789n);
    expect(formatDeepAmount(1_234_567n * DEEP + 99_999n * 10n ** 13n)).toBe("1,234,567.9999");
    expect(formatDeepAmount(0n)).toBe("0");
  });
});
