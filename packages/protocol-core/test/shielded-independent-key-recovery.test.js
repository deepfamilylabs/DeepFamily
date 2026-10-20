import assert from "node:assert/strict";
import { test } from "node:test";
import { Mnemonic, Wallet, getBytes, wordlists } from "ethers";
import {
  ProtocolError,
  buildShieldedIndependentKeySigningMessage,
  decodeShieldedIndependentKey,
  decodeShieldedIndependentKeyMnemonic,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedIndependentKeyRootFromSignature,
  encodeShieldedIndependentKey,
  encodeShieldedIndependentKeyMnemonic,
} from "../index.js";

import { independentKeyVector as vector } from "./shielded-independent-key.fixture.js";

// Official BIP39 reference vectors: https://github.com/trezor/python-mnemonic/blob/master/vectors.json
// Only the entropy/words part is used; the reference PBKDF2 seed is not an independent key root.
const vectors = [
  ["00".repeat(32), `${"abandon ".repeat(23)}art`],
  [
    "7f".repeat(32),
    "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
  ],
  [
    "80".repeat(32),
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless",
  ],
  ["ff".repeat(32), `${"zoo ".repeat(23)}vote`],
];
const frozenRoot = Uint8Array.from({ length: 32 }, (_, i) => i);
const frozenWords =
  "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware";

test("24-word recovery encodes official 256-bit BIP39 entropy vectors without changing bytes", () => {
  for (const [hex, phrase] of vectors) {
    const root = getBytes(`0x${hex}`);
    assert.equal(encodeShieldedIndependentKeyMnemonic(root), phrase);
    assert.deepEqual(decodeShieldedIndependentKeyMnemonic(phrase), root);
    assert.equal(encodeShieldedIndependentKey(root), `0x${hex}`);
    assert.deepEqual(decodeShieldedIndependentKey(`0x${hex}`), root);
  }
});

test("mnemonic and Shielded Key restore the frozen branch-v1 owner and fingerprint", async () => {
  assert.equal(encodeShieldedIndependentKeyMnemonic(frozenRoot), frozenWords);
  for (const restored of [
    decodeShieldedIndependentKeyMnemonic(frozenWords),
    decodeShieldedIndependentKey(encodeShieldedIndependentKey(frozenRoot)),
  ]) {
    assert.deepEqual(restored, frozenRoot);
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: restored,
      independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
    });
    assert.equal(keys.ownerSecret, vector.ownerSecret);
    assert.equal(keys.keyFingerprint, vector.keyFingerprint);
  }
});

test("signature-derived roots have the same mnemonic and key recovery without provenance", async () => {
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  const signature = await wallet.signMessage(buildShieldedIndependentKeySigningMessage(wallet.address));
  const { independentKeyRoot } = await deriveShieldedIndependentKeyRootFromSignature({
    signerAddress: wallet.address,
    signature,
  });
  const restored = decodeShieldedIndependentKeyMnemonic(encodeShieldedIndependentKeyMnemonic(independentKeyRoot));
  assert.deepEqual(restored, decodeShieldedIndependentKey(encodeShieldedIndependentKey(independentKeyRoot)));
  assert.deepEqual(
    await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: restored,
      independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
    }),
    await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: independentKeyRoot,
      independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
    }),
  );
});

test("recovery decodes entropy directly; a BIP39 seed is a different secret", () => {
  const mnemonic = Mnemonic.fromPhrase(frozenWords, "", wordlists.en);
  const seed = getBytes(mnemonic.computeSeed());
  assert.equal(seed.length, 64);
  assert.notDeepEqual(seed.subarray(0, 32), frozenRoot);
  assert.deepEqual(decodeShieldedIndependentKeyMnemonic(frozenWords), frozenRoot);
});

test("mnemonic imports normalize ASCII case and whitespace only", () => {
  const spaced = `\r\n\t${frozenWords.toUpperCase().split(" ").join(" \t\n\v\f\r ")}\r\n`;
  assert.deepEqual(decodeShieldedIndependentKeyMnemonic(spaced), frozenRoot);
  assert.deepEqual(
    decodeShieldedIndependentKey(encodeShieldedIndependentKey(frozenRoot).toUpperCase().replace("0X", "0x")),
    frozenRoot,
  );
  for (const phrase of [
    frozenWords.replace(" ", "\u00a0"),
    frozenWords.replace(" ", "\u3000"),
    frozenWords.replace("abandon", "ａｂａｎｄｏｎ"),
    frozenWords.replace("abandon", "ábándon"),
    `\ufeff${frozenWords}`,
  ]) {
    assert.throws(() => decodeShieldedIndependentKeyMnemonic(phrase), { code: "INVALID_INDEPENDENT_KEY_MNEMONIC" });
  }
});

test("invalid words, checksums, lengths and unbounded input return sanitized protocol errors", () => {
  const secretMarker = "private_secret_do_not_echo";
  for (const phrase of [
    null,
    123,
    "",
    " \t\r\n",
    `${"abandon ".repeat(11)}about`, // Valid BIP39, but only 12 words.
    `${"abandon ".repeat(23)}abandon`, // Word count and membership valid, checksum invalid.
    frozenWords.replace("abandon", secretMarker),
    `${" ".repeat(1025)}${frozenWords}`,
    `${frozenWords} extra`,
  ]) {
    assert.throws(
      () => decodeShieldedIndependentKeyMnemonic(phrase),
      (error) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_INDEPENDENT_KEY_MNEMONIC");
        assert.equal(error.cause, undefined);
        assert.equal(String(error).includes(secretMarker), false);
        assert.equal(String(error).includes(frozenWords), false);
        return true;
      },
    );
  }
});

test("Shielded Key requires exactly 32 bytes with a lowercase 0x prefix", () => {
  for (const value of [
    null,
    frozenRoot,
    "",
    "11".repeat(32),
    `0X${"11".repeat(32)}`,
    `0x${"11".repeat(31)}`,
    `0x${"11".repeat(33)}`,
    `0x${"gg".repeat(32)}`,
    ` ${encodeShieldedIndependentKey(frozenRoot)}`,
    `${encodeShieldedIndependentKey(frozenRoot)}\n`,
    `0x${"a".repeat(4096)}`,
  ]) {
    assert.throws(() => decodeShieldedIndependentKey(value), { code: "INVALID_INDEPENDENT_KEY" });
  }
});

test("exports leave caller bytes intact; imports return independent mutable copies", () => {
  const root = frozenRoot.slice();
  const phrase = encodeShieldedIndependentKeyMnemonic(root);
  const key = encodeShieldedIndependentKey(root);
  assert.deepEqual(root, frozenRoot);
  const decodedWords = decodeShieldedIndependentKeyMnemonic(phrase);
  const decodedKey = decodeShieldedIndependentKey(key);
  decodedWords.fill(0);
  decodedKey.fill(0);
  assert.deepEqual(root, frozenRoot);
  assert.deepEqual(decodeShieldedIndependentKeyMnemonic(phrase), frozenRoot);
  assert.deepEqual(decodeShieldedIndependentKey(key), frozenRoot);
  for (const invalidRoot of [new Uint8Array(31), new Uint8Array(33), "secret", null]) {
    assert.throws(() => encodeShieldedIndependentKeyMnemonic(invalidRoot), { code: "INVALID_INDEPENDENT_KEY_ROOT" });
    assert.throws(() => encodeShieldedIndependentKey(invalidRoot), { code: "INVALID_INDEPENDENT_KEY_ROOT" });
  }
});
