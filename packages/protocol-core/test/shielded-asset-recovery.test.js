import assert from "node:assert/strict";
import { test } from "node:test";
import { Mnemonic, Wallet, getBytes, wordlists } from "ethers";
import {
  ProtocolError,
  buildShieldedAssetSigningMessage,
  decodeShieldedAssetKey,
  decodeShieldedAssetMnemonic,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
  encodeShieldedAssetKey,
  encodeShieldedAssetMnemonic,
} from "../index.js";

// Official BIP39 reference vectors: https://github.com/trezor/python-mnemonic/blob/master/vectors.json
// Only the entropy/words part is used; the reference PBKDF2 seed is not an asset root.
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
    assert.equal(encodeShieldedAssetMnemonic(root), phrase);
    assert.deepEqual(decodeShieldedAssetMnemonic(phrase), root);
    assert.equal(encodeShieldedAssetKey(root), `0x${hex}`);
    assert.deepEqual(decodeShieldedAssetKey(`0x${hex}`), root);
  }
});

test("mnemonic and Shielded Key restore the frozen branch-v1 owner and fingerprint", async () => {
  assert.equal(encodeShieldedAssetMnemonic(frozenRoot), frozenWords);
  for (const restored of [
    decodeShieldedAssetMnemonic(frozenWords),
    decodeShieldedAssetKey(encodeShieldedAssetKey(frozenRoot)),
  ]) {
    assert.deepEqual(restored, frozenRoot);
    const keys = await deriveShieldedAssetKeyMaterial(restored);
    assert.equal(
      keys.ownerSecret,
      21163297713406726978733507212238736142897898906436691617414556311477803122818n,
    );
    assert.equal(
      keys.fundsFingerprint,
      "0xba9339b546645507471bedc1c78f017ec71d74de4dda220e376401883f02e027",
    );
  }
});

test("signature-derived roots have the same mnemonic and key recovery without provenance", async () => {
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
  const { assetRoot } = await deriveShieldedAssetRootFromSignature({
    signerAddress: wallet.address,
    signature,
  });
  const restored = decodeShieldedAssetMnemonic(encodeShieldedAssetMnemonic(assetRoot));
  assert.deepEqual(restored, decodeShieldedAssetKey(encodeShieldedAssetKey(assetRoot)));
  assert.deepEqual(
    await deriveShieldedAssetKeyMaterial(restored),
    await deriveShieldedAssetKeyMaterial(assetRoot),
  );
});

test("recovery decodes entropy directly; a BIP39 seed is a different secret", () => {
  const mnemonic = Mnemonic.fromPhrase(frozenWords, "", wordlists.en);
  const seed = getBytes(mnemonic.computeSeed());
  assert.equal(seed.length, 64);
  assert.notDeepEqual(seed.subarray(0, 32), frozenRoot);
  assert.deepEqual(decodeShieldedAssetMnemonic(frozenWords), frozenRoot);
});

test("mnemonic imports normalize ASCII case and whitespace only", () => {
  const spaced = `\r\n\t${frozenWords.toUpperCase().split(" ").join(" \t\n\v\f\r ")}\r\n`;
  assert.deepEqual(decodeShieldedAssetMnemonic(spaced), frozenRoot);
  assert.deepEqual(
    decodeShieldedAssetKey(encodeShieldedAssetKey(frozenRoot).toUpperCase().replace("0X", "0x")),
    frozenRoot,
  );
  for (const phrase of [
    frozenWords.replace(" ", "\u00a0"),
    frozenWords.replace(" ", "\u3000"),
    frozenWords.replace("abandon", "ａｂａｎｄｏｎ"),
    frozenWords.replace("abandon", "ábándon"),
    `\ufeff${frozenWords}`,
  ]) {
    assert.throws(() => decodeShieldedAssetMnemonic(phrase), { code: "INVALID_ASSET_MNEMONIC" });
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
      () => decodeShieldedAssetMnemonic(phrase),
      (error) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_ASSET_MNEMONIC");
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
    ` ${encodeShieldedAssetKey(frozenRoot)}`,
    `${encodeShieldedAssetKey(frozenRoot)}\n`,
    `0x${"a".repeat(4096)}`,
  ]) {
    assert.throws(() => decodeShieldedAssetKey(value), { code: "INVALID_ASSET_KEY" });
  }
});

test("exports leave caller bytes intact; imports return independent mutable copies", () => {
  const root = frozenRoot.slice();
  const phrase = encodeShieldedAssetMnemonic(root);
  const key = encodeShieldedAssetKey(root);
  assert.deepEqual(root, frozenRoot);
  const decodedWords = decodeShieldedAssetMnemonic(phrase);
  const decodedKey = decodeShieldedAssetKey(key);
  decodedWords.fill(0);
  decodedKey.fill(0);
  assert.deepEqual(root, frozenRoot);
  assert.deepEqual(decodeShieldedAssetMnemonic(phrase), frozenRoot);
  assert.deepEqual(decodeShieldedAssetKey(key), frozenRoot);
  for (const invalidRoot of [new Uint8Array(31), new Uint8Array(33), "secret", null]) {
    assert.throws(() => encodeShieldedAssetMnemonic(invalidRoot), { code: "INVALID_ASSET_ROOT" });
    assert.throws(() => encodeShieldedAssetKey(invalidRoot), { code: "INVALID_ASSET_ROOT" });
  }
});
