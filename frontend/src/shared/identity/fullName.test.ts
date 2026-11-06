import { describe, expect, it } from "vitest";
import { canonicalizeFullName, safeCanonicalizeFullName } from "./fullName";

describe("fresh-v1 full-name canonicalization", () => {
  it("trims only surrounding protocol Unicode White_Space and preserves all internal characters", () => {
    expect(canonicalizeFullName("\u0085  Ａlice\u3000\u3000Smith  \u00a0")).toBe(
      "Ａlice\u3000\u3000Smith",
    );
    expect(canonicalizeFullName("a\u030a")).toBe("a\u030a");
    expect(canonicalizeFullName("\ufeffAlice\ufeff")).toBe("\ufeffAlice\ufeff");
  });

  it("provides a fail-closed value for UI validation", () => {
    expect(safeCanonicalizeFullName("\u3000\t")).toBe("");
    expect(safeCanonicalizeFullName("Alice")).toBe("Alice");
  });
});
