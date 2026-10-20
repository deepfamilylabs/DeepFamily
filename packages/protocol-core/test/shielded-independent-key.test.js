import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import { test } from "node:test";
import { Wallet, getBytes, hexlify, sha256, toBeHex, toUtf8Bytes } from "ethers";
import {
  buildShieldedIndependentKeySigningMessage,
  createShieldedIndependentKeyRoot,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedIndependentKeyRootFromSignature,
  normalizeShieldedIndependentKeySignature,
} from "../shielded-independent-key.js";

import { independentKeyVector as vector } from "./shielded-independent-key.fixture.js";

const wallet = new Wallet(`0x${"11".repeat(32)}`);
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

test("new random roots require explicit creation; recovery has no entropy fallback", () => {
  assert.throws(() => createShieldedIndependentKeyRoot(), { code: "EXPLICIT_INDEPENDENT_KEY_CREATION_REQUIRED" });
  assert.throws(() => createShieldedIndependentKeyRoot({ intent: "restore" }), {
    code: "EXPLICIT_INDEPENDENT_KEY_CREATION_REQUIRED",
  });
  assert.throws(
    () => createShieldedIndependentKeyRoot({ intent: "create", rootSource: "walletSignature" }),
    { code: "INVALID_INDEPENDENT_KEY_ROOT_SOURCE" },
  );
  const a = createShieldedIndependentKeyRoot({ intent: "create" });
  const b = createShieldedIndependentKeyRoot({ intent: "create" });
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});

test("exact EIP-191 message and canonical low-s signature derive the RFC5869 root", async () => {
  const message = buildShieldedIndependentKeySigningMessage(wallet.address);
  assert.equal(
    message,
    `DeepFamily Independent Key v1\nAccount: ${wallet.address.toLowerCase()}\nPurpose: Create or restore the DeepFamily independent key\nKeep this signature private. It controls the derived funds.`,
  );
  const signature = await wallet.signMessage(message);
  const canonical = normalizeShieldedIndependentKeySignature({ signerAddress: wallet.address, signature });
  const lowV = canonical.slice();
  lowV[64] -= 27;
  const highS = getBytes(
    `0x${hexlify(canonical.subarray(0, 32)).slice(2)}${toBeHex(order - BigInt(hexlify(canonical.subarray(32, 64))), 32).slice(2)}${(canonical[64] === 27 ? 28 : 27).toString(16)}`,
  );
  assert.deepEqual(
    normalizeShieldedIndependentKeySignature({ signerAddress: wallet.address, signature: lowV }),
    canonical,
  );
  assert.deepEqual(
    normalizeShieldedIndependentKeySignature({ signerAddress: wallet.address, signature: highS }),
    canonical,
  );
  const derived = await deriveShieldedIndependentKeyRootFromSignature({
    signerAddress: wallet.address,
    signature: highS,
  });
  const salt = getBytes(sha256(toUtf8Bytes("DeepFamily:WalletIndependentKeyRoot:v1")));
  const info = Buffer.concat([
    Buffer.from(getBytes(sha256(toUtf8Bytes(message)))),
    Buffer.from(getBytes(wallet.address)),
  ]);
  assert.deepEqual(
    derived.independentKeyRoot,
    new Uint8Array(hkdfSync("sha256", canonical, salt, info, 32)),
  );
  assert.equal(derived.sourceMetadata.messageHash, sha256(toUtf8Bytes(message)));
  assert.equal("signature" in derived.sourceMetadata, false);
  assert.deepEqual(
    (await deriveShieldedIndependentKeyRootFromSignature({ signerAddress: wallet.address, signature }))
      .independentKeyRoot,
    derived.independentKeyRoot,
  );
});

test("signature input rejects compact, wrong message, wrong signer and invalid v/scalars", async () => {
  const signature = await wallet.signMessage(buildShieldedIndependentKeySigningMessage(wallet.address));
  assert.throws(
    () =>
      normalizeShieldedIndependentKeySignature({
        signerAddress: wallet.address,
        signature: getBytes(signature).slice(0, 64),
      }),
    { code: "INVALID_INDEPENDENT_KEY_SIGNATURE" },
  );
  const invalid = getBytes(signature);
  invalid[64] = 29;
  assert.throws(
    () => normalizeShieldedIndependentKeySignature({ signerAddress: wallet.address, signature: invalid }),
    { code: "INVALID_INDEPENDENT_KEY_SIGNATURE" },
  );
  assert.throws(
    () =>
      normalizeShieldedIndependentKeySignature({
        signerAddress: wallet.address,
        signature: new Uint8Array(65),
      }),
    { code: "INVALID_INDEPENDENT_KEY_SIGNATURE" },
  );
  const wrongMessage = await wallet.signMessage(
    `${buildShieldedIndependentKeySigningMessage(wallet.address)}\n`,
  );
  assert.throws(
    () =>
      normalizeShieldedIndependentKeySignature({ signerAddress: wallet.address, signature: wrongMessage }),
    { code: "INDEPENDENT_KEY_SIGNATURE_SIGNER_MISMATCH" },
  );
  assert.throws(
    () =>
      normalizeShieldedIndependentKeySignature({
        signerAddress: new Wallet(`0x${"22".repeat(32)}`).address,
        signature,
      }),
    { code: "INDEPENDENT_KEY_SIGNATURE_SIGNER_MISMATCH" },
  );
});

