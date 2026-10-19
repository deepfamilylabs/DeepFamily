import { describe, expect, it } from "vitest";
import { formatShieldedAmount, getShieldedAvatarText } from "./shieldedDisplay";

describe("formatShieldedAmount", () => {
  it("groups whole units and drops trailing fraction zeros", () => {
    expect(formatShieldedAmount(12_480n * 10n ** 18n, 18)).toBe("12,480");
    expect(formatShieldedAmount("2500000000000000000", 18)).toBe("2.5");
    expect(formatShieldedAmount(31_333n, 0)).toBe("31,333");
    expect(formatShieldedAmount(0n, 18)).toBe("0");
    expect(formatShieldedAmount(1n, 18)).toBe("0.000000000000000001");
  });

  it("keeps the sign of negative values", () => {
    expect(formatShieldedAmount(-1_234_500n, 3)).toBe("-1,234.5");
  });
});

describe("getShieldedAvatarText", () => {
  it("uses the last two characters of a Han name", () => {
    expect(getShieldedAvatarText("曹操")).toBe("曹操");
    expect(getShieldedAvatarText("司马懿")).toBe("马懿");
  });

  it("uses the initials of the first and last words otherwise", () => {
    expect(getShieldedAvatarText("Patrick Joseph Kennedy")).toBe("PK");
    expect(getShieldedAvatarText("child")).toBe("C");
    expect(getShieldedAvatarText("   ")).toBe("");
  });
});
