import { describe, expect, it } from "vitest";
import { canonicalizeFullName, safeCanonicalizeFullName } from "./fullName";

describe("fresh-v1 full-name canonicalization", () => {
  it("uses the protocol-core NFKC and Unicode White_Space rules", () => {
    expect(canonicalizeFullName("  Alice\u3000Smith  ")).toBe("Alice Smith");
  });

  it("provides a fail-closed value for UI validation", () => {
    expect(safeCanonicalizeFullName("\u3000\t")).toBe("");
    expect(safeCanonicalizeFullName("Alice")).toBe("Alice");
  });
});
