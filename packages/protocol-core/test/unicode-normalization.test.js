import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  UNICODE_NORMALIZATION_VERSION,
  assertFreeformClass,
  mapNonAsciiSpacesToAscii,
  canonicalizeFullName,
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
  assert.equal(canonicalizeFullName("\ua7f1mith"), "\ua7f1mith");
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

test("PRECIS utility validates character classes without defining identity input rules", () => {
  for (const value of [
    "a\u0000b",
    "a\tb",
    "a\nb",
    "a\u001bb",
    "a\u007fb",
    "a\u00adb",
    "a\ufeffb",
    "a\u200bb",
    "aᄀb",
    "a͸b",
    "a﷐b",
  ]) {
    assert.throws(() => assertFreeformClass(value), { code: "DISALLOWED_CODE_POINT" });
  }
  for (const value of ["correct horse battery", "家族秘密", "ß", "😀", ""]) {
    assert.doesNotThrow(() => assertFreeformClass(value));
  }
});

test("PRECIS utility checks CONTEXTJ and CONTEXTO code points independently of text preparation", () => {
  for (const value of ["ab‌cd", "ab‍cd", "a·b", "͵a", "a׳", "ab・cd", "٠۰"]) {
    assert.throws(() => assertFreeformClass(value), { code: "CONTEXTUAL_RULE_NOT_SATISFIED" });
  }
  for (const value of ["क्‍क", "ب‌ب", "l·l", "͵α", "א׳", "カ・キ", "٠١"]) {
    assert.doesNotThrow(() => assertFreeformClass(value));
  }
});

test("PRECIS utility can detect contexts introduced by a separate NFC operation", () => {
  for (const value of ["a\u0387b", "\u0375\u1fee", "\u0375\u1fef", "\u0375\u1ffd"]) {
    assert.doesNotThrow(() => assertFreeformClass(value));
    assert.throws(() => assertFreeformClass(normalizeUnicodeNfc(value)), {
      code: "CONTEXTUAL_RULE_NOT_SATISFIED",
    });
  }
});

test("space-mapping utility transforms only Zs characters when explicitly requested", () => {
  assert.equal(mapNonAsciiSpacesToAscii("a\u00a0\u3000\u202fb"), "a   b");
  for (const value of ["a\tb", "a\nb", "a\u2028b", "Ａﬃa\u030a"]) {
    assert.equal(mapNonAsciiSpacesToAscii(value), value);
  }
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
