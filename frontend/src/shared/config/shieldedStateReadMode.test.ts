import { describe, expect, it } from "vitest";
import { normalizeShieldedStateReadMode } from "./shieldedStateReadMode";

describe("shielded state read mode", () => {
  it("defaults only an omitted mode to local rebuilding", () => {
    expect(normalizeShieldedStateReadMode()).toBe("rebuild");
    expect(normalizeShieldedStateReadMode("rebuild")).toBe("rebuild");
    expect(normalizeShieldedStateReadMode("chain")).toBe("chain");
  });

  it.each([null, "onchain", "invalid", "", true, 0, {}])(
    "rejects an unknown request mode %j",
    (mode) => {
      expect(() => normalizeShieldedStateReadMode(mode)).toThrow(
        "Unsupported shielded state read mode",
      );
    },
  );
});
