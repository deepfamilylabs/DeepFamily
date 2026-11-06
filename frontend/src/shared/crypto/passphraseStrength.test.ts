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
    expect(normalizeNameForHash("  Ada\u0085Lovelace  ")).toBe("Ada\u0085Lovelace");
    expect(normalizeNameForHash("  Ada\uFEFFLovelace  ")).toBe("Ada\uFEFFLovelace");
    expect(normalizeNameForHash("  Ada\u0085Lovelace  ")).toBe(
      canonicalizeFullName("  Ada\u0085Lovelace  "),
    );
    expect(normalizeNameForHash("  Ada\uFEFFLovelace  ")).toBe(
      canonicalizeFullName("  Ada\uFEFFLovelace  "),
    );
    expect(normalizeNameForHash("\u0085\u3000Ada\u0085\u3000")).toBe("Ada");
    expect(normalizeNameForHash("\ufeffAda\ufeff")).toBe("\ufeffAda\ufeff");
    expect(normalizeNameForHash("\ua7f1")).toBe("\ua7f1");
  });

  it("fails closed for an invalid or empty canonical name without throwing in UI code", () => {
    expect(normalizeNameForHash("\u0085\u3000")).toBe("");
    expect(normalizeNameForHash("\ud800")).toBe("");
  });
});

describe("passphrase scalar values preserved by the protocol", () => {
  const accepted = [
    ["TAB", `good${String.fromCharCode(9)}passphrase`],
    ["BOM", "good\ufeffpassphrase"],
    ["soft hyphen", "good\u00adpassphrase"],
  ] as const;

  for (const [label, value] of accepted) {
    it(`accepts and preserves a passphrase containing ${label}`, () => {
      expect(classifyProtocolPassphraseRisk(value)).toBe("ordinary");
      expect(normalizePassphraseForHash(value)).toBe(value);
      const strength = validatePassphraseStrength(value, true);
      expect(strength.recommendation ?? "").not.toMatch(
        /does not accept|malformed|Empty passphrase/,
      );
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
  it("uses the frozen Unicode White_Space trim rules and preserves the whitespace UX category", () => {
    expect(classifyProtocolPassphraseRisk("")).toBe("empty");
    expect(classifyProtocolPassphraseRisk("\u00a0\u3000")).toBe("unicode-whitespace");
    // U+FEFF is outside Unicode White_Space and remains part of the secret.
    expect(classifyProtocolPassphraseRisk("\ufeff")).toBe("ordinary");
    expect(classifyProtocolPassphraseRisk("  family secret  ")).toBe("ordinary");
  });

  it("does not throw during malformed programmatic UI input", () => {
    expect(() => classifyProtocolPassphraseRisk("\ud800")).not.toThrow();
    expect(classifyProtocolPassphraseRisk("\ud800")).toBe("disallowed");
  });
});

describe("shared passphrase normalization", () => {
  it("trims only surrounding Unicode White_Space without NFC or compatibility folding", () => {
    expect(normalizePassphraseForHash("\u0085\u3000a\u030a\u00a0 ")).toBe("a\u030a");
    expect(normalizePassphraseForHash("  a\u00a0\u3000b  ")).toBe("a\u00a0\u3000b");
    expect(normalizePassphraseForHash("\ufeffphrase\ufeff")).toBe("\ufeffphrase\ufeff");
    expect(normalizePassphraseForHash("\ua7f1")).toBe("\ua7f1");
    expect(normalizePassphraseForHash("Ａ①ﬃ")).toBe("Ａ①ﬃ");
  });

  it("keeps render-time consumers total for malformed programmatic input", () => {
    expect(normalizePassphraseForHash("\ud800")).toBe("");
  });
});