test("common branches and key fingerprint require the root and independent-key identity secret", async () => {
  const root = Uint8Array.from({ length: 32 }, (_, i) => i);
  const first = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: root,
    independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
  });
  const second = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: root,
    independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
  });
  assert.deepEqual(first, second);
  // Frozen branch-v1 fixture for independent implementations and future releases.
  assert.equal(first.ownerSecret, vector.ownerSecret);
  assert.equal(first.ownerCommitment, vector.ownerCommitment);
  assert.equal(first.hpkeIkm, vector.hpkeIkm);
  assert.equal(hexlify(first.viewPublicKey), vector.viewPublicKey);
  assert.equal(first.keyFingerprint, vector.keyFingerprint);
  assert.equal(first.keyMode, 1);
  assert.equal(first.viewPublicKey.length, 32);
  assert.notEqual(first.hpkeIkm, hexlify(root));
  assert.deepEqual(
    root,
    Uint8Array.from({ length: 32 }, (_, i) => i),
  );
  const changed = root.slice();
  changed[0] ^= 1;
  assert.notEqual(
    (
      await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: changed,
        independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
      })
    ).keyFingerprint,
    first.keyFingerprint,
  );
  await assert.rejects(
    deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(31),
      independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
    }),
    {
      code: "INVALID_INDEPENDENT_KEY_ROOT",
    },
  );
});

test("independent key branches have no root-only or identity-output parameter fallback", async () => {
  const independentKeyRoot = getBytes(vector.independentKeyRoot);
  for (const input of [undefined, independentKeyRoot, { independentKeyIdentitySecret: vector.independentKeyIdentitySecret }]) {
    await assert.rejects(deriveShieldedIndependentKeyMaterial(input), { code: "INVALID_INDEPENDENT_KEY_ROOT" });
  }
  for (const input of [
    { independentKeyRoot },
    { independentKeyRoot, independentKeyIdentitySecret: null },
    { independentKeyRoot, independentKeyIdentitySecret: new Uint8Array(31) },
    { independentKeyRoot, independentKeyIdentitySecret: new Uint8Array(33) },
    { independentKeyRoot, derivedSecretBytes: getBytes(vector.independentKeyIdentitySecret) },
    { independentKeyRoot, derivedSecretField: 1n },
    { independentKeyRoot, identityCommitment: 1n },
  ]) {
    await assert.rejects(deriveShieldedIndependentKeyMaterial(input), {
      code: "INVALID_INDEPENDENT_KEY_IDENTITY_SECRET",
    });
  }
});

test("independent key branches preserve leading zeros, caller buffers and context independence", async () => {
  const independentKeyRoot = getBytes(vector.independentKeyRoot);
  const independentKeyIdentitySecret = new Uint8Array(32);
  independentKeyIdentitySecret[31] = 1;
  const savedRoot = independentKeyRoot.slice();
  const savedSecret = independentKeyIdentitySecret.slice();
  const plain = await deriveShieldedIndependentKeyMaterial({ independentKeyRoot, independentKeyIdentitySecret });
  const extraContext = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot,
    independentKeyIdentitySecret,
    identitySuiteId: 42,
    identityCommitment: 123n,
    personHash: "different",
    chainId: 1,
    poolAddress: "different",
    rootSource: "walletSignature",
  });
  assert.deepEqual(extraContext, plain);
  assert.deepEqual(independentKeyRoot, savedRoot);
  assert.deepEqual(independentKeyIdentitySecret, savedSecret);
  assert.notEqual(
    (await deriveShieldedIndependentKeyMaterial({ independentKeyRoot, independentKeyIdentitySecret: new Uint8Array(32) }))
      .keyFingerprint,
    plain.keyFingerprint,
  );
  assert.notEqual(
    (
      await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot,
        independentKeyIdentitySecret: vector.independentKeyIdentitySecret,
      })
    ).keyFingerprint,
    plain.keyFingerprint,
  );
});
