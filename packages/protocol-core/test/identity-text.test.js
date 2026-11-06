import test from "node:test";
import assert from "node:assert/strict";
import {
  ZERO_BYTES32,
  buildFilePasswordBytes,
  buildIdentityPasswordBytes,
  canonicalizeFullName,
  computePersonVersionContentCommitment,
  decryptPersonVersionEnvelope,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  normalizePassphrase,
  normalizeShieldedIndependentKeyIdentity,
  normalizeShieldedIndependentKeyPassphrase,
  roundTripPersonVersionEnvelope,
  trimUnicodeWhiteSpace,
  wipeBytes,
} from "../index.js";

const whiteSpace = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
  0x3000,
];
const prepareIndependentKeyName = (fullName) =>
  normalizeShieldedIndependentKeyIdentity({ ...identity, fullName }).fullName;
const identity = {
  fullName: "Alice Smith",
  gender: 2,
  birthYear: 1980,
  birthMonth: 1,
  birthDay: 2,
  isBirthBC: false,
};

test("name and passphrase trim every frozen White_Space code point only at the edges", () => {
  for (const codePoint of whiteSpace) {
    const space = String.fromCodePoint(codePoint);
    for (const prepare of [
      trimUnicodeWhiteSpace,
      canonicalizeFullName,
      normalizePassphrase,
      prepareIndependentKeyName,
      normalizeShieldedIndependentKeyPassphrase,
    ]) {
      assert.equal(prepare(`${space}${space}A${space}${space}B${space}`), `A${space}${space}B`);
      assert.equal(prepare(prepare(`${space}A${space}`)), "A");
    }
    assert.equal(normalizePassphrase(`${space}${space}`), "");
    assert.throws(() => normalizeShieldedIndependentKeyPassphrase(`${space}${space}`), {
      code: "INDEPENDENT_KEY_PASSPHRASE_REQUIRED",
    });
    assert.throws(() => canonicalizeFullName(`${space}${space}`), { code: "EMPTY_FULL_NAME" });
  }
  // ECMAScript trim() removes BOM and omits U+0085; this protocol's set is explicit.
  for (const nonSpace of ["\ufeff", "\u200b", "\u180e", "\u0000"]) {
    for (const prepare of [
      trimUnicodeWhiteSpace,
      canonicalizeFullName,
      normalizePassphrase,
      prepareIndependentKeyName,
      normalizeShieldedIndependentKeyPassphrase,
    ]) {
      assert.equal(prepare(` ${nonSpace}A${nonSpace} `), `${nonSpace}A${nonSpace}`);
    }
  }
});

test("both identity inputs preserve compatibility forms, combining marks and all interior characters", () => {
  for (const value of [
    "Ａlice",
    "①ﬃ",
    "e\u0301",
    "é",
    "A  B",
    "A\u00a0B",
    "A\u3000B",
    "A\t\nB",
    "张·王",
    "ab\u200dcd",
    "👩‍🔬",
    "a\u0000b",
    "a\u0378b",
    "a\ufdd0b",
  ]) {
    assert.equal(canonicalizeFullName(`\u3000${value}\u0085`), value);
    assert.equal(normalizePassphrase(`\u3000${value}\u0085`), value);
    assert.equal(prepareIndependentKeyName(`\u3000${value}\u0085`), value);
    assert.equal(normalizeShieldedIndependentKeyPassphrase(`\u3000${value}\u0085`), value);
    assert.deepEqual(buildIdentityPasswordBytes(` ${value} `), buildIdentityPasswordBytes(value));
    assert.deepEqual(buildFilePasswordBytes(` ${value} `), buildFilePasswordBytes(value));
    assert.deepEqual(
      Buffer.from(buildIdentityPasswordBytes(value)),
      Buffer.from(`DeepFamily:IdentityKDF:v1\0${value}`, "utf8"),
    );
  }
  for (const [first, second] of [
    ["Ａ", "A"],
    ["①", "1"],
    ["ﬃ", "ffi"],
    ["e\u0301", "é"],
    ["A  B", "A B"],
    ["A\u00a0B", "A B"],
    ["A\u3000B", "A B"],
    ["A", "a"],
  ]) {
    assert.notEqual(canonicalizeFullName(first), canonicalizeFullName(second));
    assert.notDeepEqual(buildIdentityPasswordBytes(first), buildIdentityPasswordBytes(second));
    assert.notDeepEqual(buildFilePasswordBytes(first), buildFilePasswordBytes(second));
  }
});

