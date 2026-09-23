import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  UNICODE_NORMALIZATION_VERSION,
  buildFilePasswordBytes,
  buildIdentityPasswordBytes,
  canonicalizeFullName,
  normalizePassphrase,
  normalizeUnicodeNfc,
  normalizeUnicodeNfd,
  normalizeUnicodeNfkc,
  normalizeUnicodeNfkd,
} from "../index.js";

test("ships the exact Unicode-3.0 notice with the generated normalization data", () => {
  const license = fs.readFileSync(new URL("../UNICODE-LICENSE.txt", import.meta.url));
  assert.equal(
    createHash("sha256").update(license).digest("hex"),
    "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
  );
  const generated = fs.readFileSync(
    new URL("../unicode-normalization-data.js", import.meta.url),
    "utf8",
  );
  assert.match(generated, /\/\*! @license Unicode-3\.0/u);
  assert.match(generated, /UNICODE LICENSE V3/u);
  assert.match(generated, /Permission is hereby granted, free of charge/u);
});

test("uses frozen Unicode 17 normalization instead of host ICU tables", () => {
  assert.equal(UNICODE_NORMALIZATION_VERSION, "17.0.0");
  // U+A7F1 gained the compatibility decomposition <super> U+0053 in
  // Unicode 17. Node/ICU versions based on Unicode 16 leave it unchanged.
  assert.equal(normalizeUnicodeNfkd("\ua7f1"), "S");
  assert.equal(normalizeUnicodeNfkc("\ua7f1"), "S");
  assert.equal(canonicalizeFullName("\ua7f1mith"), "Smith");
});

test("applies canonical-only decomposition for NFD and NFC", () => {
  // The canonical table must not pick up compatibility mappings: U+A7F1 and the
  // fullwidth/ligature forms decompose under NFKD but are fixed points here.
  assert.equal(normalizeUnicodeNfd("꟱"), "꟱");
  assert.equal(normalizeUnicodeNfd("Ａﬃ"), "Ａﬃ");
  assert.equal(normalizeUnicodeNfd("Å"), "Å");
  assert.equal(normalizeUnicodeNfd("Å"), "Å");
  // Canonical ordering still applies to combining marks.
  assert.equal(normalizeUnicodeNfd("à̕"), "à̕");
  assert.equal(normalizeUnicodeNfc("à̕"), "à̕");
  assert.equal(normalizeUnicodeNfc("Å"), "Å");
  assert.equal(normalizeUnicodeNfc("꟱"), "꟱");
  // Hangul is algorithmic and canonical, so both forms round-trip.
  assert.equal(normalizeUnicodeNfd("각"), "각");
  assert.equal(normalizeUnicodeNfc("각"), "각");
  // Both forms are idempotent.
  assert.equal(normalizeUnicodeNfd(normalizeUnicodeNfd("Å")), "Å");
  assert.equal(normalizeUnicodeNfc(normalizeUnicodeNfc("Å")), "Å");
});

test("restricts the passphrase repertoire to the PRECIS FreeformClass", () => {
  // RFC 8265 Section 4.2.1 preparation. Controls and Default_Ignorable code
  // points are rejected rather than silently carried into an unrecoverable
  // secret: they are invisible or untypeable, so they cannot be reproduced.
  for (const code of [0, 9, 10, 27, 127]) {
    assert.throws(() => normalizePassphrase(`a${String.fromCharCode(code)}b`), {
      code: "DISALLOWED_CODE_POINT",
    });
  }
  for (const invisible of ["­", "﻿", "​"]) {
    assert.throws(() => normalizePassphrase(`a${invisible}b`), {
      code: "DISALLOWED_CODE_POINT",
    });
  }
  // Old Hangul Jamo, unassigned and noncharacter code points are disallowed too.
  assert.throws(() => normalizePassphrase("aᄀb"), { code: "DISALLOWED_CODE_POINT" });
  assert.throws(() => normalizePassphrase("a͸b"), { code: "DISALLOWED_CODE_POINT" });
  assert.throws(() => normalizePassphrase("a﷐b"), { code: "DISALLOWED_CODE_POINT" });
  // An empty passphrase stays valid: that divergence from OpaqueString is
  // deliberate and is what the public-tree mode relies on.
  assert.equal(normalizePassphrase(""), "");
  // Ordinary text across scripts is unaffected.
  for (const value of ["correct horse battery", "家族秘密", "ß", "😀"]) {
    assert.equal(normalizePassphrase(value), value);
  }
});

