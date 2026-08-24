import { canonicalizeFullName } from "@deepfamily/protocol-core";
import { describe, expect, it } from "vitest";
import {
  classifyProtocolPassphraseRisk,
  normalizeNameForHash,
  normalizePassphraseForHash,
} from "./passphraseStrength";

describe("shared identity-name normalization", () => {
  it("uses the protocol Unicode White_Space set instead of host RegExp tables", () => {
    // U+0085 is Unicode White_Space but is not consistently covered by host
    // JavaScript \\s tables. U+FEFF is intentionally not in the frozen set,
    // even though String.prototype.trim historically removes it.
    expect(normalizeNameForHash("  Ada\u0085Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeNameForHash("  Ada\uFEFFLovelace  ")).toBe("Ada\uFEFFLovelace");
    expect(normalizeNameForHash("  Ada\u0085Lovelace  ")).toBe(
      canonicalizeFullName("  Ada\u0085Lovelace  "),
    );
    expect(normalizeNameForHash("  Ada\uFEFFLovelace  ")).toBe(
      canonicalizeFullName("  Ada\uFEFFLovelace  "),
    );
    expect(normalizeNameForHash("\ua7f1")).toBe("S");
  });

  it("fails closed for an invalid or empty canonical name without throwing in UI code", () => {
    expect(normalizeNameForHash("\u0085\u3000")).toBe("");
    expect(normalizeNameForHash("\ud800")).toBe("");
  });
});

describe("shared protocol passphrase risk classification", () => {
  it("uses the protocol NFKD/no-trim and frozen Unicode White_Space rules", () => {
    expect(classifyProtocolPassphraseRisk("")).toBe("empty");
    expect(classifyProtocolPassphraseRisk("\u00a0\u0085\u2028\u3000")).toBe("unicode-whitespace");
    expect(classifyProtocolPassphraseRisk("\ufeff")).toBe("ordinary");
    expect(classifyProtocolPassphraseRisk("  family secret  ")).toBe("ordinary");
  });

  it("does not throw during malformed programmatic UI input", () => {
    expect(() => classifyProtocolPassphraseRisk("\ud800")).not.toThrow();
    expect(classifyProtocolPassphraseRisk("\ud800")).toBe("ordinary");
  });
});

describe("shared passphrase normalization", () => {
  it("delegates Unicode 17 NFKD to protocol-core", () => {
    expect(normalizePassphraseForHash("\ua7f1")).toBe("S");
  });

  it("keeps render-time consumers total for malformed programmatic input", () => {
    expect(normalizePassphraseForHash("\ud800")).toBe("");
  });
});
