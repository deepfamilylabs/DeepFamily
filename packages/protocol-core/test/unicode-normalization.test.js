import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  UNICODE_NORMALIZATION_VERSION,
  canonicalizeFullName,
  normalizePassphrase,
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
  assert.equal(normalizePassphrase("prefix-\ua7f1-suffix"), "prefix-S-suffix");
  assert.equal(canonicalizeFullName("\ua7f1mith"), "Smith");
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
