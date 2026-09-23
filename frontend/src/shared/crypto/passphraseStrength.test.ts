import { canonicalizeFullName } from "@deepfamily/protocol-core";
import { describe, expect, it } from "vitest";
import {
  classifyProtocolPassphraseRisk,
  normalizeNameForHash,
  normalizePassphraseForHash,
  validatePassphraseStrength,
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

describe("passphrase input the protocol refuses", () => {
  // The PRECIS FreeformClass rejects controls and invisible code points. The
  // meter must say so instead of reporting "ordinary" risk and an "empty"
  // recommendation, which left the failure to surface at wallet-call time.
  const rejected = [
    ["TAB", `good${String.fromCharCode(9)}passphrase`],
    ["BOM", "good\ufeffpassphrase"],
    ["soft hyphen", "good\u00adpassphrase"],
  ] as const;

  for (const [label, value] of rejected) {
    it(`classifies a passphrase containing ${label} as disallowed`, () => {
      expect(classifyProtocolPassphraseRisk(value)).toBe("disallowed");
      const strength = validatePassphraseStrength(value, true);
      expect(strength.isStrong).toBe(false);
      expect(strength.recommendation).toMatch(/does not accept/);
      // It is not empty, so it must not be described as empty.
      expect(strength.recommendation).not.toMatch(/Empty passphrase/);
    });
  }

  it("keeps empty and whitespace-only classifications distinct", () => {
    expect(classifyProtocolPassphraseRisk("")).toBe("empty");
    expect(classifyProtocolPassphraseRisk("\u00a0\u3000")).toBe("unicode-whitespace");
    expect(classifyProtocolPassphraseRisk("Tr0ub4dor&3-xkcd-horse")).toBe("ordinary");
  });
});

describe("passphrase strength analysis folds compatibility forms", () => {
  // The protocol preserves fullwidth and other compatibility forms, so the
  // meter must fold them itself or every weak-pattern check silently misses
  // IME output. Width is one bit of IME state, not per-character entropy.
  it("scores a fullwidth digit run exactly like its ASCII form", () => {
    const ascii = validatePassphraseStrength("1234567890123456");
    const fullwidth = validatePassphraseStrength("１２３４５６７８９０１２３４５６");
    expect(ascii.level).toBe("weak");
    expect(fullwidth.level).toBe(ascii.level);
    expect(fullwidth.entropy).toBe(ascii.entropy);
    expect(fullwidth.isStrong).toBe(false);
  });

  it("folds other compatibility forms, not just fullwidth", () => {
    expect(validatePassphraseStrength("ｐａｓｓｗｏｒｄ１２３４５６").isStrong).toBe(false);
    expect(validatePassphraseStrength("①②③④⑤⑥⑦⑧⑨⑩①②③④⑤⑥").isStrong).toBe(false);
  });

  it("leaves genuinely strong passphrases untouched", () => {
    expect(validatePassphraseStrength("Tr0ub4dor&3-xkcd-horse").isStrong).toBe(true);
    expect(validatePassphraseStrength("家族秘密要够长才安全一二三").isStrong).toBe(true);
  });
});

describe("shared protocol passphrase risk classification", () => {
  it("uses the protocol OpaqueString/no-trim and frozen Unicode White_Space rules", () => {
    expect(classifyProtocolPassphraseRisk("")).toBe("empty");
    expect(classifyProtocolPassphraseRisk("\u00a0\u3000")).toBe("unicode-whitespace");
    // U+FEFF is Default_Ignorable, so the FreeformClass refuses it outright.
    expect(classifyProtocolPassphraseRisk("\ufeff")).toBe("disallowed");
    expect(classifyProtocolPassphraseRisk("  family secret  ")).toBe("ordinary");
  });

  it("does not throw during malformed programmatic UI input", () => {
    expect(() => classifyProtocolPassphraseRisk("\ud800")).not.toThrow();
    expect(classifyProtocolPassphraseRisk("\ud800")).toBe("disallowed");
  });
});

describe("shared passphrase normalization", () => {
  it("delegates Unicode 17 OpaqueString normalization to protocol-core", () => {
    expect(normalizePassphraseForHash("a\u030a")).toBe("\u00e5");
    // OpaqueString does no width or compatibility mapping; NFKD would fold this to "S".
    expect(normalizePassphraseForHash("\ua7f1")).toBe("\ua7f1");
  });

  it("keeps render-time consumers total for malformed programmatic input", () => {
    expect(normalizePassphraseForHash("\ud800")).toBe("");
  });
});