test("trim-only keeps Unicode scalar, name length and public empty-passphrase validation", () => {
  assert.equal(normalizePassphrase(""), "");
  assert.equal(canonicalizeFullName(` \u3000${"é".repeat(128)} `), "é".repeat(128));
  assert.throws(() => canonicalizeFullName("é".repeat(129)), { code: "FULL_NAME_TOO_LARGE" });
  assert.equal(canonicalizeFullName("e\u0301".repeat(85)), "e\u0301".repeat(85));
  assert.throws(() => canonicalizeFullName("e\u0301".repeat(86)), { code: "FULL_NAME_TOO_LARGE" });
  for (const malformed of ["\ud800", "\udc00", "a\ud800b"]) {
    for (const prepare of [
      trimUnicodeWhiteSpace,
      canonicalizeFullName,
      normalizePassphrase,
      prepareIndependentKeyName,
      normalizeShieldedIndependentKeyPassphrase,
    ]) {
      assert.throws(() => prepare(malformed), { code: "ISOLATED_SURROGATE" });
    }
  }
  assert.throws(() => canonicalizeFullName(null), { code: "INVALID_FULL_NAME" });
  assert.throws(() => normalizePassphrase(null), { code: "INVALID_PASSPHRASE" });
});

test("trimmed raw Unicode credentials round-trip identity, metadata encryption and decryption", async () => {
  const fullName = "Ａlice\u00a0  e\u0301\u200b";
  const passphrase = "口令·\u00a0e\u0301\u200d🔬\u0000";
  const rawIdentity = { ...identity, fullName: `\t ${fullName}\u3000` };
  const rawPassphrase = `\u0085 ${passphrase}\u3000`;
  const material = await deriveIdentityMaterial({ identity: rawIdentity, rawPassphrase });
  try {
    const metadata = {
      schema: "deepfamily/person-version@1.0",
      person: { ...material.identity, personHash: material.personHash },
      parents: { father: null, mother: null },
      tag: "原文标签",
      biography: "  原文 e\u0301\n  ",
    };
    const prepared = computePersonVersionContentCommitment({
      metadata,
      derivedSecretField: material.derivedSecretField,
    });
    const context = {
      chainId: 31337n,
      deepFamilyProxy: "0x1111111111111111111111111111111111111111",
      personHash: material.personHash,
      fatherHash: ZERO_BYTES32,
      fatherVersionIndex: 0n,
      motherHash: ZERO_BYTES32,
      motherVersionIndex: 0n,
      versionCommitment: prepared.versionCommitment,
    };
    const encrypted = await encryptPersonVersionEnvelope({ metadata, rawPassphrase, context });
    const result = await roundTripPersonVersionEnvelope({
      envelope: encrypted.envelope,
      rawPassphrase: passphrase,
      context,
      expectedMetadata: metadata,
    });
    assert.equal(result.metadata.person.fullName, fullName);
    assert.equal(result.metadata.biography, metadata.biography);
    assert.equal(result.metadataUnlockValidated, true);
    await assert.rejects(
      decryptPersonVersionEnvelope({
        envelope: encrypted.envelope,
        rawPassphrase: passphrase.replace("e\u0301", "é"),
        context,
      }),
      { code: "AES_GCM_AUTHENTICATION_FAILED" },
    );
    wipeBytes(prepared.canonicalJsonBytes);
  } finally {
    wipeBytes(material.identitySalt);
    wipeBytes(material.derivedSecretBytes);
  }
});