test("admits CONTEXTJ and CONTEXTO code points only where their rule holds", () => {
  // RFC 5892 Appendix A.1/A.2: join controls need a Virama or a joining context.
  assert.throws(() => normalizePassphrase("ab‌cd"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  assert.throws(() => normalizePassphrase("ab‍cd"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  assert.equal(normalizePassphrase("क्‍क"), "क्‍क");
  assert.equal(normalizePassphrase("ب‌ب"), "ب‌ب");
  // Appendix A.3: MIDDLE DOT only between two U+006C.
  assert.throws(() => normalizePassphrase("a·b"), { code: "CONTEXTUAL_RULE_NOT_SATISFIED" });
  assert.equal(normalizePassphrase("l·l"), "l·l");
  // Appendix A.4 to A.7: script-dependent punctuation.
  assert.throws(() => normalizePassphrase("͵a"), { code: "CONTEXTUAL_RULE_NOT_SATISFIED" });
  assert.equal(normalizePassphrase("͵α"), "͵α");
  assert.throws(() => normalizePassphrase("a׳"), { code: "CONTEXTUAL_RULE_NOT_SATISFIED" });
  assert.equal(normalizePassphrase("א׳"), "א׳");
  assert.throws(() => normalizePassphrase("ab・cd"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  assert.equal(normalizePassphrase("カ・キ"), "カ・キ");
  // Appendix A.8/A.9: the two Arabic-Indic digit sets must not be mixed.
  assert.throws(() => normalizePassphrase("٠۰"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  assert.equal(normalizePassphrase("٠١"), "٠١");
});

test("rejects passphrases whose contextual rules become invalid after NFC", () => {
  // U+0387 is PVALID, but NFC changes it to the contextual U+00B7 MIDDLE DOT.
  // The other inputs start with U+0375 followed by a Greek-script character
  // whose canonical replacement no longer has the Greek script property.
  for (const value of ["a\u0387b", "\u0375\u1fee", "\u0375\u1fef", "\u0375\u1ffd"]) {
    for (const input of [value, normalizeUnicodeNfc(value)]) {
      assert.throws(() => normalizePassphrase(input), {
        code: "CONTEXTUAL_RULE_NOT_SATISFIED",
      });
      assert.throws(() => buildIdentityPasswordBytes(input), {
        code: "CONTEXTUAL_RULE_NOT_SATISFIED",
      });
      assert.throws(() => buildFilePasswordBytes(input), {
        code: "CONTEXTUAL_RULE_NOT_SATISFIED",
      });
    }
  }
});

test("keeps valid canonical contexts stable across repeated KDF preparation", () => {
  const rawPassphrase = "l\u0387l";
  const normalized = normalizePassphrase(rawPassphrase);
  assert.equal(normalized, "l\u00b7l");
  assert.equal(normalizePassphrase(normalized), normalized);
  // Seed helpers prepare the passphrase before the KDF prepares it again.
  for (const buildPasswordBytes of [buildIdentityPasswordBytes, buildFilePasswordBytes]) {
    assert.deepEqual(buildPasswordBytes(rawPassphrase), buildPasswordBytes(normalized));
  }
});

test("normalizes passphrases with the RFC 8265 OpaqueString rules", () => {
  // RFC 8265 OpaqueString: no width or case mapping, so U+A7F1 does not fold to
  // "S" and fullwidth forms survive.
  assert.equal(normalizePassphrase("prefix-\ua7f1-suffix"), "prefix-\ua7f1-suffix");
  assert.equal(normalizePassphrase("\uff21"), "\uff21");
  // The additional mapping rule folds every non-ASCII Zs to U+0020.
  assert.equal(normalizePassphrase("a\u00a0b"), "a b");
  assert.equal(normalizePassphrase("a\u3000b"), "a b");
  assert.equal(normalizePassphrase("a\u202fb"), "a b");
  // That rule is Zs-only. White_Space outside Zs is not folded to a space; it is
  // rejected outright by the FreeformClass preparation step.
  assert.throws(() => normalizePassphrase(`a${String.fromCharCode(9)}b`), {
    code: "DISALLOWED_CODE_POINT",
  });
  assert.throws(() => normalizePassphrase("a\u2028b"), { code: "DISALLOWED_CODE_POINT" });
  // Canonical composition still applies, and the result is idempotent.
  assert.equal(normalizePassphrase("a\u030a"), "\u00e5");
  assert.equal(normalizePassphrase(normalizePassphrase("a\u030a")), "\u00e5");
});

test("implements compatibility decomposition, canonical ordering and composition", () => {
  assert.equal(normalizeUnicodeNfkd("\uff21\ufb03\u00c5"), "AffiA\u030a");
  assert.equal(normalizeUnicodeNfkd("a\u0315\u0300"), "a\u0300\u0315");
  assert.equal(normalizeUnicodeNfkc("a\u0315\u0300"), "\u00e0\u0315");
  assert.equal(normalizeUnicodeNfkc("\u212b"), "\u00c5");
});

test("implements algorithmic Hangul decomposition and composition", () => {
  assert.equal(normalizeUnicodeNfkd("\uac01"), "\u1100\u1161\u11a8");
  assert.equal(normalizeUnicodeNfkc("\u1100\u1161\u11a8"), "\uac01");
});

test("normalization is idempotent and rejects isolated surrogates", () => {
  const value = "\ua7f1\uff21\ufb03a\u0315\u0300\uac01";
  const nfkd = normalizeUnicodeNfkd(value);
  const nfkc = normalizeUnicodeNfkc(value);
  assert.equal(normalizeUnicodeNfkd(nfkd), nfkd);
  assert.equal(normalizeUnicodeNfkc(nfkc), nfkc);
  assert.throws(() => normalizeUnicodeNfkd("bad\ud800"), /isolated surrogate/);
  assert.throws(() => normalizeUnicodeNfkc("bad\udc00"), /isolated surrogate/);
});
